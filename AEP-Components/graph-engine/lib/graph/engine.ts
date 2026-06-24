import type {
  ApprovalGate,
  GraphCheckpoint,
  GraphContext,
  GraphEngineOptions,
  GraphExecutionResult,
  GraphNode,
  NodeExecutionResult,
  NodeExecutor,
  PolicyEvaluator,
  RetryPolicy,
} from "./types.js";

export class GraphEngine {
  private nodes = new Map<string, GraphNode>();
  private checkpoints: GraphCheckpoint[] = [];
  private vectorClock: Record<string, number> = {};
  private readonly options: GraphEngineOptions;

  constructor(options: GraphEngineOptions = {}) {
    this.options = options;
    const agentId = options.vectorClockAgentId ?? "graph-engine";
    this.vectorClock[agentId] = 0;
  }

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, { ...node, next: [...node.next] });
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  listNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  validate(): string[] {
    const errors: string[] = [];
    if (this.nodes.size === 0) {
      errors.push("Graph has no nodes");
    }

    for (const [id, node] of this.nodes) {
      for (const nextId of node.next) {
        if (!this.nodes.has(nextId)) {
          errors.push(`Node ${id} references missing node ${nextId}`);
        }
      }
      if (node.branches) {
        for (const [branch, target] of Object.entries(node.branches)) {
          if (!this.nodes.has(target)) {
            errors.push(`Node ${id} branch '${branch}' references missing node ${target}`);
          }
        }
      }
      if (node.type === "loop" && (!node.loop || node.loop.maxIterations < 1)) {
        errors.push(`Loop node ${id} requires loop.maxIterations >= 1`);
      }
    }

    const entry = this.resolveEntryNodeId();
    if (entry && !this.nodes.has(entry)) {
      errors.push(`Entry node '${entry}' does not exist`);
    }

    return errors;
  }

  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string) => {
      if (path.includes(nodeId)) {
        const cycleStart = path.indexOf(nodeId);
        cycles.push([...path.slice(cycleStart), nodeId]);
        return;
      }
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      path.push(nodeId);
      const node = this.nodes.get(nodeId);
      if (node) {
        for (const next of node.next) dfs(next);
        if (node.branches) {
          for (const target of Object.values(node.branches)) dfs(target);
        }
      }
      path.pop();
    };

    for (const id of this.nodes.keys()) dfs(id);
    return cycles;
  }

  getCheckpoints(): GraphCheckpoint[] {
    return [...this.checkpoints];
  }

  restoreCheckpoint(nodeId: string): GraphContext | null {
    const cp = [...this.checkpoints].reverse().find((c) => c.nodeId === nodeId);
    if (!cp) return null;
    this.vectorClock = { ...cp.vectorClock };
    return {
      input: { ...cp.context.input },
      variables: { ...cp.context.variables },
      history: [...cp.context.history],
    };
  }

  async execute(params: {
    input?: Record<string, unknown>;
    startNodeId?: string;
  } = {}): Promise<GraphExecutionResult> {
    const validationErrors = this.validate();
    if (validationErrors.length > 0) {
      return {
        status: "failed",
        history: [],
        context: this.emptyContext(params.input),
        checkpoints: [],
        error: validationErrors.join("; "),
      };
    }

    const context: GraphContext = {
      input: { ...(params.input ?? {}) },
      variables: {},
      history: [],
    };

    const history: NodeExecutionResult[] = [];
    let currentId: string | null = params.startNodeId ?? this.resolveEntryNodeId();
    const loopCounters = new Map<string, number>();

    while (currentId) {
      const node = this.nodes.get(currentId);
      if (!node) {
        return {
          status: "failed",
          history,
          context,
          checkpoints: [...this.checkpoints],
          error: `Missing node ${currentId}`,
        };
      }

      if (node.type === "loop") {
        const count = (loopCounters.get(node.id) ?? 0) + 1;
        const max = node.loop?.maxIterations ?? 1;
        if (count > max) {
          history.push({
            nodeId: node.id,
            type: node.type,
            status: "skipped",
            attempts: 0,
            error: `Loop bound exceeded (${max})`,
          });
          currentId = null;
          break;
        }
        loopCounters.set(node.id, count);
      }

      const result = await this.executeNode(node, context);
      history.push(result);
      context.history.push(node.id);
      this.tickVectorClock();

      if (result.checkpoint) {
        this.checkpoints.push(result.checkpoint);
      }

      if (result.status === "waiting") {
        return {
          status: "waiting",
          history,
          context,
          checkpoints: [...this.checkpoints],
        };
      }

      if (result.status === "failed") {
        return {
          status: "failed",
          history,
          context,
          checkpoints: [...this.checkpoints],
          error: result.error ?? `Node ${node.id} failed`,
        };
      }

      const nextIds = result.next ?? node.next;
      currentId = nextIds.length > 0 ? nextIds[0] : null;
    }

    return {
      status: "completed",
      history,
      context,
      checkpoints: [...this.checkpoints],
    };
  }

  private async executeNode(
    node: GraphNode,
    context: GraphContext,
  ): Promise<NodeExecutionResult> {
    const executor = this.options.nodeExecutor ?? defaultNodeExecutor;
    const policyEvaluator = this.options.policyEvaluator;
    const approvalGate = this.options.approvalGate;
    const retry = node.retry ?? { maxAttempts: 1, backoff: "linear", baseDelayMs: 0 };

    let attempts = 0;
    let lastError: string | undefined;

    while (attempts < retry.maxAttempts) {
      attempts++;
      try {
        if (node.type === "decision" && policyEvaluator) {
          const branch = await policyEvaluator(node, context);
          const target = branch ? node.branches?.[branch] : undefined;
          const checkpoint = this.makeCheckpoint(node.id, context);
          return {
            nodeId: node.id,
            type: node.type,
            status: "completed",
            output: { branch, target },
            next: target ? [target] : node.next,
            attempts,
            checkpoint,
          };
        }

        if (node.type === "wait" && approvalGate) {
          const approved = await this.waitForApproval(node, context, approvalGate);
          if (!approved) {
            return {
              nodeId: node.id,
              type: node.type,
              status: "waiting",
              attempts,
              checkpoint: this.makeCheckpoint(node.id, context),
            };
          }
        }

        const output = await executor(node, context);
        return {
          nodeId: node.id,
          type: node.type,
          status: "completed",
          output,
          attempts,
          checkpoint: this.makeCheckpoint(node.id, context),
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempts < retry.maxAttempts) {
          await delay(backoffDelay(retry, attempts));
        }
      }
    }

    return {
      nodeId: node.id,
      type: node.type,
      status: "failed",
      attempts,
      error: lastError ?? "execution_failed",
    };
  }

  private async waitForApproval(
    node: GraphNode,
    context: GraphContext,
    approvalGate: ApprovalGate,
  ): Promise<boolean> {
    const timeoutMs = node.waitTimeoutMs ?? 0;
    if (timeoutMs <= 0) {
      return approvalGate(node, context);
    }

    return Promise.race([
      approvalGate(node, context),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  }

  private makeCheckpoint(nodeId: string, context: GraphContext): GraphCheckpoint {
    return {
      nodeId,
      timestamp: Date.now(),
      context: {
        input: { ...context.input },
        variables: { ...context.variables },
        history: [...context.history],
      },
      vectorClock: { ...this.vectorClock },
    };
  }

  private tickVectorClock(): void {
    const agentId = this.options.vectorClockAgentId ?? "graph-engine";
    this.vectorClock[agentId] = (this.vectorClock[agentId] ?? 0) + 1;
  }

  private resolveEntryNodeId(): string | null {
    if (this.options.entryNodeId) return this.options.entryNodeId;
    if (this.nodes.has("start")) return "start";
    const first = this.nodes.keys().next();
    return first.done ? null : first.value;
  }

  private emptyContext(input?: Record<string, unknown>): GraphContext {
    return { input: { ...(input ?? {}) }, variables: {}, history: [] };
  }
}

const defaultNodeExecutor: NodeExecutor = async (node) => ({ nodeId: node.id, ok: true });

function backoffDelay(policy: RetryPolicy, attempt: number): number {
  const base = policy.baseDelayMs;
  switch (policy.backoff) {
    case "exponential":
      return base * Math.pow(2, attempt - 1);
    case "fibonacci":
      return base * fib(attempt);
    case "linear":
    default:
      return base * attempt;
  }
}

function fib(n: number): number {
  if (n <= 1) return 1;
  let a = 1;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return b;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGraphEngine(options?: GraphEngineOptions): GraphEngine {
  return new GraphEngine(options);
}