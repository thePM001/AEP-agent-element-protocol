#!/usr/bin/env node
// ===========================================================================
// dynAEP CLI (AEP-SDKs/typescript/dynaep/cli/dynaep-cli.ts)
// Lattice-gated distribution only - not published to npm.
// ===========================================================================

import { resolve } from "node:path";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadAEPConfigs, validateAOT, prefixFromId } from "../../aep-protocol/sdk/sdk-aep-core.js";
import type { AEPRegistryEntry, AEPElement } from "../../aep-protocol/sdk/sdk-aep-core.js";
import {
  ActionLattice,
  LatticeFilter,
  type LatticeEvent,
} from "../src/protocol/action-lattice.js";

const args = process.argv.slice(2);
const command = args[0];

function main(): void {
  switch (command) {
    case "validate":       cmdValidate(); break;
    case "check-bindings": cmdCheckBindings(); break;
    case "check-graph":    cmdCheckGraph(); break;
    case "init":           cmdInit(); break;
    case "serve":          cmdServe(); break;
    default:               printUsage(); break;
  }
}

// ---------------------------------------------------------------------------
// dynaep validate
// ---------------------------------------------------------------------------

function cmdValidate(): void {
  const dir = resolve(args[1] || ".");
  console.log(`[dynaep] AOT validation: ${dir}\n`);

  let config;
  try { config = loadAEPConfigs(dir); }
  catch (err: any) { console.error(`FAIL: ${err.message}\n`); process.exit(1); }

  const result = validateAOT(config);

  if (result.valid) {
    console.log(`PASS: 0 errors, ${result.warnings!.length} warning(s)`);
  } else {
    console.log(`FAIL: ${result.errors.length} error(s)`);
  }
  for (const e of result.errors) console.log(`  ERROR: ${e}`);
  for (const w of result.warnings!) console.log(`  WARN:  ${w}`);
  console.log();
  process.exit(result.valid ? 0 : 1);
}

// ---------------------------------------------------------------------------
// dynaep check-bindings
// ---------------------------------------------------------------------------

function cmdCheckBindings(): void {
  const dir = resolve(args[1] || ".");
  console.log(`[dynaep] Checking skin_bindings: ${dir}\n`);

  let config;
  try { config = loadAEPConfigs(dir); }
  catch (err: any) { console.error(`FAIL: ${err.message}\n`); process.exit(1); }

  let errors = 0;
  for (const [id, entry] of Object.entries(config.registry) as [string, import("@aep/core").AEPRegistryEntry][]) {
    if (entry.skin_binding && !config.theme.component_styles[entry.skin_binding]) {
      console.log(`  MISSING: ${id} -> "${entry.skin_binding}"`);
      errors++;
    }
  }

  console.log(errors === 0 ? "\nPASS: All skin_bindings resolve.\n" : `\nFAIL: ${errors} unresolved.\n`);
  process.exit(errors === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// dynaep check-graph
// ---------------------------------------------------------------------------

function cmdCheckGraph(): void {
  const dir = resolve(args[1] || ".");
  console.log(`[dynaep] Checking bidirectional graph: ${dir}\n`);

  let config;
  try { config = loadAEPConfigs(dir); }
  catch (err: any) { console.error(`FAIL: ${err.message}\n`); process.exit(1); }

  const elements = config.scene.elements;
  let errors = 0;

  for (const [id, el] of Object.entries(elements)) {
    // A: parent lists child, child's parent must match
    for (const childId of el.children || []) {
      const child = elements[childId];
      if (!child) {
        console.log(`  MISSING: ${id} lists child ${childId} which does not exist`);
        errors++;
      } else if (child.parent !== id) {
        console.log(`  MISMATCH: ${id} lists child ${childId} but ${childId}.parent = "${child.parent}"`);
        errors++;
      }
    }

    // B: child declares parent, parent must list child
    if (el.parent && elements[el.parent]) {
      const parentChildren = elements[el.parent].children || [];
      if (!parentChildren.includes(id)) {
        console.log(`  ORPHAN: ${id} declares parent ${el.parent} but parent does not list it`);
        errors++;
      }
    }
  }

  // Duplicate child references
  const seen = new Set<string>();
  for (const el of Object.values(elements)) {
    for (const ref of el.children || []) {
      if (seen.has(ref)) {
        console.log(`  DUPLICATE: ${ref} appears in multiple parents`);
        errors++;
      }
      seen.add(ref);
    }
  }

  console.log(errors === 0 ? "\nPASS: Graph is fully bidirectional.\n" : `\nFAIL: ${errors} inconsistency(ies).\n`);
  process.exit(errors === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// dynaep init
// ---------------------------------------------------------------------------

function cmdInit(): void {
  const dir = resolve(args[1] || ".");
  console.log(`[dynaep] Scaffolding configs: ${dir}\n`);

  const files: Record<string, string> = {
    "aep-scene.json": JSON.stringify({
      aep_version: "1.1", schema_revision: 1,
      elements: {
        "SH-00001": {
          id: "SH-00001", type: "shell", label: "App Shell",
          z: 0, visible: true, parent: null,
          spatial_rule: "flex", direction: "column",
          layout: { width: "100vw", height: "100vh" }, children: [],
        },
      },
      viewport_breakpoints: {
        base: { max_width: 639 },
        "vp-md": { min_width: 640, max_width: 1023 },
        "vp-lg": { min_width: 1024 },
      },
      camera: { x: 0, y: 0, zoom: 1.0 },
    }, null, 2),

    "aep-registry.yaml": [
      'aep_version: "1.1"', "schema_revision: 1", "",
      "SH-00001:", '  label: "App Shell"', "  category: layout",
      '  function: "Root application container."',
      '  component_file: "App.jsx"', "  parent: null",
      '  skin_binding: "shell"', "  states:",
      '    default: "Renders full application layout"',
      "  actions: []", "  events: {}", "  constraints:",
      '    - "Must be the sole root element"',
    ].join("\n"),

    "aep-theme.yaml": [
      'aep_version: "1.1"', "schema_revision: 1",
      'theme_name: "Default"', "", "colors:",
      '  bg_primary: "#0D1117"', '  text_primary: "#E6EDF3"',
      '  accent: "#58A6FF"', "", "typography:",
      '  font_family: "-apple-system, BlinkMacSystemFont, sans-serif"',
      "", "dimensions:", "  border_radius_sm: 4", "",
      "animations:", "  fade:", "    duration_ms: 150", "",
      "component_styles:", "  shell:",
      '    background: "{colors.bg_primary}"',
      '    color: "{colors.text_primary}"',
    ].join("\n"),

    "aep-policy.rego": [
      "package aep.forbidden", "",
      "deny[msg] {", "  some m", '  startswith(m, "MD")',
      "  some g", '  startswith(g, "CZ")',
      "  input.scene[m].z <= input.scene[g].z",
      '  msg := sprintf("Modal %v must render above grid %v", [m, g])',
      "}",
    ].join("\n"),

    "dynaep-config.yaml": [
      'aep_version: "1.1"', 'dynaep_version: "0.2"',
      "schema_revision: 1", "", "transport:",
      '  protocol: "sse"', '  endpoint: "/api/agent"',
      "  reconnect_interval_ms: 3000", "", "validation:",
      '  mode: "strict"', "  aot_on_startup: true",
      "  jit_on_every_delta: true", "", "aep_sources:",
      '  scene: "./aep-scene.json"',
      '  registry: "./aep-registry.yaml"',
      '  theme: "./aep-theme.yaml"', "", "rego:",
      '  policy_path: "./aep-policy.rego"',
      '  evaluation: "wasm"', "", "runtime_reflection:",
      "  enabled: true", '  method: "observer"',
      "  debounce_ms: 250", "", "approval_policy:",
      '  structure_mutations: "auto"',
      '  new_element_creation: "require_approval"', "",
      "conflict_resolution:",
      '  mode: "last_write_wins"', "", "id_minting:",
      "  enabled: true", "  counters_persist: true",
    ].join("\n"),
  };

  for (const [name, content] of Object.entries(files)) {
    const p = resolve(dir, name);
    if (existsSync(p)) {
      console.log(`  SKIP: ${name} exists`);
    } else {
      writeFileSync(p, content, "utf-8");
      console.log(`  CREATED: ${name}`);
    }
  }

  console.log("\nRun 'dynaep validate' to check.\n");
}

// ---------------------------------------------------------------------------
// dynaep serve
// ---------------------------------------------------------------------------

const DEFAULT_BRIDGE_PORT = 9477;
const MAX_EVENT_BODY_BYTES = 256 * 1024;

function resolveLatticePath(dir: string): string {
  const candidates: string[] = [resolve(dir, "registries/aep-lattice.yaml")];
  const configPath = resolve(dir, "dynaep-config.yaml");
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf8");
    const match = raw.match(
      /lattice:\s*[\s\S]*?^\s*registry:\s*["']?([^"'\n#]+)["']?\s*$/m,
    );
    if (match?.[1]) {
      candidates.unshift(resolve(dir, match[1].trim()));
    }
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No lattice registry found under ${dir}`);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readRequestBody(
  req: IncomingMessage,
  onComplete: (err: Error | null, body: string) => void,
): void {
  const chunks: Buffer[] = [];
  let total = 0;
  req.on("data", (chunk: Buffer) => {
    total += chunk.length;
    if (total > MAX_EVENT_BODY_BYTES) {
      onComplete(new Error("request body exceeds 256KB limit"), "");
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => onComplete(null, Buffer.concat(chunks).toString("utf8")));
  req.on("error", (err) => onComplete(err, ""));
}

function cmdServe(): void {
  const port = Number.parseInt(args[1] || String(DEFAULT_BRIDGE_PORT), 10);
  const dir = resolve(args[2] || ".");
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    console.error("FAIL: port must be between 1 and 65535\n");
    process.exit(1);
  }

  let latticePath: string;
  try {
    latticePath = resolveLatticePath(dir);
  } catch (err: any) {
    console.error(`FAIL: ${err.message}\n`);
    process.exit(1);
  }

  const lattice = new ActionLattice();
  try {
    lattice.loadFromFile(latticePath);
  } catch (err: any) {
    console.error(`FAIL: unable to load lattice registry: ${err.message}\n`);
    process.exit(1);
  }

  const filter = new LatticeFilter(lattice);
  const recentEvents: LatticeEvent[] = [];

  const server = createServer((req, res) => {
    const url = req.url?.split("?")[0] || "/";

    if (req.method === "GET" && url === "/health") {
      writeJson(res, 200, {
        status: "ok",
        service: "dynaep-dev-bridge",
        port,
        config_dir: dir,
        lattice_registry: latticePath,
        events_buffered: recentEvents.length,
      });
      return;
    }

    if (req.method === "GET" && url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        [
          "dynaep dev bridge",
          "POST /events { source?, action_path, payload?, agent_id?, trust_tier? }",
          "GET /health",
          "",
        ].join("\n"),
      );
      return;
    }

    if (req.method === "POST" && url === "/events") {
      readRequestBody(req, (err, body) => {
        if (err) {
          writeJson(res, 400, { ok: false, error: err.message });
          return;
        }

        let parsed: Partial<LatticeEvent> & { payload?: Record<string, unknown> };
        try {
          parsed = JSON.parse(body || "{}");
        } catch {
          writeJson(res, 400, { ok: false, error: "invalid JSON body" });
          return;
        }

        const actionPath = parsed.action_path?.trim();
        if (!actionPath) {
          writeJson(res, 400, { ok: false, error: "action_path is required" });
          return;
        }

        const event: LatticeEvent = {
          source: parsed.source || "dev-bridge",
          action_path: actionPath,
          payload:
            parsed.payload && typeof parsed.payload === "object"
              ? parsed.payload
              : {},
          bridge_timestamp: Date.now(),
          agent_id: parsed.agent_id,
          trust_tier: parsed.trust_tier ?? 1,
        };

        const result = filter.filter(event);
        if (result.passed) {
          recentEvents.push(event);
          if (recentEvents.length > 200) {
            recentEvents.shift();
          }
        }

        writeJson(res, result.passed ? 200 : 422, {
          ok: result.passed,
          event,
          filter: result,
        });
      });
      return;
    }

    writeJson(res, 404, { error: "not found" });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[dynaep] Dev bridge listening on http://127.0.0.1:${port}`);
    console.log(`[dynaep] Config dir: ${dir}`);
    console.log(`[dynaep] Lattice registry: ${latticePath}\n`);
  });
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`
dynaep-cli - AEP and dynAEP command-line tools

Usage:
  dynaep validate [dir]        AOT validation of all config files
  dynaep check-bindings [dir]  Verify all skin_bindings resolve
  dynaep check-graph [dir]     Verify bidirectional parent/child graph
  dynaep init [dir]            Scaffold starter config files
  dynaep serve [port] [dir]    Start local dev bridge (default port 9477)

Options:
  [dir]   Config directory (default: current directory)
`);
}

try { main(); }
catch (err: any) { console.error(`[dynaep] Fatal: ${err.message}`); process.exit(1); }
