#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveRepoRoot() {
  const candidates = [
    process.env.AEP_REPO_ROOT,
    join(__dirname, "../../.."),
    process.cwd(),
  ].filter(Boolean);

  for (const c of candidates) {
    if (existsSync(join(c, "AEP-Base-Node/registry/catalog.json"))) return c;
  }
  return candidates[0] ?? ".";
}