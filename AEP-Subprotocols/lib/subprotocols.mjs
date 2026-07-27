#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUBPROTOCOLS_ROOT = join(__dirname, "..");
const REPO_ROOT = join(SUBPROTOCOLS_ROOT, "..");

export function loadSubprotocolCatalog(repoRoot = REPO_ROOT) {
  const path = join(repoRoot, "AEP-Subprotocols", "catalog.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadSubprotocolManifest(manifestPath, repoRoot = REPO_ROOT) {
  const resolved = manifestPath.startsWith("/")
    ? manifestPath
    : join(repoRoot, manifestPath);
  if (!existsSync(resolved)) return null;
  return JSON.parse(readFileSync(resolved, "utf8"));
}

export function resolveUiSources(repoRoot = REPO_ROOT) {
  const manifest = loadSubprotocolManifest(
    "AEP-Subprotocols/ui/manifest.json",
    repoRoot,
  );
  if (!manifest?.layers) {
    throw new Error("UI subprotocol manifest missing layers");
  }
  return {
    scene: join(repoRoot, manifest.layers.scene),
    registry: join(repoRoot, manifest.layers.registry),
    theme: join(repoRoot, manifest.layers.theme),
  };
}

export function listBundledSubprotocols(repoRoot = REPO_ROOT) {
  const catalog = loadSubprotocolCatalog(repoRoot);
  return catalog.subprotocols.filter((s) => s.bundled);
}