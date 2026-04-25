// AEP 2.5 -- Dataset Manager
// Versioned evaluation datasets with ledger import.
// Storage: .aep/datasets/<name>.json

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Dataset, DatasetEntry, DatasetSummary } from "./types.js";
import type { LedgerEntry } from "../ledger/types.js";

export class DatasetManager {
  private baseDir: string;

  constructor(baseDir: string = ".") {
    this.baseDir = baseDir;
  }

  private get datasetsDir(): string {
    return join(this.baseDir, ".aep", "datasets");
  }

  private ensureDir(): void {
    if (!existsSync(this.datasetsDir)) {
      mkdirSync(this.datasetsDir, { recursive: true });
    }
  }

  private datasetPath(name: string): string {
    return join(this.datasetsDir, `${name}.json`);
  }

  create(name: string, description?: string): Dataset {
    this.ensureDir();
    const path = this.datasetPath(name);
    if (existsSync(path)) {
      throw new Error(`Dataset "${name}" already exists.`);
    }

    const now = new Date().toISOString();
    const dataset: Dataset = {
      name,
      version: "1.0.0",
      description: description ?? "",
      entries: [],
      created: now,
      updated: now,
    };

    writeFileSync(path, JSON.stringify(dataset, null, 2) + "\n", "utf-8");
    return dataset;
  }

  addEntry(name: string, entry: Omit<DatasetEntry, "id"> & { id?: string }): void {
    const dataset = this.get(name);
    const fullEntry: DatasetEntry = {
      id: entry.id ?? randomUUID(),
      input: entry.input,
      expectedOutcome: entry.expectedOutcome,
      ...(entry.context !== undefined ? { context: entry.context } : {}),
      ...(entry.category !== undefined ? { category: entry.category } : {}),
      ...(entry.tags !== undefined ? { tags: entry.tags } : {}),
    };

    dataset.entries.push(fullEntry);
    this.bumpAndSave(dataset);
  }

  addFromLedger(
    name: string,
    ledgerPath: string,
    filter?: { outcome?: "pass" | "fail"; category?: string }
  ): number {
    const dataset = this.get(name);

    if (!existsSync(ledgerPath)) {
      throw new Error(`Ledger file not found: ${ledgerPath}`);
    }

    const content = readFileSync(ledgerPath, "utf-8").trim();
    if (!content) return 0;

    const lines = content.split("\n").filter(l => l.trim());
    let added = 0;

    for (const line of lines) {
      const entry = JSON.parse(line) as LedgerEntry;

      // Only import action:evaluate entries
      if (entry.type !== "action:evaluate") continue;

      const decision = entry.data.decision as string | undefined;
      if (!decision) continue;

      // Map ledger decision to expected outcome
      const expectedOutcome: "pass" | "fail" = decision === "allow" ? "pass" : "fail";

      // Apply filters
      if (filter?.outcome && filter.outcome !== expectedOutcome) continue;

      const tool = (entry.data.tool as string) ?? "unknown";
      const category = tool.split(":")[0];
      if (filter?.category && category !== filter.category) continue;

      const input = entry.data.input
        ? `${tool} ${JSON.stringify(entry.data.input)}`
        : tool;

      dataset.entries.push({
        id: (entry.data.actionId as string) ?? randomUUID(),
        input,
        expectedOutcome,
        category,
      });
      added++;
    }

    if (added > 0) {
      this.bumpAndSave(dataset);
    }

    return added;
  }

  remove(name: string, entryId: string): void {
    const dataset = this.get(name);
    const idx = dataset.entries.findIndex(e => e.id === entryId);
    if (idx === -1) {
      throw new Error(`Entry "${entryId}" not found in dataset "${name}".`);
    }

    dataset.entries.splice(idx, 1);
    this.bumpAndSave(dataset);
  }

  export(name: string, format: "json" | "csv"): string {
    const dataset = this.get(name);

    if (format === "csv") {
      const header = "id,input,expectedOutcome,category,tags";
      const rows = dataset.entries.map(e => {
        const escapedInput = `"${e.input.replace(/"/g, '""')}"`;
        const tags = (e.tags ?? []).join(";");
        return `${e.id},${escapedInput},${e.expectedOutcome},${e.category ?? ""},${tags}`;
      });
      return [header, ...rows].join("\n");
    }

    return JSON.stringify(dataset, null, 2);
  }

  importFile(path: string): Dataset {
    if (!existsSync(path)) {
      throw new Error(`File not found: ${path}`);
    }

    const content = readFileSync(path, "utf-8");
    const data = JSON.parse(content) as Dataset;

    if (!data.name || !data.entries) {
      throw new Error("Invalid dataset format: missing name or entries.");
    }

    this.ensureDir();
    const filePath = this.datasetPath(data.name);

    const now = new Date().toISOString();
    const dataset: Dataset = {
      name: data.name,
      version: data.version ?? "1.0.0",
      description: data.description ?? "",
      entries: data.entries,
      created: data.created ?? now,
      updated: now,
    };

    writeFileSync(filePath, JSON.stringify(dataset, null, 2) + "\n", "utf-8");
    return dataset;
  }

  list(): DatasetSummary[] {
    this.ensureDir();
    const files = readdirSync(this.datasetsDir).filter(f => f.endsWith(".json"));

    return files.map(f => {
      const content = readFileSync(join(this.datasetsDir, f), "utf-8");
      const dataset = JSON.parse(content) as Dataset;
      return {
        name: dataset.name,
        version: dataset.version,
        description: dataset.description,
        entryCount: dataset.entries.length,
        created: dataset.created,
        updated: dataset.updated,
      };
    });
  }

  get(name: string): Dataset {
    this.ensureDir();
    const path = this.datasetPath(name);
    if (!existsSync(path)) {
      throw new Error(`Dataset "${name}" not found.`);
    }

    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as Dataset;
  }

  private bumpAndSave(dataset: Dataset): void {
    // Bump patch version
    const parts = dataset.version.split(".").map(Number);
    parts[2] = (parts[2] ?? 0) + 1;
    dataset.version = parts.join(".");
    dataset.updated = new Date().toISOString();

    this.ensureDir();
    const path = this.datasetPath(dataset.name);
    writeFileSync(path, JSON.stringify(dataset, null, 2) + "\n", "utf-8");
  }
}
