#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expandHome, defaultPaths } from "../../wizard/lib/paths.mjs";
import { invokeCodingGovernanceRust } from "../../../AEP-SDKs/typescript/aep-protocol/lib/subprotocol-rust.mjs";

const WRITE_TOOL_RE = /write|edit|patch|replace|create|delete|rename|mkdir/i;

export function isSemanticStrict() {
  const v = process.env.AEP_SEMANTIC_STRICT ?? "";
  return v === "1" || v.toLowerCase() === "true";
}

export function defaultDataDir() {
  return expandHome(process.env.AEP_DATA_DIR ?? defaultPaths().dataDir);
}

export function loadActiveToken(dataDir = defaultDataDir()) {
  const path = join(dataDir, "tokens", "active-propose.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function extractWritePaths(action) {
  const paths = new Set();
  const input = action?.input;
  if (!input || typeof input !== "object") return [];

  const candidates = [
    input.path,
    input.file_path,
    input.filePath,
    input.target,
    input.file,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) paths.add(c.trim());
  }

  if (Array.isArray(input.paths)) {
    for (const p of input.paths) {
      if (typeof p === "string" && p.trim()) paths.add(p.trim());
    }
  }

  return [...paths];
}

export function isFileWriteAction(action) {
  const tool = action?.tool ?? "";
  if (!tool) return false;
  if (WRITE_TOOL_RE.test(tool)) return true;
  return extractWritePaths(action).length > 0;
}

export function checkProposeToken(action, dataDir = defaultDataDir()) {
  if (!isSemanticStrict()) return null;
  if (!isFileWriteAction(action)) return null;

  const token = loadActiveToken(dataDir);
  if (!token) {
    return "AEP_SEMANTIC_STRICT=1: no active propose token; run `aep propose` first";
  }

  const paths = extractWritePaths(action);
  if (paths.length === 0) {
    return "AEP_SEMANTIC_STRICT=1: file write action missing path in input";
  }

  for (const path of paths) {
    const result = invokeCodingGovernanceRust("verify_token", { token, path });
    if (!result.valid) {
      return result.errors?.[0] ?? `path '${path}' outside propose token envelope`;
    }
  }

  return null;
}