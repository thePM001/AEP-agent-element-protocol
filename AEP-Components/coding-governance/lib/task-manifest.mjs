#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expandHome, defaultPaths } from "../../wizard/lib/paths.mjs";
import { signalManifestRegistryReload } from "./manifest-reload.mjs";

export function resolveTaskManifestDir(dataDir) {
  if (process.env.AEP_TASK_MANIFEST_DIR) return process.env.AEP_TASK_MANIFEST_DIR;
  if (dataDir) return join(dataDir, "ucb", "manifests");
  return join(expandHome(defaultPaths().dataDir), "ucb", "manifests");
}

function safeAgentFilename(agentId) {
  return `${agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

export function loadTaskManifest(agentId, dataDir) {
  const dir = resolveTaskManifestDir(dataDir);
  const path = join(dir, safeAgentFilename(agentId));
  if (!existsSync(path)) return { path, manifest: null };
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  return { path, manifest };
}

export function saveTaskManifest(manifest, dataDir, options = {}) {
  const dir = resolveTaskManifestDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, safeAgentFilename(manifest.agent_id));
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (options.signalReload !== false) {
    signalManifestRegistryReload(dataDir);
  }
  return path;
}

function operationsFromCodingIntent(declaration, blastRadius, intentId) {
  const ops = new Set(["coding:propose", "coding:announce"]);
  for (const p of declaration?.envelope?.allowed_paths ?? []) {
    if (p?.trim()) ops.add(p.trim().replace(/\/$/, ""));
  }
  for (const c of blastRadius?.impact?.components ?? []) {
    if (c) ops.add(`component:${c}`);
  }
  ops.add(`intent:${intentId}`);
  return [...ops].sort();
}

/**
 * Bind coding-governance intent into task-manifest-v1 for dock enforcement.
 */
export function mergeCodingGovernanceIntoManifest(
  manifest,
  { agentId, intentId, sessionId, declaration, blastRadius },
) {
  const base = manifest ?? {
    manifest_version: "1",
    id: `TM-${intentId}`,
    agent_id: agentId,
    trust: { tier: "standard", max_trust_score: 700 },
    provisional: false,
    synthesized_by: "gap_constrained",
    created_at_unix: Math.floor(Date.now() / 1000),
  };

  if (base.agent_id !== agentId) {
    throw new Error(`task manifest agent_id '${base.agent_id}' != '${agentId}'`);
  }

  base.manifest_version = "1";
  base.id = base.id || `TM-${intentId}`;
  if (sessionId) base.session_id = sessionId;

  base.intent = {
    ...(base.intent ?? {}),
    summary: declaration?.statement ?? base.intent?.summary ?? "",
    allowed_operations: operationsFromCodingIntent(declaration, blastRadius, intentId),
    coding_governance: {
      intent_id: intentId,
      statement: declaration?.statement ?? null,
      envelope: declaration?.envelope ?? null,
      blast_radius: blastRadius
        ? {
            within_envelope: blastRadius.within_envelope,
            components: blastRadius.impact?.components ?? [],
            files_touched_estimate: blastRadius.impact?.files_touched_estimate ?? null,
          }
        : null,
      announced_at: new Date().toISOString(),
    },
  };

  return base;
}