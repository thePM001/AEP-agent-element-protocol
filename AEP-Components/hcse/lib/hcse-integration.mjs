#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolveRepoRoot } from "../../coding-governance/lib/paths.mjs";
import { hcseDetectChanges, attachHcseToBlastRadius } from "./detect-changes-bridge.mjs";
import { indexRepository, readHcseArtifactSummary } from "./hcse-bridge.mjs";
import { hcseInstalled } from "./paths.mjs";

export function hcseEnabledForDataDir(dataDir, env = process.env) {
  return env.AEP_HCSE_DISABLED !== "1" && hcseInstalled(dataDir);
}

/**
 * Enrich propose result with HCSE symbol blast when module installed.
 */
export function enrichProposeWithHcse(detail, { dataDir, paths = [], repoRoot } = {}) {
  if (!hcseEnabledForDataDir(dataDir)) {
    return detail;
  }
  if (process.env.AEP_HCSE_AUTO_INDEX === "1" && repoRoot) {
    indexRepository(dataDir, repoRoot);
  }
  const hcse = hcseDetectChanges({ dataDir, repoRoot, paths });
  if (!hcse.available) return detail;
  return {
    ...detail,
    blast_radius: attachHcseToBlastRadius(detail.blast_radius ?? {}, hcse),
    hcse_detect_changes: hcse,
  };
}

/**
 * Attach hcse artifact hash to solidify payload.
 */
export function enrichSolidifyWithHcseArtifact(record, { repoRoot } = {}) {
  const root = repoRoot ?? resolveRepoRoot();
  const meta = readHcseArtifactSummary(root);
  if (!meta) return record;
  const metaPath = existsSync(`${root}/.aep-hcse/artifact.json`)
    ? `${root}/.aep-hcse/artifact.json`
    : `${root}/.codebase-memory/artifact.json`;
  let hash = null;
  if (existsSync(metaPath)) {
    hash = createHash("sha256").update(readFileSync(metaPath)).digest("hex");
  }
  return {
    ...record,
    hcse_artifact: {
      head_sha: meta.commit ?? meta.head_sha ?? null,
      indexed_at: meta.indexed_at ?? null,
      artifact_hash: hash,
      artifact_dir: ".aep-hcse",
    },
  };
}