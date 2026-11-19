#!/usr/bin/env node
// Wrap coverage report.
//
// AEP governs traffic that crosses a declared wrap. An agent credential, an
// egress route or a tool that no wrap governs acts ungoverned. This module
// reads a wrap coverage inventory, collects every wrap that the GAP documents
// of the deployment declare and lists each entry of the deployment with the
// wrap that governs it. An entry that no wrap governs is UNMATCHED.
//
// Usage: node AEP-Components/wrap-coverage/lib/wrap-coverage.mjs <inventory.yaml> [--json]
// Exit 0 when no entry is unmatched, 1 when one or more entries are unmatched
// and 2 when the inventory or a file it names cannot be read or is invalid.

import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";

export const INVENTORY_KIND = "aep.wrap-coverage.inventory";
export const INVENTORY_VERSION = 1;

/** Repository root: this file sits at AEP-Components/wrap-coverage/lib. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const TOP_LEVEL_KEYS = new Set([
  "kind",
  "version",
  "name",
  "gap_dirs",
  "lattice",
  "ucb_manifests",
  "credentials",
  "tools",
]);
const CREDENTIAL_KEYS = new Set(["id", "kind", "description", "agent_id", "action"]);
const TOOL_KEYS = new Set(["name", "description", "agent_id", "action"]);

/** The GAP kind of the egress policy of the Rust CAW. */
export const EGRESS_POLICY_KIND = "aep.caw.egress_policy";
// The host rules of a route, the same as the GAP compiler (gap-compile.mjs) and the
// route matcher of the CAW (aep-caw-policy route.rs) apply: a lower case host name of
// at least two labels, a wildcard under such a name or one variable. An address in any
// spelling is refused, including a last label that is a decimal or hexadecimal number.
const HOST_NAME = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const HOST_VARIABLE = /^\$\{[A-Z][A-Z0-9_]*\}$/;
const NUMBER_LABEL = /^(0x[0-9a-f]+|[0-9]+)$/i;

/**
 * @typedef {{ agent_id: string, action: string }} Grant
 * @typedef {{ name: string, grants: Grant[], sources: string[] }} Wrap
 * @typedef {Map<string, Wrap>} WrapTable
 * @typedef {{ label: string, docs: unknown[] }} GapFile
 * @typedef {{ id: string, kind: string, description: string, agent_id: string, action: string }} CredentialItem
 * @typedef {{ name: string, description: string, agent_id: string, action: string }} ToolItem
 * @typedef {{
 *   kind: string,
 *   version: number,
 *   name: string,
 *   gap_dirs: string[],
 *   lattice: string | null,
 *   ucb_manifests: string[],
 *   credentials: CredentialItem[],
 *   tools: ToolItem[],
 * }} Inventory
 * @typedef {"MATCHED" | "UNMATCHED"} Status
 * @typedef {{ kind: string, id: string, status: Status, wrap: string | null, reason: string | null, source: string }} Entry
 * @typedef {{ entries: number, matched: number, unmatched: number }} Summary
 * @typedef {{ inventory: string, entries: Entry[], summary: Summary }} Report
 * @typedef {{ root?: string, inventoryPath?: string }} BuildOptions
 */

/** An inventory or a file it names that cannot be read or is invalid. */
export class InventoryError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "InventoryError";
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Path for output: relative to the repository root with forward slashes when
 * the file sits inside it, absolute otherwise.
 * @param {string} abs
 * @param {string} [root]
 */
export function displayPath(abs, root = REPO_ROOT) {
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return abs;
  return rel.split(sep).join("/");
}

/**
 * Every document of a YAML or JSON text. A multi-document YAML file yields one
 * value per document; empty documents are dropped.
 * @param {string} text
 * @param {string} label
 * @returns {unknown[]}
 */
export function parseDocuments(text, label) {
  const docs = parseAllDocuments(text);
  const list = Array.isArray(docs) ? docs : [docs];
  /** @type {unknown[]} */
  const out = [];
  for (const doc of list) {
    if (doc.errors.length > 0) {
      const first = doc.errors[0];
      throw new InventoryError(`${label}: cannot parse: ${first ? first.message : "unknown error"}`);
    }
    const value = doc.toJS();
    if (value !== null && value !== undefined) out.push(value);
  }
  return out;
}

/**
 * @param {string} file
 * @param {string} label
 */
function readText(file, label) {
  try {
    return readFileSync(file, "utf8");
  } catch (err) {
    throw new InventoryError(`${label}: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * The one document of a single document file.
 * @param {string} file
 * @param {string} label
 */
function readSingleDocument(file, label) {
  const docs = parseDocuments(readText(file, label), label);
  if (docs.length !== 1) throw new InventoryError(`${label}: expected one document, found ${docs.length}`);
  return docs[0];
}

/**
 * @param {Record<string, unknown>} item
 * @param {string} key
 * @param {string} where
 * @param {boolean} required
 * @returns {string}
 */
function stringField(item, key, where, required) {
  const value = item[key];
  if (value === undefined || value === null) {
    if (required) throw new InventoryError(`${where}: ${key} is required`);
    return "";
  }
  if (typeof value !== "string") throw new InventoryError(`${where}: ${key} must be a string`);
  if (required && value.trim() === "") throw new InventoryError(`${where}: ${key} must not be empty`);
  return value;
}

/**
 * @param {Record<string, unknown>} item
 * @param {Set<string>} allowed
 * @param {string} where
 */
function rejectUnknownKeys(item, allowed, where) {
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) throw new InventoryError(`${where}: unknown key ${key}`);
  }
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown[]}
 */
function listField(value, key) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InventoryError(`inventory: ${key} must be a list`);
  return value;
}

/**
 * Check the shape of a parsed inventory document and return it with every
 * optional list present.
 * @param {unknown} doc
 * @returns {Inventory}
 */
export function validateInventory(doc) {
  if (!isRecord(doc)) throw new InventoryError("inventory: the document must be a mapping");
  if (doc.caw !== undefined) {
    throw new InventoryError(
      "inventory: the key caw named policy files of the retired Go CAW; the report reads the egress policies of the Rust CAW from the GAP documents of gap_dirs",
    );
  }
  rejectUnknownKeys(doc, TOP_LEVEL_KEYS, "inventory");
  if (doc.kind !== INVENTORY_KIND) {
    throw new InventoryError(`inventory: kind must be ${INVENTORY_KIND}, found ${JSON.stringify(doc.kind ?? null)}`);
  }
  if (doc.version !== INVENTORY_VERSION) {
    throw new InventoryError(`inventory: version must be ${INVENTORY_VERSION}, found ${JSON.stringify(doc.version ?? null)}`);
  }
  const name = stringField(doc, "name", "inventory", false);
  const gapDirs = listField(doc.gap_dirs, "gap_dirs").map((dir, i) => {
    if (typeof dir !== "string" || dir.trim() === "") throw new InventoryError(`inventory: gap_dirs[${i}] must be a path`);
    return dir;
  });
  let lattice = null;
  if (doc.lattice !== undefined && doc.lattice !== null) {
    if (typeof doc.lattice !== "string" || doc.lattice.trim() === "") throw new InventoryError("inventory: lattice must be a path");
    lattice = doc.lattice;
  }
  const ucbManifests = listField(doc.ucb_manifests, "ucb_manifests").map((file, i) => {
    if (typeof file !== "string" || file.trim() === "") throw new InventoryError(`inventory: ucb_manifests[${i}] must be a path`);
    return file;
  });
  const credentials = listField(doc.credentials, "credentials").map((item, i) => {
    const where = `inventory: credentials[${i}]`;
    if (!isRecord(item)) throw new InventoryError(`${where}: must be a mapping`);
    rejectUnknownKeys(item, CREDENTIAL_KEYS, where);
    return {
      id: stringField(item, "id", where, true),
      kind: stringField(item, "kind", where, false),
      description: stringField(item, "description", where, false),
      agent_id: stringField(item, "agent_id", where, true),
      action: stringField(item, "action", where, true),
    };
  });
  const tools = listField(doc.tools, "tools").map((item, i) => {
    const where = `inventory: tools[${i}]`;
    if (!isRecord(item)) throw new InventoryError(`${where}: must be a mapping`);
    rejectUnknownKeys(item, TOOL_KEYS, where);
    return {
      name: stringField(item, "name", where, true),
      description: stringField(item, "description", where, false),
      agent_id: stringField(item, "agent_id", where, true),
      action: stringField(item, "action", where, true),
    };
  });
  return {
    kind: INVENTORY_KIND,
    version: INVENTORY_VERSION,
    name,
    gap_dirs: gapDirs,
    lattice,
    ucb_manifests: ucbManifests,
    credentials,
    tools,
  };
}

/**
 * Read and check an inventory file.
 * @param {string} file
 * @returns {{ inventory: Inventory, baseDir: string, path: string }}
 */
export function loadInventory(file) {
  const abs = resolve(file);
  const doc = readSingleDocument(abs, "inventory");
  return { inventory: validateInventory(doc), baseDir: dirname(abs), path: abs };
}

/**
 * Every *.gap file below a folder, in path order.
 * @param {string} dir
 * @returns {string[]}
 */
function gapFiles(dir) {
  /** @type {string[]} */
  const out = [];
  let names;
  try {
    names = readdirSync(dir).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    throw new InventoryError(`gap_dirs: cannot read ${dir}: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const name of names) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) out.push(...gapFiles(full));
    else if (name.endsWith(".gap")) out.push(full);
  }
  return out;
}

/**
 * The grants of one GAP document's metadata.agent_permission.
 * @param {unknown} list
 * @returns {Grant[]}
 */
function grantsOf(list) {
  if (!Array.isArray(list)) return [];
  /** @type {Grant[]} */
  const out = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const agent = item.agent_id;
    const action = item.action;
    if (typeof agent === "string" && typeof action === "string") out.push({ agent_id: agent, action });
  }
  return out;
}

/**
 * Add the wraps that the documents of one GAP file declare to a table.
 * @param {WrapTable} table
 * @param {unknown[]} docs
 * @param {string} source
 */
export function addWrapsFromDocuments(table, docs, source) {
  for (const doc of docs) {
    if (!isRecord(doc) || !isRecord(doc.metadata)) continue;
    const name = doc.metadata.wrap;
    if (typeof name !== "string" || name.trim() === "") continue;
    let wrap = table.get(name);
    if (!wrap) {
      wrap = { name, grants: [], sources: [] };
      table.set(name, wrap);
    }
    wrap.grants.push(...grantsOf(doc.metadata.agent_permission));
    if (!wrap.sources.includes(source)) wrap.sources.push(source);
  }
  return table;
}

/**
 * The parsed documents of every GAP file in the given folders, each with its label.
 * @param {string[]} dirs absolute folders
 * @param {string} [root]
 * @returns {GapFile[]}
 */
export function readGapFiles(dirs, root = REPO_ROOT) {
  /** @type {GapFile[]} */
  const out = [];
  for (const dir of dirs) {
    for (const file of gapFiles(dir)) {
      const label = displayPath(file, root);
      out.push({ label, docs: parseDocuments(readText(file, label), label) });
    }
  }
  return out;
}

/**
 * Every wrap that the documents of the given GAP files declare.
 * @param {GapFile[]} files
 * @returns {WrapTable}
 */
export function wrapsOfFiles(files) {
  /** @type {WrapTable} */
  const table = new Map();
  for (const file of files) addWrapsFromDocuments(table, file.docs, file.label);
  return table;
}

/**
 * Every wrap that the GAP documents in the given folders declare.
 * @param {string[]} dirs absolute folders
 * @param {string} [root]
 * @returns {WrapTable}
 */
export function collectWraps(dirs, root = REPO_ROOT) {
  return wrapsOfFiles(readGapFiles(dirs, root));
}

/**
 * A grant (a, x) covers agent A and action X when a is A or "*" and x is X or "*".
 * @param {Grant} grant
 * @param {string} agent
 * @param {string} action
 */
export function grantCovers(grant, agent, action) {
  return (grant.agent_id === agent || grant.agent_id === "*") && (grant.action === action || grant.action === "*");
}

/**
 * The first wrap that grants an agent an action. Null when none does.
 * @param {WrapTable} wraps
 * @param {string} agent
 * @param {string} action
 * @returns {string | null}
 */
export function findWrapFor(wraps, agent, action) {
  for (const wrap of wraps.values()) {
    if (wrap.grants.some((g) => grantCovers(g, agent, action))) return wrap.name;
  }
  return null;
}

/**
 * The first wrap that grants an agent any action. Null when none does.
 * @param {WrapTable} wraps
 * @param {string} agent
 * @returns {string | null}
 */
export function findWrapForAgent(wraps, agent) {
  for (const wrap of wraps.values()) {
    if (wrap.grants.some((g) => g.agent_id === agent || g.agent_id === "*")) return wrap.name;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string").map((v) => v.trim());
}

/**
 * Why the host of a route lets more through than one named host. Null for a
 * host the CAW accepts. A host that holds only `*`, `?` and `.` names any host and
 * a wildcard over one label names every host under a top level label. Both are
 * catch-all routes. The GAP compiler and the CAW refuse every host this function
 * names a problem for.
 * @param {unknown} host
 * @returns {string | null}
 */
export function routeHostProblem(host) {
  if (typeof host !== "string" || host.trim() === "") return "the route names no host";
  if (HOST_VARIABLE.test(host)) return null;
  if (/^[*?.]+$/.test(host)) return "catch-all route lets any host through";
  if (host.startsWith("*.") && /^[a-z0-9-]+$/.test(host.slice(2))) {
    return `catch-all route lets every name under .${host.slice(2)} through`;
  }
  const last = host.split(".").pop() ?? "";
  if (host.startsWith("[") || host.includes(":") || NUMBER_LABEL.test(last)) return "the route names an address instead of a host";
  if (!HOST_NAME.test(host)) return `the host ${host} is not a lower case host name`;
  return null;
}

/**
 * The wrap of a GAP file: the metadata.wrap of its instruction document, the
 * document with an address, as the GAP compiler reads it. Null when it has none.
 * @param {unknown[]} docs
 * @returns {string | null}
 */
function instructionWrap(docs) {
  const instruction = docs.find((d) => isRecord(d) && isRecord(d.address));
  if (!isRecord(instruction) || !isRecord(instruction.metadata)) return null;
  const wrap = instruction.metadata.wrap;
  return typeof wrap === "string" && wrap.trim() !== "" ? wrap : null;
}

/**
 * The egress_route entries of the CAW egress policies of one GAP file. Each allow
 * route is an entry with the id <policy>/<route> under the wrap of its file. A route
 * whose host is a catch-all, an address or no host name is UNMATCHED, as is a
 * policy whose unmatched is not deny. A deny route is not an entry.
 * @param {unknown[]} docs the documents of one GAP file
 * @param {string} source
 * @returns {Entry[]}
 */
export function egressEntries(docs, source) {
  const wrap = instructionWrap(docs);
  /** @type {Entry[]} */
  const out = [];
  /**
   * @param {string} id
   * @param {string | null} problem
   */
  const push = (id, problem) => {
    if (problem !== null) {
      out.push({ kind: "egress_route", id, status: "UNMATCHED", wrap: null, reason: `${problem}; the CAW refuses the policy`, source });
    } else if (wrap === null) {
      out.push({ kind: "egress_route", id, status: "UNMATCHED", wrap: null, reason: "the GAP file declares no wrap", source });
    } else {
      out.push({ kind: "egress_route", id, status: "MATCHED", wrap, reason: null, source });
    }
  };
  docs.forEach((doc, i) => {
    if (!isRecord(doc) || doc.kind !== EGRESS_POLICY_KIND) return;
    const policy = typeof doc.name === "string" && doc.name !== "" ? doc.name : `[${i}]`;
    if (doc.unmatched !== undefined && doc.unmatched !== "deny") {
      push(policy, `unmatched is ${String(doc.unmatched)} so a destination with no route would pass`);
    }
    const routes = Array.isArray(doc.routes) ? doc.routes : [];
    routes.forEach((route, j) => {
      if (!isRecord(route) || route.decision === "deny") return;
      const name = typeof route.name === "string" && route.name !== "" ? route.name : `[${j}]`;
      push(`${policy}/${name}`, routeHostProblem(route.host));
    });
  });
  return out;
}

/**
 * The entries of one UCB task manifest.
 * @param {unknown} manifest parsed manifest
 * @param {WrapTable} wraps
 * @param {string} source
 * @returns {Entry[]}
 */
export function ucbEntries(manifest, wraps, source) {
  if (!isRecord(manifest)) throw new InventoryError(`${source}: a UCB manifest must be a mapping`);
  const agent = manifest.agent_id;
  if (typeof agent !== "string" || agent.trim() === "") throw new InventoryError(`${source}: agent_id is required`);
  const wrap = findWrapForAgent(wraps, agent);
  const reason = wrap === null ? `no wrap grants agent ${agent} any action` : null;
  const status = wrap === null ? "UNMATCHED" : "MATCHED";
  /** @type {Entry[]} */
  const out = [];
  const egress = isRecord(manifest.egress) ? manifest.egress : {};
  const routes = Array.isArray(egress.routes) ? egress.routes : [];
  routes.forEach((route, i) => {
    if (!isRecord(route)) return;
    const prefix = typeof route.path_prefix === "string" && route.path_prefix !== "" ? route.path_prefix : `[${i}]`;
    out.push({ kind: "egress_route", id: `${agent}:egress${prefix}`, status, wrap, reason, source });
    if (typeof route.auth_token_env === "string" && route.auth_token_env !== "") {
      out.push({ kind: "credential", id: `${agent}:env:${route.auth_token_env}`, status, wrap, reason, source });
    }
  });
  return out;
}

/**
 * The action grant entries of a lattice document.
 * @param {unknown} lattice
 * @param {WrapTable} wraps
 * @param {string} source
 * @returns {Entry[]}
 */
export function latticeEntries(lattice, wraps, source) {
  if (!isRecord(lattice)) throw new InventoryError(`${source}: a lattice must be a mapping`);
  const actions = isRecord(lattice.actions) ? lattice.actions : {};
  /** @type {Entry[]} */
  const out = [];
  for (const [action, node] of Object.entries(actions)) {
    if (!isRecord(node)) continue;
    for (const agent of stringList(node.agent_permission)) {
      const wrap = findWrapFor(wraps, agent, action);
      out.push(
        wrap === null
          ? { kind: "action_grant", id: `${action}@${agent}`, status: "UNMATCHED", wrap: null, reason: `no wrap grants ${agent} ${action}`, source }
          : { kind: "action_grant", id: `${action}@${agent}`, status: "MATCHED", wrap, reason: null, source },
      );
    }
  }
  return out;
}

/**
 * @param {Entry[]} entries
 * @returns {Summary}
 */
export function summarize(entries) {
  return {
    entries: entries.length,
    matched: entries.filter((e) => e.status === "MATCHED").length,
    unmatched: entries.filter((e) => e.status === "UNMATCHED").length,
  };
}

/**
 * Build the coverage report of an inventory. Paths in the inventory resolve
 * against baseDir.
 * @param {Inventory} inventory
 * @param {string} baseDir
 * @param {BuildOptions} [options]
 * @returns {Report}
 */
export function buildCoverage(inventory, baseDir, options = {}) {
  const root = options.root ?? REPO_ROOT;
  const inventorySource = options.inventoryPath ? displayPath(options.inventoryPath, root) : displayPath(baseDir, root);
  const gapFiles = readGapFiles(
    inventory.gap_dirs.map((d) => resolve(baseDir, d)),
    root,
  );
  const wraps = wrapsOfFiles(gapFiles);
  /** @type {Entry[]} */
  const entries = [];

  for (const cred of inventory.credentials) {
    const wrap = findWrapFor(wraps, cred.agent_id, cred.action);
    entries.push(
      wrap === null
        ? { kind: "credential", id: cred.id, status: "UNMATCHED", wrap: null, reason: `no wrap grants ${cred.agent_id} ${cred.action}`, source: inventorySource }
        : { kind: "credential", id: cred.id, status: "MATCHED", wrap, reason: null, source: inventorySource },
    );
  }
  for (const tool of inventory.tools) {
    const wrap = findWrapFor(wraps, tool.agent_id, tool.action);
    entries.push(
      wrap === null
        ? { kind: "tool", id: tool.name, status: "UNMATCHED", wrap: null, reason: `no wrap grants ${tool.agent_id} ${tool.action}`, source: inventorySource }
        : { kind: "tool", id: tool.name, status: "MATCHED", wrap, reason: null, source: inventorySource },
    );
  }
  if (inventory.lattice !== null) {
    const file = resolve(baseDir, inventory.lattice);
    const label = displayPath(file, root);
    entries.push(...latticeEntries(readSingleDocument(file, label), wraps, label));
  }
  for (const file of gapFiles) entries.push(...egressEntries(file.docs, file.label));
  for (const manifest of inventory.ucb_manifests) {
    const file = resolve(baseDir, manifest);
    const label = displayPath(file, root);
    entries.push(...ucbEntries(readSingleDocument(file, label), wraps, label));
  }
  return { inventory: inventorySource, entries, summary: summarize(entries) };
}

/**
 * Load an inventory file and build its report.
 * @param {string} file
 * @param {{ root?: string }} [options]
 * @returns {Report}
 */
export function coverageForFile(file, options = {}) {
  const loaded = loadInventory(file);
  /** @type {BuildOptions} */
  const build = { inventoryPath: loaded.path };
  if (options.root !== undefined) build.root = options.root;
  return buildCoverage(loaded.inventory, loaded.baseDir, build);
}

/**
 * The text form: one line per entry then the summary line.
 * @param {Report} report
 * @returns {string}
 */
export function formatText(report) {
  const lines = report.entries.map((e) => {
    if (e.status === "MATCHED") return `MATCHED ${e.kind} ${e.id} wrap=${e.wrap ?? ""} ${e.source}`;
    return `UNMATCHED ${e.kind} ${e.id} ${e.reason ?? ""} ${e.source}`;
  });
  const s = report.summary;
  lines.push(`wrap coverage: ${s.entries} entries, ${s.matched} matched, ${s.unmatched} unmatched`);
  return lines.join("\n") + "\n";
}

/**
 * Command line entry. Returns the exit code.
 * @param {string[]} argv arguments after the script path
 * @param {{ out?: (s: string) => void, err?: (s: string) => void }} [io]
 * @returns {number}
 */
export function main(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s));
  const err = io.err ?? ((s) => process.stderr.write(s));
  const json = argv.includes("--json");
  const files = argv.filter((a) => a !== "--json");
  if (files.length !== 1 || files[0] === undefined || files[0].startsWith("-")) {
    err("usage: node AEP-Components/wrap-coverage/lib/wrap-coverage.mjs <inventory.yaml> [--json]\n");
    return 2;
  }
  let report;
  try {
    report = coverageForFile(files[0]);
  } catch (e) {
    err(`wrap-coverage: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  out(json ? JSON.stringify(report, null, 2) + "\n" : formatText(report));
  return report.summary.unmatched === 0 ? 0 : 1;
}

/** True when this file is the script node started. */
function isEntryScript() {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryScript()) {
  process.exitCode = main(process.argv.slice(2));
}
