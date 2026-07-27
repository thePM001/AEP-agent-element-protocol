#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createAgentMeshBundle } from "./agentmesh-preview.mjs";
import { buildLatticeFrame } from "../../AEP-Components/lattice-channels/lib/lattice-transport.mjs";

export function agentSignKeysPath(dataDir) {
  return join(dataDir, "agent-sign-keys.json");
}

export function readAgentPublicHex(dataDir, agentId) {
  const path = agentSignKeysPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    const file = JSON.parse(readFileSync(path, "utf8"));
    const entry = file?.keys?.[agentId];
    const hex = entry?.public_hex;
    return typeof hex === "string" && hex.trim() ? hex.trim() : null;
  } catch {
    return null;
  }
}

/** Ensure lattice signing key exists for agent_id (creates via aep-lattice-log if needed). */
export function ensureAgentSignKey(dataDir, agentId, opts = {}) {
  const configPath = opts.configPath ?? join(dataDir, "base-node.json");
  if (readAgentPublicHex(dataDir, agentId)) return readAgentPublicHex(dataDir, agentId);
  buildLatticeFrame(
    {
      agent_id: agentId,
      channel_id: opts.channelId ?? "ch-sign-key-bootstrap",
      contract_id: opts.contractId ?? "lattice-channel-default",
      event_type: "SIGN_KEY_BOOTSTRAP",
      session_id: "install-wizard",
      docking_port: opts.dockingPort ?? "validation_engine",
      trust_score: opts.trustScore ?? 700,
      payload: { bootstrap: true },
    },
    { configPath, ...opts },
  );
  return readAgentPublicHex(dataDir, agentId);
}

/** Bind task manifest agentmesh DID to the dock signing key when present. */
export function bindAgentMeshToManifest(manifest, dataDir, trustScore = 700, opts = {}) {
  ensureAgentSignKey(dataDir, manifest.agent_id, { trustScore, ...opts });
  const publicHex = readAgentPublicHex(dataDir, manifest.agent_id);
  if (!publicHex) return manifest;
  const bundle = createAgentMeshBundle(manifest.agent_id, trustScore);
  bundle.did.verification_key_hex = publicHex;
  if (!bundle.mtls?.cert_pem) {
    bundle.mtls.cert_fingerprint = createHash("sha256")
      .update(Buffer.from(publicHex, "hex"))
      .digest("hex");
  }
  return { ...manifest, agentmesh: bundle };
}