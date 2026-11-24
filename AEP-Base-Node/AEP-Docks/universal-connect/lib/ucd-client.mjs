#!/usr/bin/env node
// @ts-check

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
// The one source of the gated fetch is lattice-gated-fetch.ts; this is its emitted module.
import { latticeGatedFetch } from "../../../../AEP-Components/lattice-channels/lib/lattice-gated-fetch.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const MODULES_DIR = join(REPO_ROOT, "AEP-Base-Node/AEP-Docks/universal-connect/modules");

/** A module id names a file in the modules folder, so it is a plain name. */
const MODULE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/**
 * @typedef {object} EgressRoute
 * @property {string} upstream
 * @property {string} path_prefix
 */

/**
 * @typedef {object} UcdModuleSpec
 * @property {string} module_id
 * @property {string} [agent_id]
 * @property {string} [description]
 * @property {{ routes: EgressRoute[] }} [egress]
 */

/**
 * @typedef {object} UcdFetchOptions
 * @property {string} [modulesDir]
 * @property {string} [dataDir]
 * @property {string} [ucbBase]
 * @property {string | null} [ucbApiKey]
 * @property {string} [accept]
 * @property {Record<string, string>} [headers]
 * @property {string} [method]
 * @property {string | Uint8Array} [body]
 * @property {string} [socketBase]
 * @property {string} [eventType]
 */

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** @param {string} agentId */
function safeAgentFilename(agentId) {
  return `${agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

/** @param {string | undefined} [dataDir] */
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

/**
 * The UCB API key from UCB_API_KEY or from ucb-api-key.json of the data folder.
 * @param {string | undefined} [dataDir]
 * @returns {string | null}
 */
export function resolveUcbApiKey(dataDir) {
  if (process.env.UCB_API_KEY) return process.env.UCB_API_KEY;
  if (!dataDir) return null;
  const keyPath = join(String(dataDir).replace(/\/$/, ""), "ucb-api-key.json");
  if (!existsSync(keyPath)) return null;
  try {
    /** @type {unknown} */
    const raw = JSON.parse(readFileSync(keyPath, "utf8"));
    if (!isObject(raw)) return null;
    const key = raw.api_key ?? raw.key;
    return typeof key === "string" && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/**
 * Read and check a module spec. The id must be a plain name, so it cannot
 * reach a file outside the modules folder.
 * @param {string} moduleId
 * @param {string} [modulesDir]
 * @returns {UcdModuleSpec}
 */
export function loadUcdModuleSpec(moduleId, modulesDir = MODULES_DIR) {
  if (!MODULE_ID.test(moduleId)) {
    throw new Error(`UCD module id is not a plain name: ${JSON.stringify(moduleId)}`);
  }
  const path = join(modulesDir, `${moduleId}.json`);
  if (!existsSync(path)) {
    throw new Error(`UCD module spec not found: ${path}`);
  }
  /** @type {unknown} */
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!isObject(raw) || raw.module_id !== moduleId) {
    throw new Error(`UCD module spec ${path} must be an object whose module_id is ${moduleId}`);
  }
  /** @type {EgressRoute[]} */
  const routes = [];
  const egress = raw.egress;
  if (isObject(egress) && Array.isArray(egress.routes)) {
    for (const r of egress.routes) {
      if (isObject(r) && typeof r.upstream === "string" && r.upstream.length > 0 && typeof r.path_prefix === "string") {
        routes.push({ upstream: r.upstream, path_prefix: r.path_prefix });
      }
    }
  }
  return {
    module_id: moduleId,
    ...(typeof raw.agent_id === "string" && raw.agent_id.length > 0 ? { agent_id: raw.agent_id } : {}),
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    egress: { routes },
  };
}

/**
 * Write the provisional task manifest of a module once.
 * @param {UcdModuleSpec} moduleSpec
 * @param {string | undefined} [dataDir]
 */
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
    egress: moduleSpec.egress ?? { routes: [] },
    provisional: true,
    synthesized_by: "schema_constrained",
    promotion_required: ["human_review"],
    created_at_unix: Math.floor(Date.now() / 1000),
  };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { path, created: true, manifest };
}

/**
 * Map an upstream URL to the UCB egress path through the route table of the
 * module. The URL matches a route only at a path boundary, so a host that
 * merely starts with the upstream text, such as api.example.com.evil.net for
 * api.example.com, matches no route.
 * @param {UcdModuleSpec} moduleSpec
 * @param {string} upstreamUrl
 */
export function mapUpstreamToEgressPath(moduleSpec, upstreamUrl) {
  for (const route of moduleSpec.egress?.routes ?? []) {
    const upstream = route.upstream.replace(/\/$/, "");
    if (upstream.length === 0 || !upstreamUrl.startsWith(upstream)) continue;
    const remainder = upstreamUrl.slice(upstream.length);
    if (remainder !== "" && !remainder.startsWith("/") && !remainder.startsWith("?")) continue;
    const prefix = route.path_prefix.replace(/\/$/, "");
    return `${prefix}${remainder}`;
  }
  throw new Error(`UCD: no egress route for ${upstreamUrl}`);
}

/**
 * @param {string} ucbBase
 * @returns {Promise<boolean>}
 */
async function probeUcbHealth(ucbBase) {
  try {
    const res = await fetch(`${ucbBase}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    /** @type {unknown} */
    const body = await res.json();
    return isObject(body) && (body.service === "ucb-universal-connect-bridge" || body.ok === true);
  } catch {
    return false;
  }
}

/**
 * Fetch via UCB egress (primary). Falls back to lattice-gated fetch when UCB unavailable.
 * @param {string} moduleId
 * @param {string} upstreamUrl
 * @param {UcdFetchOptions} [opts]
 * @returns {Promise<{ transport: "ucd-ucb-egress" | "lattice-fallback", response: Response }>}
 */
export async function ucdFetch(moduleId, upstreamUrl, opts = {}) {
  const moduleSpec = loadUcdModuleSpec(moduleId, opts.modulesDir);
  const dataDir = opts.dataDir;
  ensureUcdManifest(moduleSpec, dataDir);

  const ucbBase = opts.ucbBase ?? resolveUcbBase();
  const apiKey = opts.ucbApiKey ?? resolveUcbApiKey(dataDir);
  const agentId = moduleSpec.agent_id ?? moduleSpec.module_id;

  if (apiKey && (await probeUcbHealth(ucbBase))) {
    const egressPath = mapUpstreamToEgressPath(moduleSpec, upstreamUrl);
    const url = `${ucbBase}/ucb/v1/egress${egressPath}`;
    // Caller headers come first, so they can never replace the key or the agent id.
    const headers = {
      ...(opts.headers ?? {}),
      Accept: opts.accept ?? "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-AEP-Agent-Id": agentId,
    };
    /** @type {RequestInit} */
    const init = { method: opts.method ?? "GET", headers };
    if (opts.body !== undefined) init.body = opts.body;
    const res = await fetch(url, init);
    return { transport: "ucd-ucb-egress", response: res };
  }

  if (opts.socketBase) {
    /** @type {Response} */
    const res = await latticeGatedFetch(
      upstreamUrl,
      {
        method: opts.method ?? "GET",
        // A caller header never replaces the Accept the options name.
        headers: { ...(opts.headers ?? {}), Accept: opts.accept ?? "application/json" },
        ...(opts.body === undefined ? {} : { body: opts.body }),
      },
      {
        agentId,
        channelId: `ch-ucd-${moduleId}`,
        gateway: "ucd",
        eventType: opts.eventType ?? "UCD_MODULE_FETCH",
      },
      opts.socketBase,
    );
    return { transport: "lattice-fallback", response: res };
  }

  throw new Error(
    `UCD fetch failed: UCB unavailable and no socketBase for lattice fallback (${moduleId})`,
  );
}

/**
 * @param {string} moduleId
 * @param {string} upstreamUrl
 * @param {UcdFetchOptions} [opts]
 */
export async function ucdFetchJson(moduleId, upstreamUrl, opts = {}) {
  const { transport, response } = await ucdFetch(moduleId, upstreamUrl, opts);
  if (!response.ok) {
    throw new Error(`UCD fetch failed ${response.status}: ${upstreamUrl} (${transport})`);
  }
  /** @type {unknown} */
  const data = await response.json();
  return { transport, data };
}

/**
 * @param {string} moduleId
 * @param {string} upstreamUrl
 * @param {string} destPath
 * @param {UcdFetchOptions} [opts]
 */
export async function ucdDownload(moduleId, upstreamUrl, destPath, opts = {}) {
  const { transport, response } = await ucdFetch(moduleId, upstreamUrl, {
    ...opts,
    accept: "application/octet-stream",
    eventType: "UCD_MODULE_DOWNLOAD",
  });
  if (!response.ok) {
    throw new Error(`UCD download failed ${response.status}: ${upstreamUrl} (${transport})`);
  }
  if (!response.body) {
    throw new Error(`UCD download returned no body: ${upstreamUrl} (${transport})`);
  }
  await pipeline(Readable.fromWeb(/** @type {import("node:stream/web").ReadableStream} */ (response.body)), createWriteStream(destPath));
  return { transport, destPath };
}
