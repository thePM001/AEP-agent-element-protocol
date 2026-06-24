#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Upstream open-source release source (not vendored in AEP 2.8). */
export const HCSE_UPSTREAM_REPO = "https://github.com/DeusData/codebase-memory-mcp";
export const HCSE_UPSTREAM_API =
  "https://api.github.com/repos/DeusData/codebase-memory-mcp/releases/latest";

/** Names after opaque AEP rebrand on install. */
export const HCSE_MODULE_ID = "hcse";
export const HCSE_INSTALLED_BINARY = "aep-hcse";
export const HCSE_UPSTREAM_BINARY = "codebase-memory-mcp";
export const HCSE_MCP_SERVER_NAME = "aep-hcse";
export const HCSE_MCP_REGISTRY_NAME = "io.github.thePM001/aep-hcse";

/** Git team artifact (mirrored from upstream `.codebase-memory/` after index). */
export const HCSE_ARTIFACT_DIR = ".aep-hcse";
export const HCSE_ARTIFACT_FILE = "graph.db.zst";
export const HCSE_ARTIFACT_META = "artifact.json";

/** Upstream hardcodes this; we mirror into HCSE_ARTIFACT_DIR post-index. */
export const HCSE_UPSTREAM_ARTIFACT_DIR = ".codebase-memory";

export const HCSE_DEFAULT_UI_PORT = 8426;
export const HCSE_CACHE_ENV = "CBM_CACHE_DIR";

export function hcseModuleRoot(dataDir) {
  return join(dataDir.replace(/\/$/, ""), "modules", "aep-hcse");
}

export function hcseCacheDir(dataDir) {
  return join(dataDir.replace(/\/$/, ""), "cache", "hcse");
}

export function hcseModuleManifestPath(dataDir) {
  return join(hcseModuleRoot(dataDir), "module.json");
}

export function readHcseModuleManifest(dataDir) {
  const path = hcseModuleManifestPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function resolveHcseBinary(dataDir) {
  const manifest = readHcseModuleManifest(dataDir);
  if (!manifest?.version) return null;
  const wrapper = join(hcseModuleRoot(dataDir), manifest.version, HCSE_INSTALLED_BINARY);
  if (existsSync(wrapper)) return wrapper;
  const legacy = join(hcseModuleRoot(dataDir), manifest.version, HCSE_UPSTREAM_BINARY);
  if (existsSync(legacy)) return legacy;
  return null;
}

export function hcseInstalled(dataDir) {
  return Boolean(resolveHcseBinary(dataDir));
}

export function hcseEnvForChild(dataDir) {
  return {
    [HCSE_CACHE_ENV]: hcseCacheDir(dataDir),
    AEP_HCSE_MODULE: "1",
    AEP_HCSE_DATA_DIR: dataDir,
  };
}

export function repoArtifactPath(repoRoot, dirName = HCSE_ARTIFACT_DIR) {
  return join(repoRoot, dirName, HCSE_ARTIFACT_FILE);
}

export function repoArtifactMetaPath(repoRoot, dirName = HCSE_ARTIFACT_DIR) {
  return join(repoRoot, dirName, HCSE_ARTIFACT_META);
}

export function expandDataDir(dataDir) {
  if (!dataDir) return join(homedir(), ".aep");
  if (dataDir.startsWith("~/")) return join(homedir(), dataDir.slice(2));
  return dataDir;
}