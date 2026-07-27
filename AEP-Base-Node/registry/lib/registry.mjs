#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { latticeGatedFetch } from "../../../AEP-Components/lattice-channels/lib/lattice-transport.mjs";
import { defaultPaths } from "../../../AEP-Components/wizard/lib/paths.mjs";
import { collectSetupHooks } from "./setup-hooks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_ROOT = join(__dirname, "..");
const REPO_ROOT = join(REGISTRY_ROOT, "../..");

export const DEFAULT_COMPONENTS_REPO =
  "https://github.com/thePM001/AEP-agent-element-protocol";

export function resolveComponentsRepo(env = process.env) {
  return String(env.AEP_COMPONENTS_REPO || DEFAULT_COMPONENTS_REPO).replace(/\/$/, "");
}

export function remoteCatalogUrl(repoUrl, branch = "main") {
  const base = repoUrl.replace(/\/$/, "");
  if (base.includes("github.com")) {
    const slug = base.replace("https://github.com/", "");
    return `https://raw.githubusercontent.com/${slug}/${branch}/AEP-Base-Node/registry/catalog.json`;
  }
  return `${base}/AEP-Base-Node/registry/catalog.json`;
}

export function loadLocalCatalog(repoRoot = REPO_ROOT) {
  const path = join(repoRoot, "AEP-Base-Node/registry", "catalog.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`failed to parse catalog at ${path}: ${err.message}`);
  }
}

export function loadComponentManifest(manifestPath, repoRoot = REPO_ROOT) {
  const resolved = manifestPath.startsWith("/")
    ? manifestPath
    : join(repoRoot, manifestPath);
  if (!existsSync(resolved)) return null;
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (err) {
    throw new Error(`failed to parse manifest at ${resolved}: ${err.message}`);
  }
}

export async function fetchRemoteCatalog(env = process.env) {
  if (env.AEP_COMPONENTS_FETCH !== "1") return null;
  const repo = resolveComponentsRepo(env);
  const branch = env.AEP_COMPONENTS_BRANCH || "main";
  const url = remoteCatalogUrl(repo, branch);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const paths = defaultPaths();
    const res = await latticeGatedFetch(
      paths.socketBase,
      {
        agentId: "component-registry",
        channelId: "ch-registry-fetch",
        gateway: "registry",
        eventType: "REGISTRY_CATALOG_FETCH",
      },
      url,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export function mergeCatalogs(local, remote) {
  if (!remote?.components?.length) return local;
  const byId = new Map(local.components.map((c) => [c.id, c]));
  for (const comp of remote.components) {
    if (!byId.has(comp.id)) byId.set(comp.id, comp);
  }
  return {
    ...local,
    components: [...byId.values()],
    remote_merged_at: new Date().toISOString(),
    remote_repository: remote.repository ?? local.repository,
  };
}

export async function loadComponentRegistry(env = process.env, repoRoot = REPO_ROOT) {
  const local = loadLocalCatalog(repoRoot);
  const remote = await fetchRemoteCatalog(env);
  const catalog = mergeCatalogs(local, remote);
  const components = catalog.components.map((entry) => {
    const manifest = entry.manifest
      ? loadComponentManifest(entry.manifest, repoRoot)
      : null;
    return { ...entry, manifest };
  });
  return {
    version: catalog.version,
    protocol_version: catalog.protocol_version,
    bundled_offline: catalog.bundled_offline,
    repository: catalog.repository,
    remote_merged: Boolean(remote),
    components,
  };
}

export function groupComponentsByKind(components) {
  const groups = {};
  for (const comp of components) {
    const kind = comp.kind ?? "other";
    if (!groups[kind]) groups[kind] = [];
    groups[kind].push(comp);
  }
  return groups;
}

export function defaultEnabledComponentIds(components) {
  return components.filter((c) => c.default_enabled).map((c) => c.id);
}

export async function selectComponentsInteractive(components, rl, promptYesNo) {
  const selected = [];
  const groups = groupComponentsByKind(components);
  const order = ["protocol", "daemon", "agent", "library", "bridge", "ui", "connector", "wasm", "regulation", "compliance", "tooling", "wasm_extension", "wizard", "template", "other"];
  for (const kind of order) {
    const list = groups[kind];
    if (!list?.length) continue;
    console.log(`\n${kind.replace(/_/g, " ").toUpperCase()} components:`);
    for (const comp of list) {
      if (comp.bundled === false && comp.kind === "template") continue;
      const tag = comp.bundled ? "bundled" : "remote";
      const enable = await promptYesNo(
        rl,
        `  Enable ${comp.name} (${comp.id}) [${tag}]?`,
        comp.default_enabled,
      );
      if (enable) selected.push(comp.id);
    }
  }
  return selected;
}

export function extensionsDir(dataDir) {
  return join(dataDir, "extensions");
}

export function extensionsManifestPath(dataDir) {
  return join(extensionsDir(dataDir), "installed.json");
}

export function loadInstalledExtensions(dataDir) {
  const path = extensionsManifestPath(dataDir);
  if (!existsSync(path)) return { version: "1", installed: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { version: "1", installed: [] };
  }
}

export function writeInstalledExtensions(dataDir, installed) {
  const dir = extensionsDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const payload = {
    version: "1",
    updated_at: new Date().toISOString(),
    installed,
  };
  writeFileSync(extensionsManifestPath(dataDir), `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    chmodSync(extensionsManifestPath(dataDir), 0o600);
  } catch {
    /* windows */
  }
  return payload;
}

export function syncLrpsFromComponents(componentIds, components, existingLrps = []) {
  const lrps = new Set(existingLrps);
  const hookData = collectSetupHooks(componentIds, components);
  for (const lrp of hookData.lrps) lrps.add(lrp);
  for (const id of componentIds) {
    const comp = components.find((c) => c.id === id);
    if (comp?.lrp_id) lrps.add(comp.lrp_id);
    if (comp?.manifest?.lrp_id) lrps.add(comp.manifest.lrp_id);
  }
  return [...lrps];
}

const COMPOSER_PALETTE_SKIP = new Set([
  "composer-lite",
  "community-extension-template",
  "dynaep-core",
  "lattice-channels",
  "lattice-crypto",
  "lattice-memory",
  "aep-base-node",
  "cca",
  "epscom-signatures",
  "aep-typescript-sdk",
  "aep-dynaep-typescript",
  "aep-python-sdk",
  "session",
  "policy-engine",
  "evidence-ledger",
  "coding-governance",
  "gap",
  "agentmesh",
  "caw-framework",
]);

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

function composerNodeTypeForComponent(comp, manifest) {
  if (manifest?.composer?.node_type) return manifest.composer.node_type;
  if (manifest?.composer_node?.type) return manifest.composer_node.type;
  if (comp.kind === "compliance" || comp.kind === "regulation") return "regulation";
  if (comp.kind === "connector") return "connector";
  if (comp.id === "ucb" || comp.kind === "bridge") return "ucb";
  if (comp.kind === "wasm" || comp.kind === "wasm_extension") return "wasm_policy";
  if (comp.kind === "daemon") return "dock_validation";
  return "component";
}

function composerPaletteDedupeKey(comp, manifest, nodeType) {
  if (manifest?.composer_node?.catalog_id) {
    return `catalog:${manifest.composer_node.catalog_id}`;
  }
  return `registry:${comp.id}:${nodeType}`;
}

export function resolvePaletteExtensions(dataDir, repoRoot = REPO_ROOT) {
  const installed = loadInstalledExtensions(dataDir);
  const enabled = new Set(installed.installed.map((entry) => entry.id));
  const catalog = loadLocalCatalog(repoRoot);
  const extras = [];
  const seen = new Set();

  for (const comp of catalog.components) {
    if (!comp.bundled) continue;
    if (COMPOSER_PALETTE_SKIP.has(comp.id)) continue;
    if (comp.kind === "template") continue;

    const manifest = comp.manifest
      ? loadComponentManifest(comp.manifest, repoRoot)
      : null;
    const nodeType = composerNodeTypeForComponent(comp, manifest);
    const dedupe = composerPaletteDedupeKey(comp, manifest, nodeType);
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const source = enabled.has(comp.id) ? "installed" : "bundled";

    if (manifest?.composer_node) {
      extras.push({
        ...manifest.composer_node,
        type: manifest.composer_node.type ?? nodeType,
        label: manifest.composer_node.label ?? comp.name ?? comp.id,
        short:
          manifest.composer_node.short
          ?? String(comp.id).slice(0, 2).toUpperCase(),
        color:
          manifest.composer_node.color
          ?? COMPOSER_KIND_COLORS[comp.kind]
          ?? "#94a3b8",
        registry_id: comp.id,
        catalog_id: manifest.composer_node.catalog_id ?? `registry-${comp.id}`,
        kind: comp.kind,
        lrp_id: comp.lrp_id ?? manifest?.lrp_id ?? null,
        source,
        description:
          manifest.composer_node.description
          ?? manifest?.description
          ?? comp.description
          ?? comp.id,
      });
      continue;
    }

    extras.push({
      type: nodeType,
      label: comp.name ?? comp.id,
      short: (manifest?.composer?.short ?? String(comp.id).slice(0, 2)).toUpperCase(),
      color: manifest?.composer?.color ?? COMPOSER_KIND_COLORS[comp.kind] ?? "#94a3b8",
      shape:
        manifest?.composer?.shape
        ?? (nodeType === "connector" || nodeType === "ucb" ? "diamond" : "card"),
      description: manifest?.description ?? comp.description ?? comp.id,
      registry_id: comp.id,
      catalog_id: `registry-${comp.id}`,
      kind: comp.kind,
      lrp_id: comp.lrp_id ?? manifest?.lrp_id ?? null,
      source,
    });
  }
  return extras;
}

export function listRegistryComponentFiles(repoRoot = REPO_ROOT) {
  const dir = join(repoRoot, "AEP-Base-Node/registry", "components");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"));
}