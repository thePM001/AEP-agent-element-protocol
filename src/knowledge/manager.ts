// AEP 2.5 -- Knowledge Base Manager
// Creates, ingests into and queries governed knowledge bases.
// Storage: .aep/knowledge/<name>/chunks.jsonl

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { KnowledgeIngestor } from "./ingest.js";
import { GovernedRetriever } from "./retriever.js";
import { ScannerPipeline, createDefaultPipeline } from "../scanners/pipeline.js";
import type {
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeBaseSummary,
  IngestReport,
  KnowledgeQueryOptions,
} from "./types.js";
import type { CovenantSpec } from "../covenant/types.js";
import type { EvidenceLedger } from "../ledger/ledger.js";

export class KnowledgeBaseManager {
  private baseDir: string;
  private pipeline: ScannerPipeline;
  private covenant: CovenantSpec | null;
  private ledger: EvidenceLedger | null;
  private bases: Map<string, KnowledgeBase> = new Map();

  constructor(options?: {
    baseDir?: string;
    pipeline?: ScannerPipeline;
    covenant?: CovenantSpec;
    ledger?: EvidenceLedger;
  }) {
    this.baseDir = options?.baseDir ?? join(process.cwd(), ".aep", "knowledge");
    this.pipeline = options?.pipeline ?? createDefaultPipeline();
    this.covenant = options?.covenant ?? null;
    this.ledger = options?.ledger ?? null;
  }

  /**
   * Create a new knowledge base.
   */
  create(name: string): KnowledgeBase {
    const kb: KnowledgeBase = {
      name,
      chunks: [],
      version: "1",
    };

    // Persist directory
    const dir = this.kbDir(name);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write metadata
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({ name, version: "1", createdAt: new Date().toISOString() }, null, 2) + "\n"
    );

    this.bases.set(name, kb);
    return kb;
  }

  /**
   * Ingest a file into a knowledge base.
   */
  ingestFile(
    kbName: string,
    filePath: string,
    chunkSize?: number
  ): IngestReport {
    const content = readFileSync(filePath, "utf-8");
    return this.ingestText(kbName, content, filePath, chunkSize);
  }

  /**
   * Ingest raw text into a knowledge base.
   */
  ingestText(
    kbName: string,
    text: string,
    source: string,
    chunkSize?: number
  ): IngestReport {
    const kb = this.getOrLoad(kbName);
    const ingestor = new KnowledgeIngestor(this.pipeline);
    const { chunks, report } = ingestor.ingest(
      text,
      source,
      chunkSize,
      this.ledger ?? undefined
    );

    // Add validated/flagged chunks to the KB
    for (const chunk of chunks) {
      kb.chunks.push(chunk);
      this.appendChunk(kbName, chunk);
    }

    this.bases.set(kbName, kb);
    return report;
  }

  /**
   * Query a knowledge base with governed retrieval.
   */
  query(
    kbName: string,
    query: string,
    options?: KnowledgeQueryOptions
  ): KnowledgeChunk[] {
    const kb = this.getOrLoad(kbName);
    const retriever = new GovernedRetriever(
      kb,
      this.covenant ?? undefined,
      this.pipeline
    );
    return retriever.retrieve(query, options, this.ledger ?? undefined);
  }

  /**
   * Get statistics for a knowledge base.
   */
  stats(kbName: string): { total: number; validated: number; flagged: number; rejected: number } {
    const kb = this.getOrLoad(kbName);
    const validated = kb.chunks.filter((c) => c.validated).length;
    const flagged = kb.chunks.filter((c) => !c.validated).length;
    return {
      total: kb.chunks.length,
      validated,
      flagged,
      rejected: 0, // Rejected chunks are not stored
    };
  }

  /**
   * List all knowledge bases.
   */
  list(): KnowledgeBaseSummary[] {
    if (!existsSync(this.baseDir)) return [];

    const dirs = readdirSync(this.baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    return dirs.map((name) => {
      const kb = this.getOrLoad(name);
      return {
        name: kb.name,
        version: kb.version,
        total: kb.chunks.length,
        validated: kb.chunks.filter((c) => c.validated).length,
        flagged: kb.chunks.filter((c) => !c.validated).length,
      };
    });
  }

  /**
   * Get or load a knowledge base from disk.
   */
  private getOrLoad(name: string): KnowledgeBase {
    const cached = this.bases.get(name);
    if (cached) return cached;

    const dir = this.kbDir(name);
    const metaPath = join(dir, "meta.json");
    const chunksPath = join(dir, "chunks.jsonl");

    if (!existsSync(metaPath)) {
      throw new Error(`Knowledge base "${name}" not found.`);
    }

    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    const chunks: KnowledgeChunk[] = [];

    if (existsSync(chunksPath)) {
      const lines = readFileSync(chunksPath, "utf-8")
        .split("\n")
        .filter((l) => l.trim());
      for (const line of lines) {
        try {
          chunks.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }
    }

    const kb: KnowledgeBase = {
      name: meta.name ?? name,
      chunks,
      version: meta.version ?? "1",
    };

    this.bases.set(name, kb);
    return kb;
  }

  /**
   * Append a chunk to the JSONL storage file.
   */
  private appendChunk(kbName: string, chunk: KnowledgeChunk): void {
    const dir = this.kbDir(kbName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(
      join(dir, "chunks.jsonl"),
      JSON.stringify(chunk) + "\n"
    );
  }

  private kbDir(name: string): string {
    return join(this.baseDir, name);
  }
}
