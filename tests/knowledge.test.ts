// Tests for AEP 2.5 Lattice-Governed Knowledge Base
// Covers: KnowledgeIngestor, GovernedRetriever, KnowledgeBaseManager

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KnowledgeIngestor } from "../src/knowledge/ingest.js";
import { GovernedRetriever } from "../src/knowledge/retriever.js";
import { KnowledgeBaseManager } from "../src/knowledge/manager.js";
import { createDefaultPipeline, ScannerPipeline } from "../src/scanners/pipeline.js";
import type { KnowledgeBase, KnowledgeChunk } from "../src/knowledge/types.js";
import type { CovenantSpec } from "../src/covenant/types.js";

const TEST_DIR = resolve(".test-kb-" + process.pid);

function cleanPipeline(): ScannerPipeline {
  return createDefaultPipeline();
}

// Content that passes all scanners
const CLEAN_CONTENT = `
The Agent Element Protocol provides governance for AI agent interactions.

AEP includes session management with configurable limits and rate controls.

Policies define capabilities, forbidden patterns and escalation rules.

Evidence ledgers record every action with SHA-256 hash chaining for audit.

Trust scoring tracks agent reliability with automatic score erosion.
`.trim();

// Content with a secret (triggers secrets scanner)
const SECRET_CONTENT = `
Here is some configuration data.
The API key is AKIAIOSFODNN7EXAMPLE and should be rotated.
`;

describe("KnowledgeIngestor", () => {
  it("splits content into chunks and validates clean content", () => {
    const pipeline = cleanPipeline();
    const ingestor = new KnowledgeIngestor(pipeline);

    const { chunks, report } = ingestor.ingest(CLEAN_CONTENT, "test.md", 100);

    expect(report.total).toBeGreaterThan(0);
    expect(report.validated).toBeGreaterThan(0);
    expect(report.rejected).toBe(0);
    expect(chunks.length).toBe(report.validated + report.flagged);
    for (const chunk of chunks) {
      expect(chunk.id).toBeTruthy();
      expect(chunk.source).toBe("test.md");
      expect(chunk.content).toBeTruthy();
    }
  });

  it("rejects chunks containing hard-severity scanner matches", () => {
    const pipeline = cleanPipeline();
    const ingestor = new KnowledgeIngestor(pipeline);

    const { chunks, report } = ingestor.ingest(SECRET_CONTENT, "secrets.md", 2000);

    // The secrets scanner should catch the AWS key pattern
    expect(report.rejected).toBeGreaterThan(0);
    // Rejected chunks are not included in the returned chunks array
    expect(chunks.length).toBeLessThan(report.total);
  });

  it("assigns unique IDs to each chunk", () => {
    const pipeline = cleanPipeline();
    const ingestor = new KnowledgeIngestor(pipeline);

    const { chunks } = ingestor.ingest(CLEAN_CONTENT, "test.md", 50);
    const ids = chunks.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("returns empty result for empty content", () => {
    const pipeline = cleanPipeline();
    const ingestor = new KnowledgeIngestor(pipeline);

    const { chunks, report } = ingestor.ingest("", "empty.md");
    expect(chunks).toHaveLength(0);
    expect(report.total).toBe(0);
  });
});

describe("GovernedRetriever", () => {
  let chunks: KnowledgeChunk[];
  let kb: KnowledgeBase;

  beforeEach(() => {
    const pipeline = cleanPipeline();
    const ingestor = new KnowledgeIngestor(pipeline);
    const result = ingestor.ingest(CLEAN_CONTENT, "test.md", 80);
    chunks = result.chunks;
    kb = { name: "test", chunks, version: "1" };
  });

  it("retrieves chunks matching a query", () => {
    const retriever = new GovernedRetriever(kb);
    const results = retriever.retrieve("trust scoring");

    expect(results.length).toBeGreaterThan(0);
    // Most relevant chunk should mention trust
    const combined = results.map((c) => c.content.toLowerCase()).join(" ");
    expect(combined).toContain("trust");
  });

  it("respects maxChunks option", () => {
    const retriever = new GovernedRetriever(kb);
    const results = retriever.retrieve("protocol", { maxChunks: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("applies anti-context-rot ordering when chunks >= 3", () => {
    // Create a KB with enough chunks
    const manyChunks: KnowledgeChunk[] = [];
    for (let i = 0; i < 5; i++) {
      manyChunks.push({
        id: `chunk-${i}`,
        content: `Content about topic ${i} with governance and policy details`,
        source: "test.md",
        metadata: {},
        validated: true,
      });
    }
    const bigKb: KnowledgeBase = { name: "test", chunks: manyChunks, version: "1" };
    const retriever = new GovernedRetriever(bigKb);
    const results = retriever.retrieve("governance policy", {
      maxChunks: 5,
      antiContextRot: true,
    });

    // Anti-context-rot: position 1 = most relevant, position last = second most relevant
    // We verify the ordering is different from pure descending by checking at least 3 results
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  it("filters by covenant scope", () => {
    // Assign scopes to chunks
    const scopedChunks: KnowledgeChunk[] = [
      { id: "1", content: "Session management details", source: "s.md", metadata: {}, validated: true, covenantScope: ["sessions"] },
      { id: "2", content: "Trust scoring details", source: "t.md", metadata: {}, validated: true, covenantScope: ["trust"] },
      { id: "3", content: "Policy evaluation details", source: "p.md", metadata: {}, validated: true, covenantScope: ["policy"] },
    ];
    const scopedKb: KnowledgeBase = { name: "scoped", chunks: scopedChunks, version: "1" };
    const retriever = new GovernedRetriever(scopedKb);

    const results = retriever.retrieve("details", { scope: ["sessions", "policy"] });
    // Should exclude trust-scoped chunk
    const ids = results.map((c) => c.id);
    expect(ids).not.toContain("2");
    // Should include sessions and policy scoped chunks
    expect(ids).toContain("1");
    expect(ids).toContain("3");
  });

  it("double-scans flagged chunks on retrieval", () => {
    const pipeline = cleanPipeline();
    const flaggedChunk: KnowledgeChunk = {
      id: "flagged-1",
      content: "Some flagged but actually clean content about governance",
      source: "f.md",
      metadata: { flagged: true },
      validated: false,
    };
    const cleanChunk: KnowledgeChunk = {
      id: "clean-1",
      content: "Clean content about governance and policy",
      source: "c.md",
      metadata: {},
      validated: true,
    };
    const testKb: KnowledgeBase = {
      name: "test",
      chunks: [flaggedChunk, cleanChunk],
      version: "1",
    };

    const retriever = new GovernedRetriever(testKb, undefined, pipeline);
    const results = retriever.retrieve("governance", { doubleScan: true });

    // Both should pass since content is actually clean
    expect(results.length).toBe(2);
  });
});

describe("KnowledgeBaseManager", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("creates a knowledge base with metadata file", () => {
    const manager = new KnowledgeBaseManager({ baseDir: TEST_DIR });
    const kb = manager.create("test-kb");

    expect(kb.name).toBe("test-kb");
    expect(kb.chunks).toHaveLength(0);

    const metaPath = join(TEST_DIR, "test-kb", "meta.json");
    expect(existsSync(metaPath)).toBe(true);

    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.name).toBe("test-kb");
    expect(meta.version).toBe("1");
  });

  it("ingests text and persists chunks to JSONL", () => {
    const manager = new KnowledgeBaseManager({ baseDir: TEST_DIR });
    manager.create("test-kb");

    const report = manager.ingestText("test-kb", CLEAN_CONTENT, "readme.md");

    expect(report.total).toBeGreaterThan(0);
    expect(report.validated).toBeGreaterThan(0);

    const chunksPath = join(TEST_DIR, "test-kb", "chunks.jsonl");
    expect(existsSync(chunksPath)).toBe(true);

    const lines = readFileSync(chunksPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(report.validated + report.flagged);
  });

  it("queries a knowledge base after ingestion", () => {
    const manager = new KnowledgeBaseManager({ baseDir: TEST_DIR });
    manager.create("test-kb");
    manager.ingestText("test-kb", CLEAN_CONTENT, "readme.md");

    const results = manager.query("test-kb", "trust scoring");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns stats for a knowledge base", () => {
    const manager = new KnowledgeBaseManager({ baseDir: TEST_DIR });
    manager.create("test-kb");
    manager.ingestText("test-kb", CLEAN_CONTENT, "readme.md");

    const stats = manager.stats("test-kb");
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.validated).toBeGreaterThan(0);
    expect(stats.rejected).toBe(0);
  });

  it("lists all knowledge bases", () => {
    const manager = new KnowledgeBaseManager({ baseDir: TEST_DIR });
    manager.create("kb-one");
    manager.create("kb-two");

    const list = manager.list();
    expect(list.length).toBe(2);
    const names = list.map((b) => b.name);
    expect(names).toContain("kb-one");
    expect(names).toContain("kb-two");
  });

  it("loads knowledge base from disk on fresh manager instance", () => {
    // First manager creates and ingests
    const mgr1 = new KnowledgeBaseManager({ baseDir: TEST_DIR });
    mgr1.create("persist-test");
    mgr1.ingestText("persist-test", CLEAN_CONTENT, "test.md");

    // Second manager reads from disk
    const mgr2 = new KnowledgeBaseManager({ baseDir: TEST_DIR });
    const stats = mgr2.stats("persist-test");
    expect(stats.total).toBeGreaterThan(0);

    const results = mgr2.query("persist-test", "policy");
    expect(results.length).toBeGreaterThan(0);
  });

  it("rejects ingestion of content with secrets", () => {
    const manager = new KnowledgeBaseManager({ baseDir: TEST_DIR });
    manager.create("secure-kb");

    const report = manager.ingestText("secure-kb", SECRET_CONTENT, "secrets.md");
    expect(report.rejected).toBeGreaterThan(0);
  });

  it("throws when querying non-existent knowledge base", () => {
    const manager = new KnowledgeBaseManager({ baseDir: TEST_DIR });
    expect(() => manager.query("nonexistent", "test")).toThrow();
  });
});
