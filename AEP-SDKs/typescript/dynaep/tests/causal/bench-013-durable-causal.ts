// @PAD: /root/dynAEP/sdk/typescript/tests/causal/bench-013-durable-causal.ts
// ===========================================================================
// @dynaep/core - bench-013: Durable Causal Store Performance Benchmark
// TA-3.1: Measures write throughput, read latency, compaction time, and
// recovery time for the file-based durable causal store.
// ===========================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileBasedCausalStore } from "../../src/causal/FileBasedCausalStore";
import type { BufferedEvent, AgentRegistration } from "../../src/causal/DurableCausalStore";

// ---------------------------------------------------------------------------
// Benchmark Harness
// ---------------------------------------------------------------------------

interface BenchResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  opsPerSec: number;
}

const results: BenchResult[] = [];

function bench(name: string, iterations: number, fn: () => void): void {
  // Warmup
  for (let i = 0; i < Math.min(10, iterations); i++) {
    fn();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const totalMs = performance.now() - start;
  const avgMs = totalMs / iterations;
  const opsPerSec = (iterations / totalMs) * 1000;

  results.push({ name, iterations, totalMs, avgMs, opsPerSec });
}

async function benchAsync(name: string, iterations: number, fn: () => Promise<void>): Promise<void> {
  // Warmup
  for (let i = 0; i < Math.min(5, iterations); i++) {
    await fn();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  const totalMs = performance.now() - start;
  const avgMs = totalMs / iterations;
  const opsPerSec = (iterations / totalMs) * 1000;

  results.push({ name, iterations, totalMs, avgMs, opsPerSec });
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dynaep-bench-013-"));
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Helper: Generate test data
// ---------------------------------------------------------------------------

function generateVectorClocks(partitionCount: number, agentsPerPartition: number): Map<string, Record<string, number>> {
  const clocks = new Map<string, Record<string, number>>();
  for (let p = 0; p < partitionCount; p++) {
    const agents: Record<string, number> = {};
    for (let a = 0; a < agentsPerPartition; a++) {
      agents[`agent-${a}`] = Math.floor(Math.random() * 10000);
    }
    clocks.set(`partition-${p}`, agents);
  }
  return clocks;
}

function generateAgentRegistry(count: number): Map<string, AgentRegistration> {
  const agents = new Map<string, AgentRegistration>();
  for (let i = 0; i < count; i++) {
    const agentId = `agent-${i}`;
    agents.set(agentId, {
      agentId,
      registeredAt: Date.now() - Math.floor(Math.random() * 100000),
      lastSequence: Math.floor(Math.random() * 10000),
      lastEventId: `evt-${Math.random().toString(36).slice(2, 10)}`,
      capabilities: ["read", "write", "execute"],
    });
  }
  return agents;
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== bench-013: Durable Causal Store Performance ===\n");

  // --- Benchmark 1: Vector clock save throughput ---
  {
    const dir = createTempDir();
    const store = new FileBasedCausalStore({ path: dir, flushIntervalMs: 0 });
    const clocks = generateVectorClocks(8, 4);

    await benchAsync("saveVectorClocks (8 partitions, 4 agents each)", 1000, async () => {
      await store.saveVectorClocks(clocks);
    });

    await store.close();
    cleanupDir(dir);
  }

  // --- Benchmark 2: Vector clock load latency ---
  {
    const dir = createTempDir();
    const store = new FileBasedCausalStore({ path: dir, flushIntervalMs: 0 });
    const clocks = generateVectorClocks(8, 4);
    await store.saveVectorClocks(clocks);
    await store.compact();

    await benchAsync("loadVectorClocks (from snapshot)", 1000, async () => {
      // Create new store to force reload
      const loadStore = new FileBasedCausalStore({ path: dir, flushIntervalMs: -1 });
      await loadStore.loadVectorClocks();
      await loadStore.close();
    });

    await store.close();
    cleanupDir(dir);
  }

  // --- Benchmark 3: Causal position save throughput ---
  {
    const dir = createTempDir();
    const store = new FileBasedCausalStore({ path: dir, flushIntervalMs: 0 });

    await benchAsync("saveCausalPosition", 5000, async () => {
      await store.saveCausalPosition(Math.floor(Math.random() * 100000));
    });

    await store.close();
    cleanupDir(dir);
  }

  // --- Benchmark 4: Agent registry save/load ---
  {
    const dir = createTempDir();
    const store = new FileBasedCausalStore({ path: dir, flushIntervalMs: 0 });
    const agents = generateAgentRegistry(20);

    await benchAsync("saveAgentRegistry (20 agents)", 500, async () => {
      await store.saveAgentRegistry(agents);
    });

    await store.compact();

    await benchAsync("loadAgentRegistry (20 agents, from snapshot)", 500, async () => {
      const loadStore = new FileBasedCausalStore({ path: dir, flushIntervalMs: -1 });
      await loadStore.loadAgentRegistry();
      await loadStore.close();
    });

    await store.close();
    cleanupDir(dir);
  }

  // --- Benchmark 5: Compaction time ---
  {
    const dir = createTempDir();
    const store = new FileBasedCausalStore({ path: dir, flushIntervalMs: 0 });

    // Write 500 entries to append log
    for (let i = 0; i < 500; i++) {
      await store.saveCausalPosition(i);
      if (i % 50 === 0) {
        await store.saveVectorClocks(generateVectorClocks(4, 2));
      }
    }

    await benchAsync("compact (500 append entries)", 50, async () => {
      await store.compact();
      // Re-populate for next iteration
      for (let i = 0; i < 10; i++) {
        await store.saveCausalPosition(i);
      }
    });

    await store.close();
    cleanupDir(dir);
  }

  // --- Benchmark 6: Recovery time (snapshot + append log replay) ---
  {
    const dir = createTempDir();
    const store = new FileBasedCausalStore({ path: dir, flushIntervalMs: 0 });

    // Create snapshot with 8 partitions
    await store.saveVectorClocks(generateVectorClocks(8, 4));
    await store.saveAgentRegistry(generateAgentRegistry(10));
    await store.saveCausalPosition(5000);
    await store.compact();

    // Write 100 append entries after snapshot
    for (let i = 0; i < 100; i++) {
      await store.saveCausalPosition(5000 + i);
    }

    await store.close();

    await benchAsync("recovery (snapshot + 100 append entries)", 200, async () => {
      const recoveryStore = new FileBasedCausalStore({ path: dir, flushIntervalMs: -1 });
      await recoveryStore.loadVectorClocks();
      await recoveryStore.loadCausalPosition();
      await recoveryStore.loadAgentRegistry();
      await recoveryStore.close();
    });

    cleanupDir(dir);
  }

  // --- Benchmark 7: State age check ---
  {
    const dir = createTempDir();
    const store = new FileBasedCausalStore({ path: dir, flushIntervalMs: 0 });
    await store.saveCausalPosition(1);
    await store.compact();

    await benchAsync("getStateAge", 2000, async () => {
      await store.getStateAge();
    });

    await store.close();
    cleanupDir(dir);
  }

  // --- Print Results ---
  console.log("\n--- Results ---\n");
  console.log(
    "Benchmark".padEnd(55) +
    "Iters".padStart(8) +
    "Total(ms)".padStart(12) +
    "Avg(ms)".padStart(12) +
    "ops/sec".padStart(12),
  );
  console.log("-".repeat(99));

  for (const r of results) {
    console.log(
      r.name.padEnd(55) +
      String(r.iterations).padStart(8) +
      r.totalMs.toFixed(1).padStart(12) +
      r.avgMs.toFixed(3).padStart(12) +
      r.opsPerSec.toFixed(0).padStart(12),
    );
  }

  console.log("\n=== bench-013 complete ===");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
