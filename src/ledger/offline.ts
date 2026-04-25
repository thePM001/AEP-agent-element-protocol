import { createHash } from "node:crypto";
import type { LedgerEntry, LedgerEntryType } from "./types.js";

export interface OfflineEntry {
  seq: number;
  ts: string;
  type: LedgerEntryType;
  data: Record<string, unknown>;
  localHash: string;
  prevLocalHash: string;
}

export class OfflineLedger {
  private queue: OfflineEntry[] = [];
  private prevHash: string = "offline:0000";
  private seq: number = 0;

  append(type: LedgerEntryType, data: Record<string, unknown>): OfflineEntry {
    this.seq++;
    const ts = new Date().toISOString();
    const payload = this.prevHash + type + JSON.stringify(data);
    const localHash = "offline:" + createHash("sha256").update(payload).digest("hex");

    const entry: OfflineEntry = {
      seq: this.seq,
      ts,
      type,
      data,
      localHash,
      prevLocalHash: this.prevHash,
    };

    this.queue.push(entry);
    this.prevHash = localHash;
    return entry;
  }

  getQueue(): OfflineEntry[] {
    return [...this.queue];
  }

  clear(): void {
    this.queue = [];
  }

  verifyLocalChain(): boolean {
    let prevHash = "offline:0000";
    for (const entry of this.queue) {
      if (entry.prevLocalHash !== prevHash) return false;
      const payload = entry.prevLocalHash + entry.type + JSON.stringify(entry.data);
      const expected = "offline:" + createHash("sha256").update(payload).digest("hex");
      if (entry.localHash !== expected) return false;
      prevHash = entry.localHash;
    }
    return true;
  }

  size(): number {
    return this.queue.length;
  }
}
