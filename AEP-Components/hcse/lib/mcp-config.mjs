#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HCSE_INSTALLED_BINARY, HCSE_MCP_REGISTRY_NAME, resolveHcseBinary } from "./paths.mjs";

const AGENT_MCP_PATHS = [
  { id: "claude-code", path: () => join(homedir(), ".claude.json") },
  { id: "claude-project", path: (cwd) => join(cwd, ".mcp.json") },
  { id: "codex", path: () => join(homedir(), ".codex", "config.toml") },
];

function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(path, data) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Write AEP-HCSE MCP entry for detected agents (replaces upstream DeusData entry).
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {string} [opts.cwd]
 */
export function wireHcseMcpConfigs({ dataDir, cwd = process.cwd() }) {
  const binary = resolveHcseBinary(dataDir);
  if (!binary) {
    return { ok: false, reason: "hcse_not_installed", wired: [] };
  }

  const wired = [];
  const mcpEntry = {
    command: binary,
    args: [],
    env: {
      CBM_CACHE_DIR: join(dataDir.replace(/\/$/, ""), "cache", "hcse"),
      AEP_HCSE_MODULE: "1",
    },
  };

  const claudeGlobal = AGENT_MCP_PATHS[0].path();
  if (existsSync(join(claudeGlobal, "..")) || existsSync(claudeGlobal)) {
    const doc = readJson(claudeGlobal);
    doc.mcpServers = doc.mcpServers ?? {};
    delete doc.mcpServers["codebase-memory-mcp"];
    delete doc.mcpServers[HCSE_MCP_REGISTRY_NAME];
    doc.mcpServers[HCSE_INSTALLED_BINARY] = mcpEntry;
    writeJson(claudeGlobal, doc);
    wired.push({ agent: "claude-code", path: claudeGlobal });
  }

  const projectMcp = AGENT_MCP_PATHS[1].path(cwd);
  if (existsSync(join(projectMcp, ".."))) {
    const doc = readJson(projectMcp);
    doc.mcpServers = doc.mcpServers ?? {};
    delete doc.mcpServers["codebase-memory-mcp"];
    doc.mcpServers[HCSE_INSTALLED_BINARY] = mcpEntry;
    writeJson(projectMcp, doc);
    wired.push({ agent: "claude-project", path: projectMcp });
  }

  const aepMcpManifest = join(dataDir, "hcse-mcp.json");
  writeJson(aepMcpManifest, {
    server: HCSE_MCP_REGISTRY_NAME,
    binary,
    wired_at: new Date().toISOString(),
    agents: wired.map((w) => w.agent),
  });
  wired.push({ agent: "aep-data", path: aepMcpManifest });

  return { ok: true, binary, wired };
}