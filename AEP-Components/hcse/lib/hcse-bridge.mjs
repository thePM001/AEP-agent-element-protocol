#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultPaths } from "../../wizard/lib/paths.mjs";
import {
  HCSE_ARTIFACT_DIR,
  HCSE_ARTIFACT_META,
  HCSE_DEFAULT_UI_PORT,
  HCSE_UPSTREAM_ARTIFACT_DIR,
  expandDataDir,
  hcseEnvForChild,
  hcseInstalled,
  readHcseModuleManifest,
  repoArtifactMetaPath,
  resolveHcseBinary,
} from "./paths.mjs";

export function resolveHcseBinaryPath(dataDir) {
  return resolveHcseBinary(expandDataDir(dataDir));
}

export function runHcseCli(dataDir, tool, args = {}, opts = {}) {
  const binary = resolveHcseBinary(expandDataDir(dataDir));
  if (!binary) {
    return { ok: false, reason: "hcse_not_installed" };
  }
  const jsonArgs = JSON.stringify(args);
  try {
    const stdout = execFileSync(binary, ["cli", tool, jsonArgs], {
      encoding: "utf8",
      env: { ...process.env, ...hcseEnvForChild(expandDataDir(dataDir)), ...opts.env },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout.trim(), data: tryParseJson(stdout) };
  } catch (err) {
    return {
      ok: false,
      reason: err?.message ?? "hcse_cli_failed",
      stderr: err?.stderr?.toString?.() ?? "",
      stdout: err?.stdout?.toString?.() ?? "",
    };
  }
}

function tryParseJson(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: trimmed };
  }
}

/**
 * Mirror upstream `.codebase-memory/` export into `.aep-hcse/` for git teams.
 * @param {string} repoRoot
 */
export function mirrorHcseArtifactToAepDir(repoRoot) {
  const upstreamDir = join(repoRoot, HCSE_UPSTREAM_ARTIFACT_DIR);
  const targetDir = join(repoRoot, HCSE_ARTIFACT_DIR);
  if (!existsSync(upstreamDir)) {
    return { ok: false, reason: "upstream_artifact_missing" };
  }
  mkdirSync(targetDir, { recursive: true });
  for (const name of ["graph.db.zst", "artifact.json"]) {
    const src = join(upstreamDir, name);
    if (existsSync(src)) {
      copyFileSync(src, join(targetDir, name));
    }
  }
  const manifestPath = join(targetDir, "hcse-manifest.json");
  if (!existsSync(manifestPath)) {
    const meta = existsSync(join(targetDir, HCSE_ARTIFACT_META))
      ? JSON.parse(readFileSync(join(targetDir, HCSE_ARTIFACT_META), "utf8"))
      : {};
    writeHcseManifest(manifestPath, {
      kind: "hcse_artifact",
      schema_version: 1,
      mirrored_from: HCSE_UPSTREAM_ARTIFACT_DIR,
      ...meta,
    });
  }
  return { ok: true, artifact_dir: HCSE_ARTIFACT_DIR };
}

function writeHcseManifest(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

export function readHcseArtifactSummary(repoRoot) {
  const aepMeta = repoArtifactMetaPath(repoRoot, HCSE_ARTIFACT_DIR);
  const legacyMeta = repoArtifactMetaPath(repoRoot, HCSE_UPSTREAM_ARTIFACT_DIR);
  const path = existsSync(aepMeta) ? aepMeta : legacyMeta;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function probeHcseLocal(dataDir, port = HCSE_DEFAULT_UI_PORT) {
  const installed = hcseInstalled(expandDataDir(dataDir));
  const manifest = readHcseModuleManifest(expandDataDir(dataDir));
  return {
    id: "conn-hcse",
    service: "hcse",
    label: "AEP-HCSE",
    configured: installed,
    connected: installed,
    online: installed,
    status: installed ? "ready" : "not_installed",
    binary: resolveHcseBinary(expandDataDir(dataDir)),
    version: manifest?.version ?? null,
    ui_port: port,
  };
}

export function indexRepository(dataDir, repoPath) {
  const result = runHcseCli(dataDir, "index_repository", { repo_path: repoPath });
  if (result.ok) {
    mirrorHcseArtifactToAepDir(repoPath);
  }
  return result;
}