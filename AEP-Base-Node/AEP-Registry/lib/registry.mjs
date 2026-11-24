#!/usr/bin/env node
// @ts-check

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The one source of the gated fetch is lattice-gated-fetch.ts; this is its emitted module.
import { latticeGatedFetch } from "../../../AEP-Components/lattice-channels/lib/lattice-gated-fetch.js";
import { defaultPaths } from "../../../AEP-Components/platform-core/lib/paths.mjs";
import { collectSetupHooks } from "./setup-hooks.mjs";

/** @typedef {Record<string, unknown>} Json */

/**
 * @typedef {object} CatalogEntry
 * @property {string} id
 * @property {string} [name]
 * @property {string} [kind]
 * @property {string} [status]
 * @property {string} [path]
 * @property {string} [manifest]
 * @property {string} [description]
 * @property {string} [lrp_id]
 * @property {boolean} [bundled]
 * @property {boolean} [default_enabled]
 */

/**
 * @typedef {object} Catalog
 * @property {string} [version]
 * @property {string} [protocol_version]
 * @property {boolean} [bundled_offline]
 * @property {string} [repository]
 * @property {CatalogEntry[]} components
 */

/**
 * @typedef {Omit<CatalogEntry, "manifest"> & { manifest: Json | null }} RegistryComponent
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_ROOT = join(__dirname, "..");
const REPO_ROOT = join(REGISTRY_ROOT, "../..");

export const DEFAULT_COMPONENTS_REPO = "";

/**
 * @param {unknown} v
 * @returns {v is Json}
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** @param {unknown} e */
function message(e) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Keep the catalog entries that carry a string id. Other fields stay as read.
 * @param {unknown} raw
 * @param {string} where
 * @returns {Catalog}
 */
export function asCatalog(raw, where) {
  if (!isObject(raw) || !Array.isArray(raw.components)) {
    throw new Error(`${where} is not a catalog: it needs a components list`);
  }
  const components = raw.components.filter(
    /** @returns {c is CatalogEntry} */ (c) => isObject(c) && typeof c.id === "string" && c.id.length > 0,
  );
  return { ...raw, components };
}

/** @param {NodeJS.ProcessEnv} [env] */
export function resolveComponentsRepo(env = process.env) {
  return String(env.AEP_COMPONENTS_REPO || DEFAULT_COMPONENTS_REPO).replace(/\/$/, "");
}

/**
 * @param {string} repoUrl
 * @param {string} [branch]
 */
export function remoteCatalogUrl(repoUrl, branch = "main") {
  const base = repoUrl.replace(/\/$/, "");
  if (base.startsWith("https://github.com/")) {
    const slug = base.slice("https://github.com/".length);
    return `https://raw.githubusercontent.com/${slug}/${branch}/AEP-Base-Node/AEP-Registry/catalog.json`;
  }
  return `${base}/AEP-Base-Node/AEP-Registry/catalog.json`;
}

/**
 * @param {string} [repoRoot]
 * @returns {Catalog}
 */
export function loadLocalCatalog(repoRoot = REPO_ROOT) {
  const path = join(repoRoot, "AEP-Base-Node/AEP-Registry", "catalog.json");
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`failed to parse catalog at ${path}: ${message(err)}`, { cause: err });
  }
  return asCatalog(raw, path);
}

/**
 * The absolute path of a repository relative path, or null when the path
 * leaves the repository (an absolute path or parent steps out of it).
 * @param {string} relPath
 * @param {string} repoRoot
 * @returns {string | null}
 */
export function insideRepo(relPath, repoRoot) {
  if (isAbsolute(relPath)) return null;
  const root = resolve(repoRoot);
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

/**
 * Load a component manifest. The path is relative to the repository and may
 * not leave it. A missing file gives null and a file that is not a JSON
 * object throws.
 * @param {string} manifestPath
 * @param {string} [repoRoot]
 * @returns {Json | null}
 */
export function loadComponentManifest(manifestPath, repoRoot = REPO_ROOT) {
  const resolved = insideRepo(manifestPath, repoRoot);
  if (resolved === null) {
    throw new Error(`manifest path ${manifestPath} leaves the repository`);
  }
  if (!existsSync(resolved)) return null;
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8"));
  } catch (err) {
    throw new Error(`failed to parse manifest at ${resolved}: ${message(err)}`, { cause: err });
  }
  if (!isObject(parsed)) throw new Error(`manifest at ${resolved} is not a JSON object`);
  return parsed;
}

/**
 * Fetch the remote catalog through the lattice gated fetch. Only runs when
 * AEP_COMPONENTS_FETCH is 1 and a repository is set.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<Catalog | null>}
 */
export async function fetchRemoteCatalog(env = process.env) {
  if (env.AEP_COMPONENTS_FETCH !== "1") return null;
  const repo = resolveComponentsRepo(env);
  if (!/^https:\/\//.test(repo)) return null;
  const branch = env.AEP_COMPONENTS_BRANCH || "main";
  const url = remoteCatalogUrl(repo, branch);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const paths = defaultPaths();
    /** @type {Response} */
    const res = await latticeGatedFetch(
      url,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
      {
        agentId: "component-registry",
        channelId: "ch-registry-fetch",
        gateway: "registry",
        eventType: "REGISTRY_CATALOG_FETCH",
      },
      paths.socketBase,
    );
    if (!res.ok) return null;
    return asCatalog(await res.json(), url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Add the remote components the local catalog lacks. A remote component is
 * never bundled, never enabled by default and carries no manifest path, so a
 * remote catalog cannot point the loader at a local file.
 * @param {Catalog} local
 * @param {Catalog | null} remote
 * @returns {Catalog & { remote_merged_at?: string, remote_repository?: string | undefined }}
 */
export function mergeCatalogs(local, remote) {
  if (!remote?.components.length) return local;
  /** @type {Map<string, CatalogEntry>} */
  const byId = new Map(local.components.map((c) => [c.id, c]));
  for (const comp of remote.components) {
    if (byId.has(comp.id)) continue;
    const { manifest: _manifest, ...rest } = comp;
    byId.set(comp.id, { ...rest, bundled: false, default_enabled: false });
  }
  return {
    ...local,
    components: [...byId.values()],
    remote_merged_at: new Date().toISOString(),
    remote_repository: remote.repository ?? local.repository,
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [repoRoot]
 */
export async function loadComponentRegistry(env = process.env, repoRoot = REPO_ROOT) {
  const local = loadLocalCatalog(repoRoot);
  const remote = await fetchRemoteCatalog(env);
  const catalog = mergeCatalogs(local, remote);
  /** @type {RegistryComponent[]} */
  const components = catalog.components.map((entry) => ({
    ...entry,
    manifest: entry.manifest ? loadComponentManifest(entry.manifest, repoRoot) : null,
  }));
  return {
    version: catalog.version,
    protocol_version: catalog.protocol_version,
    bundled_offline: catalog.bundled_offline,
    repository: catalog.repository,
    remote_merged: Boolean(remote),
    components,
  };
}

/**
 * @template {{ kind?: string | undefined }} T
 * @param {T[]} components
 * @returns {Record<string, T[]>}
 */
export function groupComponentsByKind(components) {
  // A Map keeps a kind such as constructor or __proto__ an ordinary key.
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const comp of components) {
    const kind = comp.kind ?? "other";
    const list = groups.get(kind) ?? [];
    list.push(comp);
    groups.set(kind, list);
  }
  return Object.fromEntries(groups);
}

/** @param {CatalogEntry[]} components */
export function defaultEnabledComponentIds(components) {
  return components.filter((c) => c.default_enabled).map((c) => c.id);
}

/**
 * @template R
 * @param {CatalogEntry[]} components
 * @param {R} rl
 * @param {(rl: R, question: string, def: boolean) => Promise<boolean>} promptYesNo
 * @param {(line: string) => void} [log]
 */
export async function selectComponentsInteractive(components, rl, promptYesNo, log = console.log) {
  /** @type {string[]} */
  const selected = [];
  const groups = groupComponentsByKind(components);
  const order = ["protocol", "daemon", "agent", "library", "bridge", "ui", "connector", "wasm", "regulation", "compliance", "tooling", "wasm_extension", "wizard", "template", "other"];
  for (const kind of order) {
    const list = groups[kind];
    if (!list?.length) continue;
    log(`\n${kind.replace(/_/g, " ").toUpperCase()} components:`);
    for (const comp of list) {
      if (comp.bundled === false && comp.kind === "template") continue;
      if (comp.status === "retired") continue;
      const tag = comp.bundled ? "bundled" : "remote";
      const enable = await promptYesNo(rl, `  Enable ${comp.name ?? comp.id} (${comp.id}) [${tag}]?`, comp.default_enabled === true);
      if (enable) selected.push(comp.id);
    }
  }
  return selected;
}

/** @param {string} dataDir */
export function extensionsDir(dataDir) {
  return join(dataDir, "extensions");
}

/** @param {string} dataDir */
export function extensionsManifestPath(dataDir) {
  return join(extensionsDir(dataDir), "installed.json");
}

/**
 * @typedef {object} InstalledExtensions
 * @property {string} version
 * @property {string} [updated_at]
 * @property {{ id: string }[]} installed
 */

/**
 * @param {string} dataDir
 * @returns {InstalledExtensions}
 */
export function loadInstalledExtensions(dataDir) {
  const path = extensionsManifestPath(dataDir);
  const empty = { version: "1", installed: [] };
  if (!existsSync(path)) return empty;
  try {
    /** @type {unknown} */
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!isObject(raw) || !Array.isArray(raw.installed)) return empty;
    return {
      version: typeof raw.version === "string" ? raw.version : "1",
      ...(typeof raw.updated_at === "string" ? { updated_at: raw.updated_at } : {}),
      installed: raw.installed.filter(
        /** @returns {e is { id: string }} */ (e) => isObject(e) && typeof e.id === "string",
      ),
    };
  } catch {
    return empty;
  }
}

/**
 * @param {string} dataDir
 * @param {{ id: string }[]} installed
 */
export function writeInstalledExtensions(dataDir, installed) {
  const dir = extensionsDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const payload = {
    version: "1",
    updated_at: new Date().toISOString(),
    installed,
  };
  writeFileSync(extensionsManifestPath(dataDir), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(extensionsManifestPath(dataDir), 0o600);
  } catch {
    // A file system without modes, such as on Windows.
  }
  return payload;
}

/**
 * @param {string[]} componentIds
 * @param {RegistryComponent[]} components
 * @param {string[]} [existingLrps]
 */
export function syncLrpsFromComponents(componentIds, components, existingLrps = []) {
  const lrps = new Set(existingLrps);
  for (const lrp of collectSetupHooks(componentIds, components).lrps) lrps.add(lrp);
  return [...lrps];
}

const COMPOSER_PALETTE_SKIP = new Set([
  "community-extension-template",
  "dynaep-core",
  "lattice-channels",
  "lattice-gated-fetch",
  "lattice-crypto",
  "lattice-memory",
  "aep-base-node",
  "session",
  "policy-engine",
  "evidence-ledger",
  "gap",
  "agentmesh",
  "caw-framework",
]);

/** @type {Record<string, string>} */
const COMPOSER_KIND_COLORS = {
  daemon: "#4af2c8",
  library: "#6b9fff",
  protocol: "#3de8ff",
  bridge: "#a78bfa",
  connector: "#38bdf8",
  compliance: "#f59e0b",
  regulation: "#fbbf24",
  wasm: "#a78bfa",
  wasm_extension: "#a78bfa",
  tooling: "#94a3b8",
  agent: "#3de8ff",
};

/**
 * @param {Json} obj
 * @param {string} key
 * @returns {Json}
 */
function sub(obj, key) {
  const v = obj[key];
  return isObject(v) ? v : {};
}

/**
 * @param {Json} obj
 * @param {string} key
 * @returns {string | undefined}
 */
function str(obj, key) {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * @param {CatalogEntry} comp
 * @param {Json} manifest
 */
function composerNodeTypeForComponent(comp, manifest) {
  const explicit = str(sub(manifest, "composer"), "node_type") ?? str(sub(manifest, "composer_node"), "type");
  if (explicit) return explicit;
  if (comp.kind === "compliance" || comp.kind === "regulation") return "regulation";
  if (comp.kind === "connector") return "connector";
  if (comp.id === "ucb" || comp.kind === "bridge") return "ucb";
  if (comp.kind === "wasm" || comp.kind === "wasm_extension") return "wasm_policy";
  if (comp.kind === "daemon") return "dock_validation";
  return "component";
}

/**
 * The palette entries of the bundled components for the composer.
 * @param {string} dataDir
 * @param {string} [repoRoot]
 */
export function resolvePaletteExtensions(dataDir, repoRoot = REPO_ROOT) {
  const installed = loadInstalledExtensions(dataDir);
  const enabled = new Set(installed.installed.map((entry) => entry.id));
  const catalog = loadLocalCatalog(repoRoot);
  /** @type {Json[]} */
  const extras = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const comp of catalog.components) {
    if (!comp.bundled) continue;
    if (COMPOSER_PALETTE_SKIP.has(comp.id)) continue;
    if (comp.kind === "template") continue;

    const manifest = (comp.manifest ? loadComponentManifest(comp.manifest, repoRoot) : null) ?? {};
    const nodeType = composerNodeTypeForComponent(comp, manifest);
    const node = isObject(manifest.composer_node) ? manifest.composer_node : null;
    const composer = sub(manifest, "composer");
    const catalogId = node ? str(node, "catalog_id") : undefined;
    const dedupe = catalogId ? `catalog:${catalogId}` : `registry:${comp.id}:${nodeType}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const source = enabled.has(comp.id) ? "installed" : "bundled";
    const kindColor = (comp.kind ? COMPOSER_KIND_COLORS[comp.kind] : undefined) ?? "#94a3b8";
    const lrpId = comp.lrp_id ?? str(manifest, "lrp_id") ?? null;
    const description = str(manifest, "description") ?? comp.description ?? comp.id;

    if (node) {
      extras.push({
        ...node,
        type: str(node, "type") ?? nodeType,
        label: str(node, "label") ?? comp.name ?? comp.id,
        short: str(node, "short") ?? comp.id.slice(0, 2).toUpperCase(),
        color: str(node, "color") ?? kindColor,
        registry_id: comp.id,
        catalog_id: catalogId ?? `registry-${comp.id}`,
        kind: comp.kind,
        lrp_id: lrpId,
        source,
        description: str(node, "description") ?? description,
      });
      continue;
    }

    extras.push({
      type: nodeType,
      label: comp.name ?? comp.id,
      short: (str(composer, "short") ?? comp.id.slice(0, 2)).toUpperCase(),
      color: str(composer, "color") ?? kindColor,
      shape: str(composer, "shape") ?? (nodeType === "connector" || nodeType === "ucb" ? "diamond" : "card"),
      description,
      registry_id: comp.id,
      catalog_id: `registry-${comp.id}`,
      kind: comp.kind,
      lrp_id: lrpId,
      source,
    });
  }
  return extras;
}

/** @param {string} [repoRoot] */
export function listRegistryComponentFiles(repoRoot = REPO_ROOT) {
  const dir = join(repoRoot, "AEP-Base-Node/AEP-Registry", "components");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"));
}
