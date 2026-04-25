import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { LedgerEntry, LedgerEntryType, LedgerReport, TokenUsage, CostRecord } from "./types.js";

const ZERO_HASH =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";

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
    this.sessionId = options.sessionId;
    this.stateProvider = options.stateProvider;
    this.filePath = join(this.dir, `${this.sessionId}.jsonl`);

    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }

    // If file already exists, load the chain state
    if (existsSync(this.filePath)) {
      const existing = this.entries();
      if (existing.length > 0) {
        const last = existing[existing.length - 1];
        this.seq = last.seq;
        this.prevHash = last.hash;
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
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as LedgerEntry);
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
    const payload = prevHash + type + JSON.stringify(data);
    const sha = createHash("sha256").update(payload).digest("hex");
    return `sha256:${sha}`;
  }
}
