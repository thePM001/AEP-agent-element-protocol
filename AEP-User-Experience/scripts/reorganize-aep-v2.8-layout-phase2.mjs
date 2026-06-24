#!/usr/bin/env node
/**
 * AEP 2.8 layout phase 2:
 * - composer-lite → AEP-Composer-Lite/
 * - policy-builder, schema-builder → AEP-Policy-System/
 * - ucb → AEP-Docks/ucb/
 * - AEP-PROTOCOL-COMPONENTS → AEP-Components
 * - AEP-SUBPROTOCOLS → AEP-Subprotocols
 * - Populate AEP-Docks with specs + universal-connect (UCD)
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OLD_COMPONENTS = "AEP-PROTOCOL-COMPONENTS";
const NEW_COMPONENTS = "AEP-Components";
const OLD_SUBPROTOCOLS = "AEP-SUBPROTOCOLS";
const NEW_SUBPROTOCOLS = "AEP-Subprotocols";
const SKIP = new Set(["node_modules", ".git", "target"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js|json|sh|toml|md|yml|yaml|rs|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

function bulkReplace(files, pairs) {
  let n = 0;
  for (const file of files) {
    if (
      file.includes("reorganize-aep-v2.8-layout-phase2.mjs") ||
      file.includes("reorganize-aep-v2.8-layout.mjs")
    ) {
      continue;
    }
    let text = readFileSync(file, "utf8");
    const orig = text;
    for (const [from, to] of pairs) {
      if (typeof from === "string") text = text.split(from).join(to);
      else text = text.replace(from, to);
    }
    if (text !== orig) {
      writeFileSync(file, text);
      n++;
    }
  }
  return n;
}

function moveDir(src, dest) {
  if (!existsSync(src)) {
    console.warn(`  skip missing ${src}`);
    return false;
  }
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  renameSync(src, dest);
  console.log(`  ${src.replace(REPO + "/", "")} → ${dest.replace(REPO + "/", "")}`);
  return true;
}

console.log("=== Phase 1: Move Composer Lite to repo root ===");
moveDir(
  join(REPO, OLD_COMPONENTS, "composer-lite"),
  join(REPO, "AEP-Composer-Lite"),
);

console.log("\n=== Phase 2: Move policy-builder + schema-builder → AEP-Policy-System ===");
moveDir(
  join(REPO, OLD_COMPONENTS, "policy-builder"),
  join(REPO, "AEP-Policy-System/policy-builder"),
);
moveDir(
  join(REPO, OLD_COMPONENTS, "schema-builder"),
  join(REPO, "AEP-Policy-System/schema-builder"),
);

console.log("\n=== Phase 3: Move UCB → AEP-Docks/ucb ===");
moveDir(join(REPO, OLD_COMPONENTS, "ucb"), join(REPO, "AEP-Docks/ucb"));

console.log("\n=== Phase 4: Rename AEP-PROTOCOL-COMPONENTS → AEP-Components ===");
if (existsSync(join(REPO, OLD_COMPONENTS)) && !existsSync(join(REPO, NEW_COMPONENTS))) {
  renameSync(join(REPO, OLD_COMPONENTS), join(REPO, NEW_COMPONENTS));
  console.log(`  ${OLD_COMPONENTS} → ${NEW_COMPONENTS}`);
}

console.log("\n=== Phase 5: Rename AEP-SUBPROTOCOLS → AEP-Subprotocols ===");
if (existsSync(join(REPO, OLD_SUBPROTOCOLS)) && !existsSync(join(REPO, NEW_SUBPROTOCOLS))) {
  renameSync(join(REPO, OLD_SUBPROTOCOLS), join(REPO, NEW_SUBPROTOCOLS));
  console.log(`  ${OLD_SUBPROTOCOLS} → ${NEW_SUBPROTOCOLS}`);
}

console.log("\n=== Phase 6: Populate AEP-Docks specs + Universal Connect Dock ===");
const specsDir = join(REPO, "AEP-Docks/specs");
mkdirSync(specsDir, { recursive: true });

const dockSpecs = [
  {
    file: "inference-engine.json",
    spec: {
      port_id: "inference_engine",
      name: "Inference Engine Dock",
      priority: 200,
      socket_suffix: "/inference",
      purpose: "AEP Inference Engines and lattice-gated LLM delegation",
      transport: "lattice-channel",
      implementation: "AEP-Base-Node/crate/src/docking.rs",
    },
  },
  {
    file: "validation-engine.json",
    spec: {
      port_id: "validation_engine",
      name: "Validation Engine Dock",
      priority: 200,
      socket_suffix: "/validation",
      purpose: "AEP validation engines, DynAep event ingest, UCB rollback",
      transport: "lattice-channel",
      implementation: "AEP-Base-Node/crate/src/docking.rs",
    },
  },
  {
    file: "future-features.json",
    spec: {
      port_id: "future_features",
      name: "Future Features Dock",
      priority: 200,
      socket_suffix: "/future",
      purpose: "AEP 3.0+ internal plugins (not foreign ingress)",
      transport: "lattice-channel",
      implementation: "AEP-Base-Node/crate/src/docking.rs",
    },
  },
  {
    file: "regulation-module.json",
    spec: {
      port_id: "regulation_module",
      name: "Regulation Module Dock",
      priority: 150,
      socket_suffix: "/regulation",
      purpose: "Legacy Regulation Providers (LRPs); EPSCOM priority 255",
      transport: "lattice-channel",
      implementation: "AEP-Base-Node/crate/src/docking.rs",
    },
  },
];

for (const { file, spec } of dockSpecs) {
  writeFileSync(join(specsDir, file), `${JSON.stringify(spec, null, 2)}\n`);
}

const ucdDir = join(REPO, "AEP-Docks/universal-connect");
mkdirSync(join(ucdDir, "lib"), { recursive: true });
mkdirSync(join(ucdDir, "modules"), { recursive: true });

writeFileSync(
  join(ucdDir, "dock-v1.json"),
  `${JSON.stringify(
    {
      dock_id: "universal_connect",
      name: "Universal Connect Dock",
      version: "1.0.0",
      kind: "ucb-regulated-egress",
      description:
        "UCB-regulated dock for optional external modules (HCSE, future CCA downloads). Internet egress only through UCB manifest-scoped routes.",
      regulator: {
        component: "ucb",
        path: "AEP-Docks/ucb/",
        port: 8412,
        egress_path: "/ucb/v1/egress",
      },
      requires: ["aep-base-node", "ucb", "lattice-channels"],
      native_docks: [
        "inference_engine",
        "validation_engine",
        "future_features",
        "regulation_module",
      ],
      client: "AEP-Docks/universal-connect/lib/ucd-client.mjs",
      modules_dir: "AEP-Docks/universal-connect/modules/",
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(ucdDir, "modules/hcse.json"),
  `${JSON.stringify(
    {
      module_id: "hcse",
      component_id: "hcse",
      description: "UCB egress routes for AEP-HCSE upstream release download",
      agent_id: "aep-hcse",
      egress: {
        routes: [
          {
            path_prefix: "/github-api/repos/DeusData/codebase-memory-mcp",
            upstream: "https://api.github.com/repos/DeusData/codebase-memory-mcp",
            strip_prefix: "/github-api/repos/DeusData/codebase-memory-mcp",
            access_rules: [
              { action: "ALLOW", method: "GET", path: "/releases/**" },
              { action: "ALLOW", method: "GET", path: "/releases/assets/**" },
            ],
          },
        ],
      },
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(ucdDir, "README.md"),
  `# Universal Connect Dock (UCD)

UCB-regulated dock for **optional external modules** that need controlled internet egress. Use for CCA-driven downloads (HCSE, future third-party binaries) instead of raw \`fetch\` or unscoped lattice hops.

## Architecture

\`\`\`
CCA / HCSE install hook
        |
        v
+---------------------------+
| UCD client (ucd-client)   |
+-------------+-------------+
              |
              | manifest-scoped HTTP
              v
+---------------------------+
| UCB :8412 egress proxy    |
+-------------+-------------+
              |
              v
        upstream API (GitHub releases, etc.)
\`\`\`

Native AEP components continue to use \`lattice-channels\` against Base Node Unix socket docks. UCD is **only** for external optional modules regulated by UCB.

## Module specs

| Module | Spec | Component |
|--------|------|-----------|
| HCSE | \`modules/hcse.json\` | \`AEP-Components/hcse/\` |

## Related

- Base Node socket docks: \`AEP-Docks/specs/\`
- UCB bridge: \`AEP-Docks/ucb/\`
- Protocol: \`AEP-NOSHIP/docs/DOCKING-PORTS.md\`
`,
);

writeFileSync(
  join(REPO, "AEP-Docks/README.md"),
  `# AEP-Docks

Canonical dock definitions for AEP 2.8. Socket docks are implemented in \`AEP-Base-Node/crate/src/docking.rs\`; HTTP/regulated docks live here.

## Base Node socket docks

| Port ID | Socket suffix | Spec |
|---------|---------------|------|
| \`inference_engine\` | \`/inference\` | \`specs/inference-engine.json\` |
| \`validation_engine\` | \`/validation\` | \`specs/validation-engine.json\` |
| \`future_features\` | \`/future\` | \`specs/future-features.json\` |
| \`regulation_module\` | \`/regulation\` | \`specs/regulation-module.json\` |

See \`AEP-NOSHIP/docs/DOCKING-PORTS.md\` for wire protocol.

## Regulated HTTP docks

| Dock | Path | Port | Role |
|------|------|------|------|
| **UCB** (Universal Connect Bridge) | \`ucb/\` | 8412 | Foreign ingress + manifest-scoped internet egress |
| **UCD** (Universal Connect Dock) | \`universal-connect/\` | _(via UCB)_ | Optional external module downloads (HCSE, CCA artifacts) |

UCD routes all external module egress through UCB. Do not bypass UCB for optional internet-facing modules.
`,
);

console.log("\n=== Phase 7: Update Cargo.toml workspace members ===");
let cargo = readFileSync(join(REPO, "Cargo.toml"), "utf8");
cargo = cargo
  .split(OLD_COMPONENTS)
  .join(NEW_COMPONENTS)
  .split(OLD_SUBPROTOCOLS)
  .join(NEW_SUBPROTOCOLS)
  .replace(
    `"${NEW_COMPONENTS}/ucb/crate"`,
    `"AEP-Docks/ucb/crate"`,
  );
writeFileSync(join(REPO, "Cargo.toml"), cargo);

console.log("\n=== Phase 8: Bulk path rewrites ===");
const files = walk(REPO);
const pairs = [
  ["AEP-PROTOCOL-COMPONENTS/composer-lite/", "AEP-Composer-Lite/"],
  ["AEP-PROTOCOL-COMPONENTS/composer-lite", "AEP-Composer-Lite"],
  ["AEP-PROTOCOL-COMPONENTS/policy-builder/", "AEP-Policy-System/policy-builder/"],
  ["AEP-PROTOCOL-COMPONENTS/policy-builder", "AEP-Policy-System/policy-builder"],
  ["AEP-PROTOCOL-COMPONENTS/schema-builder/", "AEP-Policy-System/schema-builder/"],
  ["AEP-PROTOCOL-COMPONENTS/schema-builder", "AEP-Policy-System/schema-builder"],
  ["AEP-PROTOCOL-COMPONENTS/ucb/", "AEP-Docks/ucb/"],
  ["AEP-PROTOCOL-COMPONENTS/ucb", "AEP-Docks/ucb"],
  ["AEP-PROTOCOL-COMPONENTS/", "AEP-Components/"],
  ["AEP-PROTOCOL-COMPONENTS", "AEP-Components"],
  ["AEP-SUBPROTOCOLS/", "AEP-Subprotocols/"],
  ["AEP-SUBPROTOCOLS", "AEP-Subprotocols"],
  [`${OLD_COMPONENTS}/composer-lite/`, "AEP-Composer-Lite/"],
  [`${OLD_COMPONENTS}/policy-builder/`, "AEP-Policy-System/policy-builder/"],
  [`${OLD_COMPONENTS}/schema-builder/`, "AEP-Policy-System/schema-builder/"],
  [`${OLD_COMPONENTS}/ucb/`, "AEP-Docks/ucb/"],
  [`${OLD_COMPONENTS}/`, `${NEW_COMPONENTS}/`],
  [OLD_COMPONENTS, NEW_COMPONENTS],
  [OLD_SUBPROTOCOLS, NEW_SUBPROTOCOLS],
];
const n = bulkReplace(files, pairs);
console.log(`  patched ${n} files`);

console.log("\n=== Phase 9: Update registry manifests ===");
const manifestUpdates = [
  ["composer-lite.json", { path: "AEP-Composer-Lite/", implPrefix: "AEP-Composer-Lite" }],
  ["policy-builder.json", { path: "AEP-Policy-System/policy-builder/", implPrefix: "AEP-Policy-System/policy-builder" }],
  ["schema-builder.json", { path: "AEP-Policy-System/schema-builder/", implPrefix: "AEP-Policy-System/schema-builder" }],
  ["ucb.json", { path: "AEP-Docks/ucb/", implPrefix: "AEP-Docks/ucb" }],
  ["hcse.json", { path: "AEP-Components/hcse/", implPrefix: "AEP-Components/hcse", dock: "universal_connect" }],
];

for (const [name, cfg] of manifestUpdates) {
  const p = join(REPO, "AEP-Base-Node/registry/components", name);
  if (!existsSync(p)) continue;
  const m = JSON.parse(readFileSync(p, "utf8"));
  m.path = cfg.path;
  if (m.implementation) {
    for (const [k, v] of Object.entries(m.implementation)) {
      if (typeof v === "string" && v.includes("AEP-")) {
        if (k === "crate" && name === "ucb.json") {
          m.implementation[k] = "AEP-Docks/ucb/crate/";
        } else if (typeof cfg.implPrefix === "string") {
          const base = cfg.implPrefix;
          if (v.endsWith(".mjs") || v.endsWith(".ts")) {
            const leaf = v.split("/").pop();
            m.implementation[k] = `${base}/${leaf.includes("/") ? leaf : `lib/${leaf}`}`;
          }
        }
      }
    }
    if (name === "composer-lite.json") {
      m.implementation.entry = "AEP-Composer-Lite/server.mjs";
      m.implementation.public = "AEP-Composer-Lite/public/";
    }
    if (name === "ucb.json") {
      m.implementation.crate = "AEP-Docks/ucb/crate/";
      m.implementation.lattice_transport = "AEP-Components/lattice-channels/lib/lattice-transport.mjs";
    }
    if (name === "hcse.json") {
      m.implementation.module = "AEP-Components/hcse/lib/hcse-bridge.mjs";
      m.implementation.install = "AEP-Components/hcse/lib/install.mjs";
      m.docks = { primary: "universal_connect", allowed: ["universal_connect", "validation_engine"] };
      m.external_module.ucd_spec = "AEP-Docks/universal-connect/modules/hcse.json";
      if (m.actions?.[0]) {
        m.actions[0].method = "node AEP-Components/hcse/lib/install.mjs";
      }
    }
    if (name === "policy-builder.json") {
      m.implementation.module = "AEP-Policy-System/policy-builder/lib/index.ts";
    }
    if (name === "schema-builder.json") {
      m.implementation.module = "AEP-Policy-System/schema-builder/lib/index.ts";
    }
  }
  writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`);
}

const catalogPath = join(REPO, "AEP-Base-Node/registry/catalog.json");
if (existsSync(catalogPath)) {
  let cat = readFileSync(catalogPath, "utf8");
  cat = cat
    .split(OLD_COMPONENTS)
    .join(NEW_COMPONENTS)
    .split(OLD_SUBPROTOCOLS)
    .join(NEW_SUBPROTOCOLS)
    .split("AEP-PROTOCOL-COMPONENTS/composer-lite/")
    .join("AEP-Composer-Lite/")
    .split("AEP-PROTOCOL-COMPONENTS/policy-builder/")
    .join("AEP-Policy-System/policy-builder/")
    .split("AEP-PROTOCOL-COMPONENTS/schema-builder/")
    .join("AEP-Policy-System/schema-builder/")
    .split("AEP-PROTOCOL-COMPONENTS/ucb/")
    .join("AEP-Docks/ucb/");
  writeFileSync(catalogPath, cat);
}

console.log("\n=== Phase 10: Fix AEP-Base-Node crate Cargo.toml paths ===");
const baseCargoPath = join(REPO, "AEP-Base-Node/crate/Cargo.toml");
if (existsSync(baseCargoPath)) {
  let bc = readFileSync(baseCargoPath, "utf8");
  bc = bc.split(OLD_COMPONENTS).join(NEW_COMPONENTS);
  writeFileSync(baseCargoPath, bc);
}

console.log("\nDone phase 2. Next: ucd-client.mjs + HCSE install + cargo check");