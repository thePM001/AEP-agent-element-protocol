// Where the checkpoints of a graph run are kept.
//
// The engine holds no checkpoint itself. It hands every checkpoint to a store and
// reads them back from it. Two stores ship: one that lives in the process and one
// that persists to Lattice Memory, so a run can be resumed after a restart.
import type { CheckpointStore, GraphCheckpoint } from "./types.js";

/** Checkpoints of a graph run are records of this domain of Lattice Memory. */
export const GRAPH_CHECKPOINT_DOMAIN = "graph";
export const GRAPH_CHECKPOINT_KIND = "graph_checkpoint";

/**
 * A store that lives in the process. Its checkpoints end with the process, so it
 * serves tests and runs that need no resume after a restart.
 */
export class VolatileCheckpointStore implements CheckpointStore {
  private kept: GraphCheckpoint[] = [];

  append(checkpoint: GraphCheckpoint): void {
    this.kept.push(copyCheckpoint(checkpoint));
  }

  list(): GraphCheckpoint[] {
    return this.kept.map(copyCheckpoint);
  }
}

/**
 * One command of the program of Lattice Memory on one store: the command name and
 * its request go in, the answer of the program comes out. A command that fails
 * throws. The engine starts no program itself. A deployment hands in this function,
 * such as `memoryProgram` of `AEP-Components/intent-ledger/lib/intent-knots.mjs`.
 */
export type MemoryProgram = (command: "record" | "history", request: unknown) => unknown;

export interface LatticeMemoryCheckpointStoreOptions {
  /** Id of the run. The checkpoints of one run are the history of this element. */
  runId: string;
  /** Runs one command of the program of Lattice Memory on the store of the node. */
  program: MemoryProgram;
}

/**
 * A store that persists every checkpoint as one record of Lattice Memory. The
 * record holds the checkpoint as its body, the node as a label and the path through
 * the graph as its shape. A second engine that opens the same run reads the
 * checkpoints back, also in another process.
 */
export class LatticeMemoryCheckpointStore implements CheckpointStore {
  private readonly runId: string;
  private readonly program: MemoryProgram;
  private serial = 0;

  constructor(options: LatticeMemoryCheckpointStoreOptions) {
    if (!options.runId) throw new Error("checkpoint store: runId is required");
    if (typeof options.program !== "function") throw new Error("checkpoint store: program is required");
    this.runId = options.runId;
    this.program = options.program;
  }

  append(checkpoint: GraphCheckpoint): void {
    this.serial += 1;
    this.program("record", {
      id: `cp-${this.runId}-${checkpoint.timestamp}-${this.serial}-${checkpoint.nodeId}`,
      element_id: this.runId,
      domain: GRAPH_CHECKPOINT_DOMAIN,
      result: "accepted",
      timestamp: checkpoint.timestamp,
      shape: {
        kind: GRAPH_CHECKPOINT_KIND,
        node_id: checkpoint.nodeId,
        history: checkpoint.context.history,
      },
      labels: { kind: GRAPH_CHECKPOINT_KIND, node_id: checkpoint.nodeId },
      body: checkpoint,
    });
  }

  list(): GraphCheckpoint[] {
    const records = this.program("history", {
      domain: GRAPH_CHECKPOINT_DOMAIN,
      element_id: this.runId,
      limit: 1_000_000,
    });
    if (!Array.isArray(records)) return [];
    const kept: GraphCheckpoint[] = [];
    for (const record of records) {
      const body = isRecord(record) ? record.body : undefined;
      if (isCheckpoint(body)) kept.push(copyCheckpoint(body));
    }
    return kept;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCheckpoint(value: unknown): value is GraphCheckpoint {
  if (!isRecord(value)) return false;
  const context = value.context;
  return (
    typeof value.nodeId === "string" &&
    typeof value.timestamp === "number" &&
    isRecord(value.vectorClock) &&
    isRecord(context) &&
    isRecord(context.input) &&
    isRecord(context.variables) &&
    Array.isArray(context.history)
  );
}

function copyCheckpoint(checkpoint: GraphCheckpoint): GraphCheckpoint {
  return {
    nodeId: checkpoint.nodeId,
    timestamp: checkpoint.timestamp,
    context: {
      input: { ...checkpoint.context.input },
      variables: { ...checkpoint.context.variables },
      history: [...checkpoint.context.history],
    },
    vectorClock: { ...checkpoint.vectorClock },
  };
}
