#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { latticeGatedFetch } from "../../../AEP-Components/lattice-channels/lib/lattice-transport.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const MODULES_DIR = join(REPO_ROOT, "AEP-Docks/universal-connect/modules");

function safeAgentFilename(agentId) {
  return `${agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

export function resolveTaskManifestDir(dataDir) {
  if (process.env.AEP_TASK_MANIFEST_DIR) return process.env.AEP_TASK_MANIFEST_DIR;
  if (dataDir) return join(String(dataDir).replace(/\/$/, ""), "ucb", "manifests");
  return join(process.env.AEP_DATA ?? join(process.env.HOME ?? "/tmp", ".aep"), "ucb", "manifests");
}

export function resolveUcbBase() {
  const host = process.env.UCB_HOST ?? "127.0.0.1";
  const port = process.env.UCB_PORT ?? "8412";
  const basePath = (process.env.UCB_BASE_PATH ?? "").replace(/\/$/, "");
  return `http://${host}:${port}${basePath}`;
}

export function resolveUcbApiKey(dataDir) {
  if (process.env.UCB_API_KEY) return process.env.UCB_API_KEY;
  const keyPath = join(String(dataDir).replace(/\/$/, ""), "ucb-api-key.json");
  if (!existsSync(keyPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(keyPath, "utf8"));
    return raw.api_key ?? raw.key ?? null;
  } catch {
    return null;
  }
}

export function loadUcdModuleSpec(moduleId) {
  const path = join(MODULES_DIR, `${moduleId}.json`);
  if (!existsSync(path)) {
    throw new Error(`UCD module spec not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function ensureUcdManifest(moduleSpec, dataDir) {
  const dir = resolveTaskManifestDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const agentId = moduleSpec.agent_id ?? moduleSpec.module_id;
  const path = join(dir, safeAgentFilename(agentId));
  if (existsSync(path)) return { path, created: false };

  const manifest = {
    manifest_version: "1",
    id: `UCD-${moduleSpec.module_id}`,
    agent_id: agentId,
    session_id: `ucd-${moduleSpec.module_id}-install`,
    intent: {
      summary: moduleSpec.description ?? `UCD install for ${moduleSpec.module_id}`,
      allowed_operations: [`ucd:install:${moduleSpec.module_id}`, "ucd:egress"],
    },
    trust: { tier: "provisional", max_trust_score: 400 },
    egress: moduleSpec.egress ?? { routes: [] },
    provisional: true,
    synthesized_by: "schema_constrained",
    promotion_required: ["human_review"],
    created_at_unix: Math.floor(Date.now() / 1000),
  };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { path, created: true, manifest };
}

/**
 * Map upstream URL to UCB egress path using module route table.
 */
export function mapUpstreamToEgressPath(moduleSpec, upstreamUrl) {
  const routes = moduleSpec.egress?.routes ?? [];
  for (const route of routes) {
    const upstream = String(route.upstream ?? "").replace(/\/$/, "");
    if (upstreamUrl.startsWith(upstream)) {
      const remainder = upstreamUrl.slice(upstream.length);
      const prefix = String(route.path_prefix ?? "").replace(/\/$/, "");
      return `${prefix}${remainder}`;
    }
  }
  throw new Error(`UCD: no egress route for ${upstreamUrl}`);
}

async function probeUcbHealth(ucbBase) {
  try {
    const res = await fetch(`${ucbBase}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.service === "ucb-universal-connect-bridge" || body?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Fetch via UCB egress (primary). Falls back to lattice-gated fetch when UCB unavailable.
 */
export async function ucdFetch(moduleId, upstreamUrl, opts = {}) {
  const moduleSpec = loadUcdModuleSpec(moduleId);
  const dataDir = opts.dataDir;
  ensureUcdManifest(moduleSpec, dataDir);

  const ucbBase = opts.ucbBase ?? resolveUcbBase();
  const apiKey = opts.ucbApiKey ?? resolveUcbApiKey(dataDir);
  const agentId = moduleSpec.agent_id ?? moduleSpec.module_id;

  if (apiKey && (await probeUcbHealth(ucbBase))) {
    const egressPath = mapUpstreamToEgressPath(moduleSpec, upstreamUrl);
    const url = `${ucbBase}/ucb/v1/egress${egressPath}`;
    const headers = {
      Accept: opts.accept ?? "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-AEP-Agent-Id": agentId,
      ...(opts.headers ?? {}),
    };
    const res = await fetch(url, { method: opts.method ?? "GET", headers, body: opts.body });
    return { transport: "ucd-ucb-egress", response: res };
  }

  if (opts.socketBase) {
    const res = await latticeGatedFetch(
      opts.socketBase,
      {
        agentId,
        channelId: `ch-ucd-${moduleId}`,
        gateway: "ucd",
        eventType: opts.eventType ?? "UCD_MODULE_FETCH",
      },
      upstreamUrl,
      { headers: { Accept: opts.accept ?? "application/json", ...(opts.headers ?? {}) } },
    );
    return { transport: "lattice-fallback", response: res };
  }

  throw new Error(
    `UCD fetch failed: UCB unavailable and no socketBase for lattice fallback (${moduleId})`,
  );
}

export async function ucdFetchJson(moduleId, upstreamUrl, opts = {}) {
  const { transport, response } = await ucdFetch(moduleId, upstreamUrl, opts);
  if (!response.ok) {
    throw new Error(`UCD fetch failed ${response.status}: ${upstreamUrl} (${transport})`);
  }
  return { transport, data: await response.json() };
}

export async function ucdDownload(moduleId, upstreamUrl, destPath, opts = {}) {
  const { transport, response } = await ucdFetch(moduleId, upstreamUrl, {
    ...opts,
    accept: "application/octet-stream",
    eventType: "UCD_MODULE_DOWNLOAD",
  });
  if (!response.ok) {
    throw new Error(`UCD download failed ${response.status}: ${upstreamUrl} (${transport})`);
  }
  await pipeline(response.body, createWriteStream(destPath));
  return { transport, destPath };
}