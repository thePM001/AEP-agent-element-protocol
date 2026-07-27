// @PAD: p0-v275-h20-ledger-parse-safe-v1
// @GCDE: document_sha256=p0-v275-h20-ledger
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { LedgerEntry, LedgerEntryType, LedgerReport, TokenUsage, CostRecord } from "./types.js";

const ZERO_HASH =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";

/** BL-01: recursive key-sorted canonicalize for ledger hash chain. */
function deepCanonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCanonicalize);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      ordered[key] = deepCanonicalize(obj[key]);
    }
    return ordered;
  }
  return value;
}

const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

export class EvidenceLedger {
  private dir: string;
  private sessionId: string;
  private filePath: string;
  private seq: number = 0;
  private prevHash: string = ZERO_HASH;
  private stateProvider?: () => Record<string, unknown>;

  constructor(options: {
    dir: string;
    sessionId: string;
    stateProvider?: () => Record<string, unknown>;
  }) {
    this.dir = options.dir;
    if (!SAFE_SESSION_ID.test(options.sessionId)) {
      throw new Error("invalid sessionId: must match [A-Za-z0-9._-]+");
    }
    this.sessionId = options.sessionId;
    this.stateProvider = options.stateProvider;
    this.filePath = join(this.dir, `${this.sessionId}.jsonl`);

    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }

    // If file already exists, load the chain state
    if (existsSync(this.filePath)) {
      try {
        const existing = this.entries();
        if (existing.length > 0) {
          const last = existing[existing.length - 1];
          this.seq = last.seq;
          this.prevHash = last.hash;
        }
      } catch (e) {
        // HIGH: do not silently reset tip over a non-empty corrupt file
        throw new Error(
          `evidence ledger load failed for session ${this.sessionId}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  append(
    type: LedgerEntryType,
    data: Record<string, unknown>,
    options?: { tokens?: TokenUsage; cost?: CostRecord }
  ): LedgerEntry {
    this.seq++;
    const ts = new Date().toISOString();
    const hash = this.computeHash(this.prevHash, type, data);

    let stateRef: string | undefined;
    if (this.stateProvider) {
      const state = this.stateProvider();
      stateRef = `sha256:${createHash("sha256").update(JSON.stringify(state)).digest("hex")}`;
    }

    const entry: LedgerEntry = {
      seq: this.seq,
      ts,
      hash,
      prev: this.prevHash,
      type,
      data,
      ...(stateRef ? { stateRef } : {}),
      ...(options?.tokens ? { tokens: options.tokens } : {}),
      ...(options?.cost ? { cost: options.cost } : {}),
    };

    appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf-8");
    this.prevHash = hash;
    return entry;
  }

  verify(): { valid: boolean; brokenAt?: number } {
    const allEntries = this.entries();
    if (allEntries.length === 0) {
      return { valid: true };
    }

    let expectedPrev = ZERO_HASH;
    for (const entry of allEntries) {
      if (entry.prev !== expectedPrev) {
        return { valid: false, brokenAt: entry.seq };
      }
      const expectedHash = this.computeHash(
        entry.prev,
        entry.type,
        entry.data
      );
      if (entry.hash !== expectedHash) {
        return { valid: false, brokenAt: entry.seq };
      }
      expectedPrev = entry.hash;
    }

    return { valid: true };
  }

  entries(): LedgerEntry[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    const content = readFileSync(this.filePath, "utf-8").trim();
    if (!content) return [];
    const out: LedgerEntry[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as LedgerEntry); } catch { /* H-20 skip bad line */ }
    }
    return out;
  }

  report(): LedgerReport {
    const all = this.entries();
    const actionCounts: Record<string, number> = {};
    for (const entry of all) {
      actionCounts[entry.type] = (actionCounts[entry.type] ?? 0) + 1;
    }

    const verification = this.verify();

    return {
      sessionId: this.sessionId,
      entryCount: all.length,
      timeRange:
        all.length > 0
          ? { first: all[0].ts, last: all[all.length - 1].ts }
          : null,
      actionCounts,
      chainValid: verification.valid,
    };
  }

  private computeHash(
    prevHash: string,
    type: string,
    data: Record<string, unknown>
  ): string {
    // BL-01: deep-canonical JSON for hash chain stability
    const payload = prevHash + type + JSON.stringify(deepCanonicalize(data));
    const sha = createHash("sha256").update(payload).digest("hex");
    return `sha256:${sha}`;
  }
}
