import { describe, it, expect } from "vitest";
import {
  GRAPH_CHECKPOINT_DOMAIN,
  GraphEngine,
  LatticeMemoryCheckpointStore,
  VolatileCheckpointStore,
  createGraphEngine,
} from "../lib/graph/index.js";
import type {
  AdmitGate,
  CheckpointStore,
  GraphCheckpoint,
  GraphNode,
  GraphEngineOptions,
  MemoryProgram,
  NodeExecutor,
} from "../lib/graph/index.js";

const allow: AdmitGate = async () => true;

function action(id: string, next: string[] = []): GraphNode {
  return { id, type: "action", next };
}

function engineWith(nodes: GraphNode[], options: GraphEngineOptions = {}): GraphEngine {
  const engine = createGraphEngine(options);
  for (const node of nodes) engine.addNode(node);
  return engine;
}

describe("GraphEngine.validate", () => {
  it("reports an empty graph", () => {
    expect(new GraphEngine().validate()).toEqual(["Graph has no nodes"]);
  });

  it("reports missing next targets, branch targets, loop bounds and entry", () => {
    const engine = engineWith(
      [
        action("a", ["ghost"]),
        { id: "d", type: "decision", next: [], branches: { yes: "nowhere" } },
        { id: "l", type: "loop", next: [] },
      ],
      { entryNodeId: "missing" },
    );
    expect(engine.validate()).toEqual([
      "Node a references missing node ghost",
      "Node d branch 'yes' references missing node nowhere",
      "Loop node l requires loop.maxIterations >= 1",
      "Entry node 'missing' does not exist",
    ]);
  });

  it("accepts a well formed graph", () => {
    expect(engineWith([action("start", ["b"]), action("b")]).validate()).toEqual([]);
  });

  it("copies nodes on add so caller mutation has no effect", () => {
    const node = action("a", ["b"]);
    const engine = engineWith([node, action("b")]);
    node.next.push("ghost");
    expect(engine.getNode("a")?.next).toEqual(["b"]);
    expect(engine.listNodes().map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("GraphEngine.detectCycles", () => {
  it("finds a cycle through next and branches", () => {
    const engine = engineWith([
      action("a", ["b"]),
      { id: "b", type: "decision", next: [], branches: { back: "a" } },
    ]);
    expect(engine.detectCycles()).toEqual([["a", "b", "a"]]);
  });

  it("returns no cycles for a DAG", () => {
    expect(engineWith([action("a", ["b", "c"]), action("b", ["c"]), action("c")]).detectCycles()).toEqual([]);
  });
});

describe("GraphEngine.execute admit gate", () => {
  it("denies by default when no admit gate is injected", async () => {
    let ran = false;
    const engine = engineWith([action("start")], {
      nodeExecutor: async () => {
        ran = true;
        return "x";
      },
    });
    const result = await engine.execute();
    expect(result.status).toBe("failed");
    expect(result.error).toBe("admit_denied");
    expect(result.history).toEqual([
      { nodeId: "start", type: "action", status: "failed", attempts: 0, error: "admit_denied" },
    ]);
    expect(result.vectorClock).toEqual({ "graph-engine": 0 });
    expect(ran).toBe(false);
  });

  it("stops at a node the gate denies", async () => {
    const engine = engineWith([action("start", ["b"]), action("b")], {
      admitGate: async (node) => node.id !== "b",
      nodeExecutor: async (node) => node.id,
    });
    const result = await engine.execute();
    expect(result.status).toBe("failed");
    expect(result.history.map((h) => [h.nodeId, h.status])).toEqual([
      ["start", "completed"],
      ["b", "failed"],
    ]);
    expect(result.vectorClock).toEqual({ "graph-engine": 1 });
  });
});

describe("GraphEngine.execute flow", () => {
  it("runs a linear graph, records checkpoints and ticks the clock per node", async () => {
    const seen: string[] = [];
    const engine = engineWith([action("start", ["b"]), action("b", ["c"]), action("c")], {
      admitGate: allow,
      vectorClockAgentId: "agent-1",
      nodeExecutor: async (node, ctx) => {
        seen.push(`${node.id}:${String(ctx.input.job)}`);
        return { done: node.id };
      },
    });
    const result = await engine.execute({ input: { job: 7 } });
    expect(result.status).toBe("completed");
    expect(seen).toEqual(["start:7", "b:7", "c:7"]);
    expect(result.context.history).toEqual(["start", "b", "c"]);
    expect(result.history.map((h) => h.output)).toEqual([{ done: "start" }, { done: "b" }, { done: "c" }]);
    expect(result.checkpoints.map((c) => c.nodeId)).toEqual(["start", "b", "c"]);
    expect(result.vectorClock).toEqual({ "agent-1": 3 });
    expect(engine.getCheckpoints()).toHaveLength(3);
  });

  it("uses a fail closed default executor result when none is injected", async () => {
    const result = await engineWith([action("start")], { admitGate: allow }).execute();
    expect(result.status).toBe("completed");
    expect(result.history[0]?.output).toEqual({
      nodeId: "start",
      ok: false,
      error: "no executor injected (fail closed)",
    });
  });

  it("prefers the node named start, then an explicit entry, then a start parameter", async () => {
    const order: string[] = [];
    const executor: NodeExecutor = async (node) => order.push(node.id);
    const nodes = [action("x"), action("start"), action("y")];

    await engineWith(nodes, { admitGate: allow, nodeExecutor: executor }).execute();
    await engineWith(nodes, { admitGate: allow, nodeExecutor: executor, entryNodeId: "y" }).execute();
    await engineWith(nodes, { admitGate: allow, nodeExecutor: executor }).execute({ startNodeId: "x" });
    expect(order).toEqual(["start", "y", "x"]);
  });

  it("fails on validation errors before running anything", async () => {
    const result = await engineWith([action("start", ["ghost"])], { admitGate: allow }).execute({ input: { a: 1 } });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Node start references missing node ghost");
    expect(result.history).toEqual([]);
    expect(result.context).toEqual({ input: { a: 1 }, variables: {}, history: [] });
  });

  it("fails when the start node does not exist", async () => {
    const result = await engineWith([action("start")], { admitGate: allow }).execute({ startNodeId: "nope" });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Missing node nope");
  });

  it("follows the branch chosen by the policy evaluator", async () => {
    const engine = engineWith(
      [
        { id: "start", type: "decision", next: ["fallback"], branches: { approve: "ship", reject: "stop" } },
        action("ship"),
        action("stop"),
        action("fallback"),
      ],
      { admitGate: allow, policyEvaluator: async (_node, ctx) => String(ctx.input.verdict), nodeExecutor: async () => "ok" },
    );
    const approved = await engine.execute({ input: { verdict: "approve" } });
    expect(approved.context.history).toEqual(["start", "ship"]);
    expect(approved.history[0]?.output).toEqual({ branch: "approve", target: "ship" });

    const unknown = await engine.execute({ input: { verdict: "maybe" } });
    expect(unknown.context.history).toEqual(["start", "fallback"]);
  });

  it("returns waiting when the approval gate declines and continues when it approves", async () => {
    const nodes: GraphNode[] = [{ id: "start", type: "wait", next: ["after"] }, action("after")];
    const declined = await engineWith(nodes, { admitGate: allow, approvalGate: async () => false }).execute();
    expect(declined.status).toBe("waiting");
    expect(declined.history[0]?.status).toBe("waiting");
    expect(declined.checkpoints.map((c) => c.nodeId)).toEqual(["start"]);

    const approved = await engineWith(nodes, {
      admitGate: allow,
      approvalGate: async () => true,
      nodeExecutor: async () => "ok",
    }).execute();
    expect(approved.status).toBe("completed");
    expect(approved.context.history).toEqual(["start", "after"]);
  });

  it("treats an approval timeout as not approved", async () => {
    const nodes: GraphNode[] = [{ id: "start", type: "wait", next: [], waitTimeoutMs: 5 }];
    const result = await engineWith(nodes, {
      admitGate: allow,
      approvalGate: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 200)),
    }).execute();
    expect(result.status).toBe("waiting");
  });

  it("retries a failing node and succeeds within the retry budget", async () => {
    let calls = 0;
    const engine = engineWith(
      [{ id: "start", type: "action", next: [], retry: { maxAttempts: 3, backoff: "exponential", baseDelayMs: 1 } }],
      {
        admitGate: allow,
        nodeExecutor: async () => {
          calls++;
          if (calls < 3) throw new Error(`transient ${calls}`);
          return "ok";
        },
      },
    );
    const result = await engine.execute();
    expect(result.status).toBe("completed");
    expect(result.history[0]?.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it("fails with the last error once retries are exhausted", async () => {
    const engine = engineWith(
      [{ id: "start", type: "action", next: [], retry: { maxAttempts: 2, backoff: "fibonacci", baseDelayMs: 0 } }],
      {
        admitGate: allow,
        nodeExecutor: async () => {
          throw "bad input";
        },
      },
    );
    const result = await engine.execute();
    expect(result.status).toBe("failed");
    expect(result.error).toBe("bad input");
    expect(result.history[0]?.attempts).toBe(2);
    expect(result.vectorClock).toEqual({ "graph-engine": 1 });
  });

  it("stops a self loop at its iteration bound", async () => {
    let runs = 0;
    const engine = engineWith([{ id: "start", type: "loop", next: ["start"], loop: { maxIterations: 2 } }], {
      admitGate: allow,
      nodeExecutor: async () => ++runs,
    });
    const result = await engine.execute();
    expect(result.status).toBe("completed");
    expect(runs).toBe(2);
    expect(result.history.map((h) => h.status)).toEqual(["completed", "completed", "skipped"]);
    expect(result.history[2]?.error).toBe("Loop bound exceeded (2)");
  });
});

describe("GraphEngine.restoreCheckpoint", () => {
  it("restores the latest checkpoint context and vector clock for a node", async () => {
    const engine = engineWith([action("start", ["b"]), action("b")], {
      admitGate: allow,
      nodeExecutor: async () => "ok",
    });
    await engine.execute({ input: { n: 1 } });
    expect(engine.restoreCheckpoint("b")).toEqual({ input: { n: 1 }, variables: {}, history: ["start"] });
    const ctx = engine.restoreCheckpoint("start");
    expect(ctx).toEqual({ input: { n: 1 }, variables: {}, history: [] });
    expect(engine.restoreCheckpoint("missing")).toBeNull();

    const after = await engine.execute();
    // The clock resumed from the restored value (1) and ticked twice more.
    expect(after.vectorClock).toEqual({ "graph-engine": 3 });
  });
});

describe("checkpoint stores", () => {
  const chain = [action("start", ["b"]), action("b", ["c"]), action("c")];
  const run: GraphEngineOptions = { admitGate: allow, nodeExecutor: async (n) => ({ ok: n.id }) };

  /** A stand-in for the program of Lattice Memory: it keeps what `record` hands it. */
  function fakeProgram(): { program: MemoryProgram; records: Record<string, unknown>[] } {
    const records: Record<string, unknown>[] = [];
    const program: MemoryProgram = (command, request) => {
      const asked = request as Record<string, unknown>;
      if (command === "record") {
        records.push(JSON.parse(JSON.stringify(asked)) as Record<string, unknown>);
        return { ok: true, key: records.length };
      }
      return records.filter((r) => r.domain === asked.domain && r.element_id === asked.element_id);
    };
    return { program, records };
  }

  it("hands every checkpoint to the store and reads the kept ones back from it", async () => {
    const kept: GraphCheckpoint[] = [];
    const store: CheckpointStore = {
      append: (checkpoint) => {
        kept.push(checkpoint);
      },
      list: () => [...kept],
    };
    const engine = engineWith(chain, { ...run, checkpointStore: store });
    const result = await engine.execute({ input: { n: 1 } });
    expect(result.status).toBe("completed");
    expect(kept.map((c) => c.nodeId)).toEqual(["start", "b", "c"]);
    expect(result.checkpoints).toEqual(kept);
    expect(engine.getCheckpoints()).toEqual(kept);
    // A second engine on the same store resumes from what the first one kept.
    const second = engineWith(chain, { ...run, checkpointStore: store });
    expect(second.restoreCheckpoint("c")).toEqual({ input: { n: 1 }, variables: {}, history: ["start", "b"] });
  });

  it("ends the run when a checkpoint cannot be kept", async () => {
    const store: CheckpointStore = {
      append: () => {
        throw new Error("disk full");
      },
      list: () => [],
    };
    const result = await engineWith(chain, { ...run, checkpointStore: store }).execute();
    expect(result.status).toBe("failed");
    expect(result.error).toBe("checkpoint_not_persisted: disk full");
    expect(result.history.map((h) => h.nodeId)).toEqual(["start"]);
  });

  it("gives no checkpoints in a result when the store cannot be read", async () => {
    const store: CheckpointStore = {
      append: () => undefined,
      list: () => {
        throw new Error("unreadable");
      },
    };
    const engine = engineWith(chain, { ...run, checkpointStore: store });
    const result = await engine.execute();
    expect(result.status).toBe("completed");
    expect(result.checkpoints).toEqual([]);
    expect(() => engine.getCheckpoints()).toThrow(/unreadable/);
  });

  it("the volatile store keeps copies, so a caller cannot change what is kept", () => {
    const store = new VolatileCheckpointStore();
    const checkpoint: GraphCheckpoint = {
      nodeId: "a",
      timestamp: 1,
      context: { input: { n: 1 }, variables: {}, history: ["x"] },
      vectorClock: { e: 1 },
    };
    store.append(checkpoint);
    checkpoint.context.history.push("changed");
    for (const listed of store.list()) listed.vectorClock.e = 99;
    expect(store.list()).toEqual([
      { nodeId: "a", timestamp: 1, context: { input: { n: 1 }, variables: {}, history: ["x"] }, vectorClock: { e: 1 } },
    ]);
  });

  it("the Lattice Memory store needs a run id and a program", () => {
    const { program } = fakeProgram();
    expect(() => new LatticeMemoryCheckpointStore({ runId: "", program })).toThrow(/runId is required/);
    expect(
      () => new LatticeMemoryCheckpointStore({ runId: "r", program: undefined as unknown as MemoryProgram }),
    ).toThrow(/program is required/);
    expect(GRAPH_CHECKPOINT_DOMAIN).toBe("graph");
  });

  it("the Lattice Memory store writes one record per checkpoint and reads a run back", async () => {
    const { program, records } = fakeProgram();
    const first = engineWith(chain, {
      ...run,
      checkpointStore: new LatticeMemoryCheckpointStore({ runId: "run-1", program }),
    });
    const result = await first.execute({ input: { n: 1, nested: { a: [1, 2] } } });
    expect(result.status).toBe("completed");
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.element_id)).toEqual(["run-1", "run-1", "run-1"]);
    expect(records.map((r) => r.domain)).toEqual(["graph", "graph", "graph"]);
    expect(records.map((r) => r.result)).toEqual(["accepted", "accepted", "accepted"]);
    expect(records.map((r) => (r.labels as Record<string, string>).node_id)).toEqual(["start", "b", "c"]);
    expect(records[2]?.shape).toEqual({ kind: "graph_checkpoint", node_id: "c", history: ["start", "b"] });
    expect(new Set(records.map((r) => r.id)).size).toBe(3);
    // Another engine on the same run, as after a restart, reads the checkpoints back.
    const second = engineWith(chain, {
      ...run,
      checkpointStore: new LatticeMemoryCheckpointStore({ runId: "run-1", program }),
    });
    expect(second.getCheckpoints()).toEqual(result.checkpoints);
    expect(second.restoreCheckpoint("c")).toEqual({
      input: { n: 1, nested: { a: [1, 2] } },
      variables: {},
      history: ["start", "b"],
    });
    // Another run in the same store has checkpoints of its own.
    expect(new LatticeMemoryCheckpointStore({ runId: "run-2", program }).list()).toEqual([]);
  });

  it("the Lattice Memory store skips records that hold no checkpoint", () => {
    const program: MemoryProgram = () => [
      { body: null },
      { body: { nodeId: "a" } },
      "text",
      { body: { nodeId: "a", timestamp: 2, context: { input: {}, variables: {}, history: [] }, vectorClock: {} } },
    ];
    const store = new LatticeMemoryCheckpointStore({ runId: "run-1", program });
    expect(store.list().map((c) => c.nodeId)).toEqual(["a"]);
    const none: MemoryProgram = () => null;
    expect(new LatticeMemoryCheckpointStore({ runId: "run-1", program: none }).list()).toEqual([]);
  });

  it("a program that fails ends the run and names the failure", async () => {
    const program: MemoryProgram = () => {
      throw new Error("aep-lattice-memory record failed: no such file");
    };
    const engine = engineWith(chain, {
      ...run,
      checkpointStore: new LatticeMemoryCheckpointStore({ runId: "run-1", program }),
    });
    const result = await engine.execute();
    expect(result.status).toBe("failed");
    expect(result.error).toBe("checkpoint_not_persisted: aep-lattice-memory record failed: no such file");
  });
});
