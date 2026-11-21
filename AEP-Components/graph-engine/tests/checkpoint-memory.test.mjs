// The checkpoint store of the Graph Engine on the program of Lattice Memory: a run
// persists and another engine reads it back. The program is built by the Rust
// workspace. Without it this file has nothing to run.

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LatticeMemoryCheckpointStore, createGraphEngine } from "../lib/graph/index.ts";
import { memoryProgram } from "../../intent-ledger/lib/intent-knots.mjs";

const PROGRAM =
  process.env.AEP_LATTICE_MEMORY_CLI ?? resolve(process.cwd(), "rust/target/release/aep-lattice-memory");

const NODES = [
  { id: "start", type: "action", next: ["b"] },
  { id: "b", type: "action", next: ["c"] },
  { id: "c", type: "action", next: [] },
];

function engineOn(store) {
  const engine = createGraphEngine({
    admitGate: async () => true,
    nodeExecutor: async (node) => ({ ok: node.id }),
    checkpointStore: store,
  });
  for (const node of NODES) engine.addNode(node);
  return engine;
}

describe("Graph Engine checkpoints in Lattice Memory", () => {
  it.skipIf(!existsSync(PROGRAM))("a run persists and another engine reads it back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aep-graph-"));
    try {
      const storeDir = join(dir, "lattice-memory");
      const program = memoryProgram(PROGRAM, storeDir);
      const first = engineOn(new LatticeMemoryCheckpointStore({ runId: "run-1", program }));
      const result = await first.execute({ input: { n: 1, nested: { a: [1, 2] } } });
      expect(result.status).toBe("completed");
      expect(result.checkpoints.map((c) => c.nodeId)).toEqual(["start", "b", "c"]);
      expect(readdirSync(storeDir)).toContain("graph.lmlog");

      const second = engineOn(new LatticeMemoryCheckpointStore({ runId: "run-1", program }));
      expect(second.getCheckpoints()).toEqual(result.checkpoints);
      expect(second.restoreCheckpoint("c")).toEqual({
        input: { n: 1, nested: { a: [1, 2] } },
        variables: {},
        history: ["start", "b"],
      });
      expect(new LatticeMemoryCheckpointStore({ runId: "run-2", program }).list()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a program that is not there ends the run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aep-graph-"));
    try {
      const program = memoryProgram(join(dir, "absent-program"), join(dir, "lattice-memory"));
      const engine = engineOn(new LatticeMemoryCheckpointStore({ runId: "run-1", program }));
      const result = await engine.execute();
      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/^checkpoint_not_persisted: /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
