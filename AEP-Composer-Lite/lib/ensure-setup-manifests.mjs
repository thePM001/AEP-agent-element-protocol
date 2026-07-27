#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolveTaskManifestDir,
  saveTaskManifest,
} from "../../AEP-Components/coding-governance/lib/task-manifest.mjs";
import { ensureCcaTaskManifest } from "./ensure-cca-task-manifest.mjs";
import { bindAgentMeshToManifest } from "./agent-sign-keys.mjs";
import { flushManifestRegistry } from "../../AEP-Components/cca/lib/setup/reload.mjs";

const BASE_NODE_MANIFEST = {
  manifest_version: "1",
  id: "TM-AG-BASE-NODE",
  agent_id: "AG-BASE-NODE",
  intent: {
    summary: "AEP Base Node dynAEP registration and lattice health",
    allowed_operations: [
      "lattice:cross",
      "base-node:register",
      "dynaep:record",
      "dock:health",
    ],
  },
  trust: {
    tier: "system",
    max_trust_score: 900,
  },
  provisional: false,
  synthesized_by: "provided",
};

const SETUP_INFERENCE_MANIFEST = {
  manifest_version: "1",
  id: "TM-AG-SETUP-AGENT",
  agent_id: "AG-SETUP-AGENT",
  intent: {
    summary: "Setup agent inference engine registration on inference dock",
    allowed_operations: [
      "lattice:cross",
      "inference:register",
      "setup:configure",
    ],
  },
  trust: {
    tier: "system",
    max_trust_score: 850,
  },
  provisional: false,
  synthesized_by: "provided",
};

const COMPOSER_LITE_MANIFEST = {
  manifest_version: "1",
  id: "TM-composer-lite",
  agent_id: "composer-lite",
  intent: {
    summary: "Composer Lite WASM canvas and lattice dock client",
    allowed_operations: [
      "lattice:cross",
      "wasm:evaluate",
      "composer:graph",
      "dock:health",
    ],
  },
  trust: {
    tier: "system",
    max_trust_score: 750,
  },
  provisional: false,
  synthesized_by: "provided",
};

const SETUP_AGENT_MANIFEST = {
  manifest_version: "1",
  id: "TM-setup-agent",
  agent_id: "setup-agent",
  intent: {
    summary: "AEP 2.8 setup agent: Base Node activation and component enablement",
    allowed_operations: [
      "lattice:cross",
      "base-node:activate",
      "registry:install",
      "component:enable",
      "setup:configure",
    ],
  },
  trust: {
    tier: "system",
    max_trust_score: 900,
  },
  provisional: false,
  synthesized_by: "provided",
};

export function ensureBaseNodeTaskManifest(dataDir, opts = {}) {
  const dir = resolveTaskManifestDir(dataDir);
  const path = join(dir, "AG-BASE-NODE.json");
  const existed = existsSync(path);
  const manifest = bindAgentMeshToManifest(BASE_NODE_MANIFEST, dataDir, 900, opts);
  saveTaskManifest(manifest, dataDir, opts);
  return { path, existed, manifest };
}

export function ensureSetupInferenceTaskManifest(dataDir, opts = {}) {
  const dir = resolveTaskManifestDir(dataDir);
  const path = join(dir, "AG-SETUP-AGENT.json");
  const existed = existsSync(path);
  const manifest = bindAgentMeshToManifest(SETUP_INFERENCE_MANIFEST, dataDir, 850, opts);
  saveTaskManifest(manifest, dataDir, opts);
  return { path, existed, manifest };
}

export function ensureComposerLiteTaskManifest(dataDir, opts = {}) {
  const dir = resolveTaskManifestDir(dataDir);
  const path = join(dir, "composer-lite.json");
  const existed = existsSync(path);
  const manifest = bindAgentMeshToManifest(COMPOSER_LITE_MANIFEST, dataDir, 750, opts);
  saveTaskManifest(manifest, dataDir, opts);
  return { path, existed, manifest };
}

export function ensureSetupAgentTaskManifest(dataDir, opts = {}) {
  const dir = resolveTaskManifestDir(dataDir);
  const path = join(dir, "setup-agent.json");
  const existed = existsSync(path);
  const manifest = bindAgentMeshToManifest(SETUP_AGENT_MANIFEST, dataDir, 900, opts);
  saveTaskManifest(manifest, dataDir, opts);
  return { path, existed, manifest };
}

/** Task manifests required before setup-agent and CCA can record on lattice docks. */
export function ensureInstallWizardManifests(dataDir, opts = {}) {
  const saveOpts = { ...opts, signalReload: false };
  const result = {
    base_node: ensureBaseNodeTaskManifest(dataDir, saveOpts),
    setup_inference: ensureSetupInferenceTaskManifest(dataDir, saveOpts),
    setup_agent: ensureSetupAgentTaskManifest(dataDir, saveOpts),
    composer_lite: ensureComposerLiteTaskManifest(dataDir, saveOpts),
    cca: ensureCcaTaskManifest(dataDir, saveOpts),
  };
  flushManifestRegistry(dataDir, { restartDaemon: opts.restartDaemon });
  return result;
}