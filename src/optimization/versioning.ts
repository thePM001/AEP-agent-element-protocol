// AEP 2.5 -- Prompt Version Manager
// Save, load, list and diff prompt versions.
// Storage: .aep/prompts/<name>/<version>.txt

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface PromptVersion {
  version: string;
  savedAt: string;
  hash: string;
}

export class PromptVersionManager {
  private baseDir: string;

  constructor(baseDir: string = ".") {
    this.baseDir = baseDir;
  }

  private promptDir(name: string): string {
    return join(this.baseDir, ".aep", "prompts", name);
  }

  private ensureDir(name: string): void {
    const dir = this.promptDir(name);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  save(name: string, version: string, content: string): void {
    this.ensureDir(name);
    const dir = this.promptDir(name);
    const filePath = join(dir, `${version}.txt`);
    const meta: PromptVersion = {
      version,
      savedAt: new Date().toISOString(),
      hash: createHash("sha256").update(content).digest("hex"),
    };

    writeFileSync(filePath, content, "utf-8");

    // Update metadata index
    const indexPath = join(dir, "index.json");
    const versions = this.loadIndex(indexPath);
    // Remove existing version if present (overwrite)
    const filtered = versions.filter(v => v.version !== version);
    filtered.push(meta);
    writeFileSync(indexPath, JSON.stringify(filtered, null, 2) + "\n", "utf-8");
  }

  load(name: string, version?: string): string {
    const dir = this.promptDir(name);
    if (!existsSync(dir)) {
      throw new Error(`Prompt "${name}" not found.`);
    }

    if (version) {
      const filePath = join(dir, `${version}.txt`);
      if (!existsSync(filePath)) {
        throw new Error(`Version "${version}" of prompt "${name}" not found.`);
      }
      return readFileSync(filePath, "utf-8");
    }

    // Load latest version
    const versions = this.list(name);
    if (versions.length === 0) {
      throw new Error(`No versions found for prompt "${name}".`);
    }

    const latest = versions[versions.length - 1];
    const filePath = join(dir, `${latest.version}.txt`);
    return readFileSync(filePath, "utf-8");
  }

  list(name: string): PromptVersion[] {
    const dir = this.promptDir(name);
    if (!existsSync(dir)) {
      return [];
    }

    const indexPath = join(dir, "index.json");
    return this.loadIndex(indexPath);
  }

  diff(name: string, versionA: string, versionB: string): string {
    const contentA = this.load(name, versionA);
    const contentB = this.load(name, versionB);

    const linesA = contentA.split("\n");
    const linesB = contentB.split("\n");
    const result: string[] = [];

    result.push(`--- ${name}/${versionA}`);
    result.push(`+++ ${name}/${versionB}`);

    const maxLen = Math.max(linesA.length, linesB.length);
    for (let i = 0; i < maxLen; i++) {
      const lineA = linesA[i];
      const lineB = linesB[i];

      if (lineA === undefined && lineB !== undefined) {
        result.push(`+ ${lineB}`);
      } else if (lineA !== undefined && lineB === undefined) {
        result.push(`- ${lineA}`);
      } else if (lineA !== lineB) {
        result.push(`- ${lineA}`);
        result.push(`+ ${lineB}`);
      } else {
        result.push(`  ${lineA}`);
      }
    }

    return result.join("\n");
  }

  private loadIndex(indexPath: string): PromptVersion[] {
    if (!existsSync(indexPath)) {
      return [];
    }
    const content = readFileSync(indexPath, "utf-8");
    try {
      return JSON.parse(content) as PromptVersion[];
    } catch {
      return [];
    }
  }
}
