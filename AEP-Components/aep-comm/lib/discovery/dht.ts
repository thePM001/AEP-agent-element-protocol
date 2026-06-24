/**
 * Agent discovery DHT with TTL expiry and optional JSON persistence.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface DHTEntry {
  key: string;
  value: unknown;
  expiresAt: number;
}

export interface DHTLiteOptions {
  persistPath?: string;
  autosave?: boolean;
}

function defaultPersistPath(): string {
  const data = process.env.AEP_DATA || join(homedir(), ".aep");
  return join(data, "aep-comm", "dht-store.json");
}

export class DHTLite {
  private store = new Map<string, DHTEntry>();
  private persistPath: string;
  private autosave: boolean;

  constructor(options: DHTLiteOptions = {}) {
    this.persistPath = options.persistPath ?? defaultPersistPath();
    this.autosave = options.autosave ?? true;
    this.loadFromDisk();
  }

  put(key: string, value: unknown, ttlMs = 300_000): void {
    this.store.set(key, { key, value, expiresAt: Date.now() + ttlMs });
    this.saveToDisk();
  }

  get<T = unknown>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      this.saveToDisk();
      return undefined;
    }
    return entry.value as T;
  }

  delete(key: string): boolean {
    const removed = this.store.delete(key);
    if (removed) this.saveToDisk();
    return removed;
  }

  keys(): string[] {
    this.prune();
    return Array.from(this.store.keys());
  }

  prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        removed++;
      }
    }
    if (removed > 0) this.saveToDisk();
    return removed;
  }

  size(): number {
    this.prune();
    return this.store.size;
  }

  private loadFromDisk(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf8");
      const parsed = JSON.parse(raw) as { entries?: DHTEntry[] };
      for (const entry of parsed.entries ?? []) {
        if (entry?.key && entry.expiresAt > Date.now()) {
          this.store.set(entry.key, entry);
        }
      }
    } catch {
      /* corrupt store - start fresh */
    }
  }

  private saveToDisk(): void {
    if (!this.autosave) return;
    try {
      this.prune();
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const entries = Array.from(this.store.values());
      writeFileSync(
        this.persistPath,
        JSON.stringify({ version: 1, entries }, null, 0),
        "utf8",
      );
    } catch {
      /* persistence is best-effort */
    }
  }
}