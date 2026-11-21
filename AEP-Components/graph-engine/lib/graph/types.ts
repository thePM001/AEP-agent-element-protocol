export type GraphNodeType = "action" | "decision" | "wait" | "parallel" | "loop";

export type BackoffStrategy = "linear" | "exponential" | "fibonacci";

export interface RetryPolicy {
  maxAttempts: number;
  backoff: BackoffStrategy;
  baseDelayMs: number;
}

export interface LoopBounds {
  maxIterations: number;
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  next: string[];
  /** Decision branch keyed by policy outcome */
  branches?: Record<string, string>;
  retry?: RetryPolicy;
  loop?: LoopBounds;
  /** Wait node timeout before escalation */
  waitTimeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphCheckpoint {
  nodeId: string;
  timestamp: number;
  context: GraphContext;
  vectorClock: Record<string, number>;
}

/** Where the checkpoints of a run are kept. The engine holds none itself. */
export interface CheckpointStore {
  /** Keep one checkpoint. Throws when the checkpoint cannot be kept. */
  append(checkpoint: GraphCheckpoint): void;
  /** Every kept checkpoint of the run in the order it was kept. */
  list(): GraphCheckpoint[];
}

export interface GraphContext {
  input: Record<string, unknown>;
  variables: Record<string, unknown>;
  history: string[];
}

export interface NodeExecutionResult {
  nodeId: string;
  type: GraphNodeType;
  status: "completed" | "waiting" | "failed" | "skipped";
  output?: unknown;
  next?: string[];
  error?: string;
  attempts: number;
  checkpoint?: GraphCheckpoint;
}

export interface GraphExecutionResult {
  status: "completed" | "waiting" | "failed";
  history: NodeExecutionResult[];
  context: GraphContext;
  checkpoints: GraphCheckpoint[];
  error?: string;
  vectorClock: Record<string, number>;
}

export type PolicyEvaluator = (
  node: GraphNode,
  context: GraphContext,
) => Promise<string | null>;

export type NodeExecutor = (
  node: GraphNode,
  context: GraphContext,
) => Promise<unknown>;

export type ApprovalGate = (
  node: GraphNode,
  context: GraphContext,
) => Promise<boolean>;

/** Envelope Admit hook. Missing admitGate is deny. policyEvaluator is not Admit. */
export type AdmitGate = (
  node: GraphNode,
  context: GraphContext,
) => Promise<boolean>;

export interface GraphEngineOptions {
  entryNodeId?: string;
  policyEvaluator?: PolicyEvaluator;
  nodeExecutor?: NodeExecutor;
  approvalGate?: ApprovalGate;
  admitGate?: AdmitGate;
  vectorClockAgentId?: string;
  /**
   * Where the checkpoints of the run are kept. Default: a store that lives in the
   * process. Hand in a LatticeMemoryCheckpointStore to resume a run after a restart.
   */
  checkpointStore?: CheckpointStore;
}
