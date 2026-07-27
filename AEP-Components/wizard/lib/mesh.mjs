#!/usr/bin/env node
/**
 * POTOMITAN mesh peer registry (mirrors potomitan/crate peer format).
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const MESH_PEERS_FILE = "mesh-peers.json";

export function meshPeersPath(dataDir) {
  return join(dataDir, MESH_PEERS_FILE);
}

export function loadMeshPeers(dataDir) {
  const path = meshPeersPath(dataDir);
  if (!existsSync(path)) {
    return { version: "2.8.0", peers: [], updated_at: null };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.peers)) {
      return { version: "2.8.0", peers: [], updated_at: null };
    }
    return parsed;
  } catch {
    return { version: "2.8.0", peers: [], updated_at: null };
  }
}

export function saveMeshPeers(dataDir, peers) {
  const path = meshPeersPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const record = {
    version: "2.8.0",
    peers,
    updated_at: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows */
  }
  return record;
}

export function getMeshPublicState(dataDir, health = {}) {
  const file = loadMeshPeers(dataDir);
  const active = file.peers.filter((p) => p.active !== false);
  return {
    version: file.version,
    peers: file.peers,
    active_peers: active.length,
    routes: active.length,
    mesh_mode: health.mesh_mode ?? null,
    mesh_reachable: health.mesh_reachable ?? null,
    internet_up: health.internet_up ?? null,
    config_path: meshPeersPath(dataDir),
  };
}

export function upsertMeshPeer(dataDir, peer) {
  const file = loadMeshPeers(dataDir);
  const peers = file.peers.filter((p) => p.node_id !== peer.node_id);
  peers.push({
    node_id: peer.node_id,
    endpoint: peer.endpoint,
    public_key_hex: peer.public_key_hex ?? null,
    active: peer.active !== false,
  });
  saveMeshPeers(dataDir, peers);
  return getMeshPublicState(dataDir);
}

export function removeMeshPeer(dataDir, nodeId) {
  const file = loadMeshPeers(dataDir);
  const peers = file.peers.filter((p) => p.node_id !== nodeId);
  saveMeshPeers(dataDir, peers);
  return getMeshPublicState(dataDir);
}