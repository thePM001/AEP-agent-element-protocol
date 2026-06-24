#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolveTaskManifestDir,
  saveTaskManifest,
} from "../../AEP-Components/coding-governance/lib/task-manifest.mjs";
import { bindAgentMeshToManifest } from "./agent-sign-keys.mjs";

const CCA_MANIFEST = {
  manifest_version: "1",
  id: "TM-composer-lite-cca",
  agent_id: "cca",
  intent: {
    summary: "Composer Lite CCA: governed chat, plan generation and canvas assistance",
    allowed_operations: [
      "lattice:cross",
      "composer:chat",
      "composer:plan",
      "composer:topology",
      "component:composer-lite",
      "component:cca",
    ],
  },
  trust: {
    tier: "standard",
    max_trust_score: 850,
  },
  provisional: false,
  synthesized_by: "provided",
};

/**
 * Base Node validation_engine dock requires agent_id=cca task manifest when
 * AEP_DOCK_STRICT_IDENTITY is enabled (default).
 */
export function ensureCcaTaskManifest(dataDir, opts = {}) {
  const dir = resolveTaskManifestDir(dataDir);
  const path = join(dir, "cca.json");
  const existed = existsSync(path);
  const manifest = bindAgentMeshToManifest(CCA_MANIFEST, dataDir, 850, opts);
  saveTaskManifest(manifest, dataDir, opts);
  return { path, existed, manifest };
}