// ===========================================================================
// Base Node MemoryFabric - bridges TypeScript to Rust aep-memory CLI
// (sqlite-vec persistence + USearch fast-path in ~/.aep/action-lattice.db)
// ===========================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  AEPDomain,
  MemoryEntry,
  MemoryFabric,
  ValidationOutcome,
} from "./sdk-aep-memory";
import { InMemoryFabric } from "./sdk-aep-memory";

const DEFAULT_EMBEDDING_DIM = 128;

export interface BaseNodeMemoryOptions {
  /** Path to aep-memory binary */
  memoryCliPath?: string;
  /** SQLite lattice DB path */
  latticeDbPath?: string;
  /** base-node.json path */
  configPath?: string;
  /** Fallback in-process fabric when CLI unavailable */
  fallback?: MemoryFabric;
}

interface BaseNodeConfigFile {
  base_node?: {
    lattice_db?: string;
    binary_path?: string;
  };
}

interface MemoryMatchWire {
  entry: MemoryEntry;
  similarity: number;
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../..");
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

export function resolveMemoryCliPath(configPath?: string): string {
  if (process.env.AEP_MEMORY_CLI) {
    return process.env.AEP_MEMORY_CLI;
  }
  const candidates = [
    join(repoRoot(), "rust/target/release/aep-memory"),
    join(repoRoot(), "rust/target/debug/aep-memory"),
  ];
  if (configPath && existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8")) as BaseNodeConfigFile;
      const bin = cfg.base_node?.binary_path;
      if (bin) {
        const sibling = join(dirname(bin), "aep-memory");
        candidates.unshift(sibling);
      }
    } catch {
      /* ignore */
    }
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

export function resolveLatticeDbPath(configPath?: string): string {
  if (process.env.AEP_LATTICE_DB) {
    return expandHome(process.env.AEP_LATTICE_DB);
  }
  const path = configPath ?? join(homedir(), ".aep/base-node.json");
  if (existsSync(path)) {
    try {
      const cfg = JSON.parse(readFileSync(path, "utf8")) as BaseNodeConfigFile;
      if (cfg.base_node?.lattice_db) {
        return expandHome(cfg.base_node.lattice_db);
      }
    } catch {
      /* ignore */
    }
  }
  return join(homedir(), ".aep/action-lattice.db");
}

/** Deterministic pseudo-embedding when validators omit explicit vectors. */
export function deriveEmbedding(
  entry: Pick<MemoryEntry, "element_id" | "domain" | "proposal" | "result">,
  dim: number = DEFAULT_EMBEDDING_DIM,
): number[] {
  const seed = createHash("sha256")
    .update(
      JSON.stringify({
        element_id: entry.element_id,
        domain: entry.domain,
        proposal: entry.proposal,
        result: entry.result,
      }),
    )
    .digest();
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    out[i] = (seed[i % seed.length] / 127.5) - 1.0;
  }
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return out.map((v) => v / norm);
}

export class BaseNodeMemoryFabric implements MemoryFabric {
  private readonly cli: string;
  private readonly dbPath: string;
  private readonly fallback: MemoryFabric;
  /** When CLI record fails, stay on in-memory fallback for consistent reads. */
  private useCli = true;

  constructor(opts: BaseNodeMemoryOptions = {}) {
    const configPath = opts.configPath ?? join(homedir(), ".aep/base-node.json");
    this.cli = opts.memoryCliPath ?? resolveMemoryCliPath(configPath);
    this.dbPath = opts.latticeDbPath ?? resolveLatticeDbPath(configPath);
    this.fallback = opts.fallback ?? new InMemoryFabric();
  }

  private run<T>(command: string, input?: unknown): T {
    const args = ["--db", this.dbPath, command];
    const result = spawnSync(this.cli, args, {
      input: input ? JSON.stringify(input) : undefined,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0 || result.error) {
      throw new Error(
        result.stderr?.trim() ||
          result.stdout?.trim() ||
          result.error?.message ||
          `aep-memory ${command} failed`,
      );
    }
    const stdout = (result.stdout ?? "").trim();
    if (!stdout) {
      return undefined as T;
    }
    return JSON.parse(stdout) as T;
  }

  private withEmbedding(entry: MemoryEntry): MemoryEntry {
    if (entry.embedding && entry.embedding.length > 0) {
      return entry;
    }
    return {
      ...entry,
      embedding: deriveEmbedding(entry),
    };
  }

  record(entry: MemoryEntry): void {
    if (!this.useCli) {
      this.fallback.record(entry);
      return;
    }
    try {
      this.run<{ ok: boolean; key: number }>("record", this.withEmbedding(entry));
    } catch (err) {
      this.useCli = false;
      this.fallback.record(entry);
      if (process.env.AEP_MEMORY_STRICT === "1") {
        throw err;
      }
    }
  }

  findNearestAttractor(embedding: number[], limit: number = 5): MemoryEntry[] {
    if (!this.useCli) {
      return this.fallback.findNearestAttractor(embedding, limit);
    }
    try {
      const matches = this.run<MemoryMatchWire[]>("search", {
        embedding,
        limit,
        threshold: 0.0,
        accepted_only: false,
      });
      return matches.map((m) => m.entry);
    } catch {
      this.useCli = false;
      return this.fallback.findNearestAttractor(embedding, limit);
    }
  }

  getRejectionHistory(elementId: string): MemoryEntry[] {
    if (!this.useCli) {
      return this.fallback.getRejectionHistory(elementId);
    }
    try {
      return this.run<MemoryEntry[]>("history", {
        element_id: elementId,
        result: "rejected",
      });
    } catch {
      this.useCli = false;
      return this.fallback.getRejectionHistory(elementId);
    }
  }

  getAcceptanceHistory(elementId: string): MemoryEntry[] {
    if (!this.useCli) {
      return this.fallback.getAcceptanceHistory(elementId);
    }
    try {
      return this.run<MemoryEntry[]>("history", {
        element_id: elementId,
        result: "accepted",
      });
    } catch {
      this.useCli = false;
      return this.fallback.getAcceptanceHistory(elementId);
    }
  }

  getValidationCount(elementId: string): number {
    if (!this.useCli) {
      return this.fallback.getValidationCount(elementId);
    }
    try {
      const res = this.run<{ count: number }>("count", { element_id: elementId });
      return res.count;
    } catch {
      this.useCli = false;
      return this.fallback.getValidationCount(elementId);
    }
  }

  getFastPathHit(
    embedding: number[],
    threshold: number = 0.95,
  ): MemoryEntry | null {
    if (!this.useCli) {
      return this.fallback.getFastPathHit(embedding, threshold);
    }
    try {
      const matches = this.run<MemoryMatchWire[]>("search", {
        embedding,
        limit: 1,
        threshold,
        accepted_only: true,
      });
      return matches[0]?.entry ?? null;
    } catch {
      this.useCli = false;
      return this.fallback.getFastPathHit(embedding, threshold);
    }
  }

  exportHistory(): MemoryEntry[] {
    if (!this.useCli) {
      return this.fallback.exportHistory();
    }
    try {
      return this.run<MemoryEntry[]>("export");
    } catch {
      this.useCli = false;
      return this.fallback.exportHistory();
    }
  }

  clear(): void {
    this.fallback.clear();
  }
}

/** Prefer Base Node fabric; fall back to in-memory when CLI/binary missing. */
export function createDefaultMemoryFabric(
  opts: BaseNodeMemoryOptions = {},
): MemoryFabric {
  const cli = opts.memoryCliPath ?? resolveMemoryCliPath(opts.configPath);
  if (!existsSync(cli)) {
    return opts.fallback ?? new InMemoryFabric();
  }
  return new BaseNodeMemoryFabric(opts);
}

export function isBaseNodeMemoryAvailable(opts: BaseNodeMemoryOptions = {}): boolean {
  const cli = opts.memoryCliPath ?? resolveMemoryCliPath(opts.configPath);
  return existsSync(cli);
}