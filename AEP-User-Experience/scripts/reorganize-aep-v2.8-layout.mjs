#!/usr/bin/env node
/**
 * AEP 2.8 canonical layout migration:
 * - registry, potomitan, agent-control-extreme → AEP-Base-Node/
 * - harness + skill + scripts → AEP-User-Experience/
 * - connectors → AEP-Connectors/, policies → AEP-Policy-System/, docks → AEP-Docks/
 * - lattice-transport + lattice-client + lattice-channel → lattice-channels (one component)
 * - setup-agent merged into cca (unified setup agent)
 * - commerce component → AEP-SUBPROTOCOLS/commerce/
 * - AEP-SDKs/ scaffold + SDK moves
 * - remove 2.75 harness, aep-typescript-sdk catalog entry, npm package.json files
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
const COMPONENTS = "AEP-PROTOCOL-COMPONENTS";
const SKIP = new Set(["node_modules", ".git", "target"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js|json|sh|toml|md|yml|yaml|rs)$/.test(name)) out.push(p);
  }
  return out;
}

function bulkReplace(files, pairs) {
  let n = 0;
  for (const file of files) {
    if (file.includes("reorganize-aep-v2.8-layout.mjs")) continue;
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

function copyDir(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  return true;
}

console.log("=== Phase 1: Create top-level folders ===");
for (const d of [
  "AEP-User-Experience",
  "AEP-SDKs",
  "AEP-Connectors",
  "AEP-Docks",
  "AEP-Policy-System",
  "AEP-Base-Node/agent-control-extreme/profiles",
  join(COMPONENTS, "lattice-channels/lib"),
  join(COMPONENTS, "lattice-channels/client"),
  join(COMPONENTS, "cca/lib/setup"),
]) {
  mkdirSync(join(REPO, d), { recursive: true });
}

console.log("\n=== Phase 2: Merge lattice → lattice-channels ===");
const lc = join(REPO, COMPONENTS, "lattice-channels");
copyDir(join(REPO, COMPONENTS, "lattice-transport/lib"), join(lc, "lib"));
copyDir(join(REPO, COMPONENTS, "lattice-client/lib"), join(lc, "client"));
if (existsSync(join(REPO, COMPONENTS, "lattice-channel/crate"))) {
  moveDir(join(REPO, COMPONENTS, "lattice-channel/crate"), join(lc, "crate"));
}
writeFileSync(
  join(lc, "README.md"),
  `# Lattice Channels (unified)

Single AEP component for lattice channel transport, TypeScript client helpers, and the Rust \`aep-lattice-channel\` crate.

- \`lib/\` - MJS/TS transport (\`latticeGatedFetch\`, frame builder)
- \`client/\` - TypeScript client re-exports
- \`crate/\` - Rust lattice channel implementation

Compiled AI: deterministic frame contracts; no runtime LLM in this layer.
`,
);
rmSync(join(REPO, COMPONENTS, "lattice-transport"), { recursive: true, force: true });
rmSync(join(REPO, COMPONENTS, "lattice-client"), { recursive: true, force: true });
rmSync(join(REPO, COMPONENTS, "lattice-channel"), { recursive: true, force: true });

console.log("\n=== Phase 3: Move registry → AEP-Base-Node/registry ===");
moveDir(join(REPO, "registry"), join(REPO, "AEP-Base-Node/registry"));

console.log("\n=== Phase 4: Move potomitan → AEP-Base-Node/potomitan ===");
moveDir(join(REPO, COMPONENTS, "potomitan"), join(REPO, "AEP-Base-Node/potomitan"));

console.log("\n=== Phase 5: Move connectors, policies ===");
moveDir(join(REPO, COMPONENTS, "connectors"), join(REPO, "AEP-Connectors"));
moveDir(join(REPO, COMPONENTS, "policies"), join(REPO, "AEP-Policy-System"));

console.log("\n=== Phase 6: Commerce component → subprotocol ===");
copyDir(join(REPO, COMPONENTS, "commerce/lib"), join(REPO, "AEP-SUBPROTOCOLS/commerce/lib"));
rmSync(join(REPO, COMPONENTS, "commerce"), { recursive: true, force: true });

console.log("\n=== Phase 7: Unify CCA + setup-agent ===");
for (const f of readdirSync(join(REPO, COMPONENTS, "setup-agent/lib"))) {
  const src = join(REPO, COMPONENTS, "setup-agent/lib", f);
  const dest = join(REPO, COMPONENTS, "cca/lib/setup", f);
  if (!existsSync(dest)) renameSync(src, dest);
}
if (existsSync(join(REPO, COMPONENTS, "setup-agent/setup-agent.mjs"))) {
  renameSync(
    join(REPO, COMPONENTS, "setup-agent/setup-agent.mjs"),
    join(REPO, COMPONENTS, "cca/setup-agent.mjs"),
  );
}
rmSync(join(REPO, COMPONENTS, "setup-agent"), { recursive: true, force: true });

console.log("\n=== Phase 8: AEP-User-Experience ===");
moveDir(join(REPO, "harness/aep-2.8-agent-harness"), join(REPO, "AEP-User-Experience/harness"));
moveDir(join(REPO, "AEP-main-skill"), join(REPO, "AEP-User-Experience/AEP-main-skill"));
for (const f of ["aep-base-node-preflight.mjs", "aep-comm-harness.ts", "aep-validate.js", "README.md"]) {
  const src = join(REPO, "harness", f);
  if (existsSync(src)) moveDir(src, join(REPO, "AEP-User-Experience", f));
}
rmSync(join(REPO, "harness/aep-2.75-agent-harness"), { recursive: true, force: true });
rmSync(join(REPO, "harness"), { recursive: true, force: true });

console.log("\n=== Phase 9: AEP-SDKs scaffold ===");
const sdkLangs = [
  "typescript",
  "vue",
  "astro",
  "react",
  "go",
  "python",
  "elixir",
  "rust",
  "javascript",
  "html-css",
  "cpp",
  "clojure",
];
for (const lang of sdkLangs) mkdirSync(join(REPO, "AEP-SDKs", lang), { recursive: true });

// dynAEP protocol lives in AEP-Components/dynAEP/; all SDKs live in AEP-SDKs/ only.
if (existsSync(join(REPO, COMPONENTS, "typescript-sdk"))) {
  copyDir(join(REPO, COMPONENTS, "typescript-sdk"), join(REPO, "AEP-SDKs/typescript/aep-protocol"));
  rmSync(join(REPO, COMPONENTS, "typescript-sdk"), { recursive: true, force: true });
}

writeFileSync(
  join(REPO, "AEP-SDKs/README.md"),
  `# AEP-SDKs

Language SDKs for AEP 2.8. SDKs are **not** protocol components - they are thin compiled-AI client surfaces that call lattice-gated APIs.

| SDK | Path | Status |
|-----|------|--------|
| TypeScript | \`typescript/\` | aep-protocol + dynaep |
| Python | \`python/\` | dynaep |
| Vue | \`vue/\` | scaffold |
| Astro | \`astro/\` | scaffold |
| React | \`react/\` | scaffold |
| Go | \`go/\` | scaffold |
| Elixir | \`elixir/\` | scaffold |
| Rust | \`rust/\` | scaffold |
| JavaScript | \`javascript/\` | scaffold |
| HTML/CSS | \`html-css/\` | scaffold |
| C++ | \`cpp/\` | scaffold |
| Clojure | \`clojure/\` | scaffold |

Paradigm: [Compiled AI](https://doi.org/10.48550/arXiv.2604.05150) - deterministic artifacts, zero runtime LLM in SDK transports.

**NPM is forbidden.** Use lattice-gated distribution or language-native package managers only where policy allows.
`,
);
for (const lang of sdkLangs.filter((l) => !["typescript", "python"].includes(l))) {
  writeFileSync(
    join(REPO, "AEP-SDKs", lang, "README.md"),
    `# AEP ${lang} SDK (scaffold)\n\nCompiled-AI client scaffold. Implement lattice-gated transport against \`AEP-PROTOCOL-COMPONENTS/lattice-channels/\`.\n`,
  );
}

console.log("\n=== Phase 10: AEP-Docks + agent-control-extreme ===");
writeFileSync(
  join(REPO, "AEP-Docks/README.md"),
  `# AEP-Docks

Canonical docking port definitions for Base Node. Implementation: \`AEP-Base-Node/crate/src/docking.rs\`.

| Port ID | Socket suffix | Purpose |
|---------|---------------|---------|
| inference_engine | /inference | Inference Engine Dock |
| validation_engine | /validation | Validation Engine Dock |
| future_features | /future | Future Features Dock |
| regulation_module | /regulation | Regulation Module Dock |

See \`AEP-NOSHIP/docs/DOCKING-PORTS.md\` for protocol details.
`,
);
writeFileSync(
  join(REPO, "AEP-Base-Node/agent-control-extreme/README.md"),
  `# Agent Control Hub Extreme

Base Node agent control kernel extension. Agent mount profiles and capability routing live here.

- \`profiles/\` - mount profiles for multi-mount agent sessions (sourced from CAW mount_profiles)
- Registry authority: \`AEP-Base-Node/registry/\`
- Kernel: \`AEP-Base-Node/crate/\` (docking, task_manifest, epscom, side_channel_monitor, lattice_log)
`,
);
const cawConfig = join(REPO, COMPONENTS, "caw-framework/config.yml");
if (existsSync(cawConfig)) {
  const text = readFileSync(cawConfig, "utf8");
  const m = text.match(/mount_profiles:\n([\s\S]*?)(?=\n# =+)/);
  if (m) {
    writeFileSync(
      join(REPO, "AEP-Base-Node/agent-control-extreme/profiles/mount-profiles.yaml"),
      `# Agent mount profiles (canonical copy for Base Node hub)\nmount_profiles:\n${m[1]}`,
    );
  }
}

console.log("\n=== Phase 11: Update Cargo.toml ===");
let cargo = readFileSync(join(REPO, "Cargo.toml"), "utf8");
cargo = cargo.replace(
  `"${COMPONENTS}/lattice-channel/crate"`,
  `"${COMPONENTS}/lattice-channels/crate"`,
);
cargo = cargo.replace(
  `"${COMPONENTS}/potomitan/crate"`,
  `"AEP-Base-Node/potomitan/crate"`,
);
writeFileSync(join(REPO, "Cargo.toml"), cargo);

let baseCargo = readFileSync(join(REPO, "AEP-Base-Node/crate/Cargo.toml"), "utf8");
baseCargo = baseCargo.replace(
  `path = "../../${COMPONENTS}/lattice-channel/crate"`,
  `path = "../../${COMPONENTS}/lattice-channels/crate"`,
);
baseCargo = baseCargo.replace(
  `path = "../../${COMPONENTS}/potomitan/crate"`,
  `path = "../potomitan/crate"`,
);
writeFileSync(join(REPO, "AEP-Base-Node/crate/Cargo.toml"), baseCargo);

console.log("\n=== Phase 12: Update catalog.json ===");
const catalogPath = join(REPO, "AEP-Base-Node/registry/catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
catalog.repository.catalog_path = "AEP-Base-Node/registry/catalog.json";
catalog.repository.components_path = "AEP-Base-Node/registry/components";

// Remove split lattice entries + setup-agent + typescript-sdk + commerce component path
const removeIds = new Set([
  "lattice-channel",
  "lattice-transport",
  "lattice-client",
  "setup-agent",
  "aep-typescript-sdk",
  "commerce-subprotocol",
]);
catalog.components = catalog.components.filter((c) => !removeIds.has(c.id));

// Add unified entries
catalog.components.unshift(
  {
    id: "lattice-channels",
    name: "Lattice Channels",
    kind: "library",
    bundled: true,
    default_enabled: true,
    path: `${COMPONENTS}/lattice-channels/`,
    description: "Unified lattice transport, TS client, and Rust channel crate.",
    manifest: "AEP-Base-Node/registry/components/lattice-channels.json",
  },
  {
    id: "commerce-subprotocol",
    name: "Commerce Subprotocol",
    kind: "regulation",
    bundled: true,
    default_enabled: false,
    path: "AEP-SUBPROTOCOLS/commerce/",
    lrp_id: "commerce-subprotocol",
    description: "Agentic commerce validation and spend tracking (Rust + TS types).",
    manifest: "AEP-Base-Node/registry/components/commerce-subprotocol.json",
  },
);

// Rewrite manifest paths and component paths
for (const entry of catalog.components) {
  if (entry.manifest?.startsWith("registry/")) {
    entry.manifest = entry.manifest.replace(/^registry\//, "AEP-Base-Node/registry/");
  } else if (entry.manifest?.startsWith("AEP-Base-Node/registry/")) {
    // already correct
  }
  if (entry.path?.startsWith(`${COMPONENTS}/connectors/`)) {
    entry.path = entry.path.replace(`${COMPONENTS}/connectors/`, "AEP-Connectors/");
  }
  if (entry.path?.startsWith(`${COMPONENTS}/policies/`)) {
    entry.path = entry.path.replace(`${COMPONENTS}/policies/`, "AEP-Policy-System/");
  }
  if (entry.gap_ref?.startsWith(`${COMPONENTS}/policies/`)) {
    entry.gap_ref = entry.gap_ref.replace(`${COMPONENTS}/policies/`, "AEP-Policy-System/");
  }
  if (entry.id === "potomitan") {
    entry.path = "AEP-Base-Node/potomitan/";
  }
  if (entry.id === "cca") {
    entry.description =
      "Unified CCA Setup Agent: probe, registry knowledge, plan generation and execution.";
  }
  if (entry.id === "connector-postgres") {
    entry.path = "AEP-Connectors/postgres/";
  }
}

writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

console.log("\n=== Phase 13: Write lattice-channels manifest, update cca manifest ===");
writeFileSync(
  join(REPO, "AEP-Base-Node/registry/components/lattice-channels.json"),
  JSON.stringify(
    {
      manifest_version: "1",
      id: "lattice-channels",
      version: "2.8.0",
      kind: "library",
      path: `${COMPONENTS}/lattice-channels/`,
      description: "Unified lattice channel transport, client, and Rust crate.",
      requires: ["aep-base-node"],
      capabilities: ["transport:lattice-gated-fetch", "transport:frame-builder", "channel:rust-crate"],
      actions: [],
      setup_hooks: [],
      docks: { primary: null, allowed: [] },
      resource_requirements: {
        min_memory_mb: 16,
        min_disk_mb: 5,
        requires_internet: false,
        gpu_required: false,
      },
      cca: {
        summary: "Single lattice stack. All governed HTTP uses latticeGatedFetch from lib/.",
        use_when: ["any JS/MJS/TS client", "Composer Lite", "UCB", "CCA"],
        avoid_when: ["never bypass with raw fetch"],
        pairs_with: ["aep-base-node"],
      },
      implementation: {
        module: `${COMPONENTS}/lattice-channels/lib/lattice-transport.mjs`,
        typescript_bridge: `${COMPONENTS}/lattice-channels/lib/lattice-gated-fetch.ts`,
        crate: `${COMPONENTS}/lattice-channels/crate`,
      },
    },
    null,
    2,
  ) + "\n",
);

for (const old of ["lattice-transport.json", "lattice-client.json", "lattice-channel.json", "setup-agent.json", "aep-typescript-sdk.json"]) {
  const p = join(REPO, "AEP-Base-Node/registry/components", old);
  if (existsSync(p)) rmSync(p);
}

const ccaManifestPath = join(REPO, "AEP-Base-Node/registry/components/cca.json");
if (existsSync(ccaManifestPath)) {
  const cca = JSON.parse(readFileSync(ccaManifestPath, "utf8"));
  cca.description = "Unified CCA Setup Agent: probe, registry, plan generation, plan execution, Base Node activation.";
  cca.requires = ["aep-base-node", "lattice-channels"];
  cca.capabilities = [
    ...(cca.capabilities || []),
    "setup:activate",
    "setup:execute-plan",
    "setup:inference-registration",
  ].filter((v, i, a) => a.indexOf(v) === i);
  cca.cca.pairs_with = (cca.cca.pairs_with || []).filter((x) => x !== "setup-agent");
  cca.implementation.modules = [
    ...(cca.implementation.modules || []),
    `${COMPONENTS}/cca/lib/setup/inference.mjs`,
    `${COMPONENTS}/cca/lib/setup/register.mjs`,
    `${COMPONENTS}/cca/lib/setup/install-plan.mjs`,
    `${COMPONENTS}/cca/lib/setup/reload.mjs`,
  ];
  cca.implementation.entry = `${COMPONENTS}/cca/setup-agent.mjs`;
  cca.actions = [
    ...(cca.actions || []),
    { id: "activate", description: "Activate Base Node configuration", runtime: "cli", method: "aep-cca activate" },
    { id: "setup_execute", description: "Execute plan via setup runner", runtime: "cli", method: "aep-cca setup-agent --from-plan" },
  ];
  writeFileSync(ccaManifestPath, `${JSON.stringify(cca, null, 2)}\n`);
}

const commerceManifest = join(REPO, "AEP-Base-Node/registry/components/commerce-subprotocol.json");
if (existsSync(commerceManifest)) {
  const m = JSON.parse(readFileSync(commerceManifest, "utf8"));
  m.path = "AEP-SUBPROTOCOLS/commerce/";
  if (m.implementation) m.implementation.typescript_bridge = "AEP-SUBPROTOCOLS/commerce/lib/types.ts";
  writeFileSync(commerceManifest, `${JSON.stringify(m, null, 2)}\n`);
}

const postgresManifest = join(REPO, "AEP-Base-Node/registry/components/connector-postgres.json");
if (existsSync(postgresManifest)) {
  const m = JSON.parse(readFileSync(postgresManifest, "utf8"));
  m.path = "AEP-Connectors/postgres/";
  writeFileSync(postgresManifest, `${JSON.stringify(m, null, 2)}\n`);
}

console.log("\n=== Phase 14: Bulk path rewrites ===");
const files = walk(REPO);
const pairs = [
  ["registry/catalog.json", "AEP-Base-Node/registry/catalog.json"],
  ["registry/components/", "AEP-Base-Node/registry/components/"],
  ["registry/lib/", "AEP-Base-Node/registry/lib/"],
  ["registry/schemas/", "AEP-Base-Node/registry/schemas/"],
  ["registry/scripts/", "AEP-Base-Node/registry/scripts/"],
  ["../../../registry/", "../../../AEP-Base-Node/registry/"],
  ["../../registry/", "../../AEP-Base-Node/registry/"],
  ["../registry/", "../AEP-Base-Node/registry/"],
  ["join(repoRoot, \"registry\"", "join(repoRoot, \"AEP-Base-Node/registry\""],
  ["join(REPO_ROOT, \"registry\"", "join(REPO_ROOT, \"AEP-Base-Node/registry\""],
  ["join(REPO, \"registry\"", "join(REPO, \"AEP-Base-Node/registry\""],
  [`${COMPONENTS}/lattice-transport/`, `${COMPONENTS}/lattice-channels/`],
  ["lattice-transport/lib/", "lattice-channels/lib/"],
  [`${COMPONENTS}/lattice-client/`, `${COMPONENTS}/lattice-channels/client/`],
  ["lattice-client/lib/", "lattice-channels/client/"],
  [`${COMPONENTS}/lattice-channel/`, `${COMPONENTS}/lattice-channels/`],
  ["lattice-channel/crate", "lattice-channels/crate"],
  ['"lattice-transport"', '"lattice-channels"'],
  ['"lattice-client"', '"lattice-channels"'],
  ['"lattice-channel"', '"lattice-channels"'],
  ["id: lattice-transport", "id: lattice-channels"],
  ["id: lattice-client", "id: lattice-channels"],
  ["id: lattice-channel", "id: lattice-channels"],
  ["requires: [\"lattice-transport\"", "requires: [\"lattice-channels\""],
  ["requires: [\"lattice-channel\"", "requires: [\"lattice-channels\""],
  ["lattice-transport.json", "lattice-channels.json"],
  [`${COMPONENTS}/connectors/`, "AEP-Connectors/"],
  [`${COMPONENTS}/policies/`, "AEP-Policy-System/"],
  [`${COMPONENTS}/potomitan/`, "AEP-Base-Node/potomitan/"],
  ["AEP-PROTOCOL-COMPONENTS/potomitan/", "AEP-Base-Node/potomitan/"],
  [`${COMPONENTS}/commerce/`, "AEP-SUBPROTOCOLS/commerce/"],
  ["../../setup-agent/lib/", "../setup/"],
  ["../../setup-agent/setup-agent.mjs", "../setup-agent.mjs"],
  ["../setup-agent/lib/", "./lib/setup/"],
  ["../AEP-PROTOCOL-COMPONENTS/setup-agent/", `../${COMPONENTS}/cca/`],
  [`${COMPONENTS}/setup-agent/`, `${COMPONENTS}/cca/`],
  ["harness/aep-2.8-agent-harness", "AEP-User-Experience/harness"],
  ["harness/aep-2.75-agent-harness", ""],
  ["AEP-main-skill/", "AEP-User-Experience/AEP-main-skill/"],
  [`${COMPONENTS}/typescript-sdk/`, "AEP-SDKs/typescript/aep-protocol/"],
  ["agent-control-extreme/", "AEP-Base-Node/agent-control-extreme/"],
];
// Fix double-replace issues: do lattice paths before generic lattice-id replaces
const latticePairs = pairs.filter((p) => p[0].includes("lattice"));
const otherPairs = pairs.filter((p) => !p[0].includes("lattice"));
const n1 = bulkReplace(files, latticePairs);
const n2 = bulkReplace(files, otherPairs);
console.log(`  patched ${n1 + n2} files`);

// Fix registry.mjs REPO_ROOT (registry is one level deeper)
const regLib = join(REPO, "AEP-Base-Node/registry/lib/registry.mjs");
if (existsSync(regLib)) {
  let t = readFileSync(regLib, "utf8");
  t = t.replace(
    "const REPO_ROOT = join(REGISTRY_ROOT, \"..\");",
    "const REPO_ROOT = join(REGISTRY_ROOT, \"../..\");",
  );
  t = t.replace(
    `join(repoRoot, "registry", "catalog.json")`,
    `join(repoRoot, "AEP-Base-Node/registry", "catalog.json")`,
  );
  t = t.replace(
    `from "../../${COMPONENTS}/lattice-channels/`,
    `from "../../../${COMPONENTS}/lattice-channels/`,
  );
  t = t.replace(
    `from "../../${COMPONENTS}/wizard/`,
    `from "../../../${COMPONENTS}/wizard/`,
  );
  writeFileSync(regLib, t);
}

// Fix lattice client index paths
const clientIndex = join(REPO, COMPONENTS, "lattice-channels/client/lattice/index.ts");
if (existsSync(clientIndex)) {
  writeFileSync(
    clientIndex,
    `/**
 * Lattice channel transport (canonical: lattice-channels/lib/).
 */
export {
  latticeGatedFetch,
  type LatticeGatewayMeta,
} from "../../lib/lattice-gated-fetch.js";
export {
  wasmLatticeEvaluate,
  type WasmEvaluateResult,
} from "../../lib/wasm-lattice.js";
`,
  );
}

console.log("\n=== Phase 15: Remove npm package.json (forbidden) ===");
for (const pkg of [
  join(REPO, COMPONENTS, "conformance/harness/package.json"),
  join(REPO, "docker/build/package.json"),
]) {
  if (existsSync(pkg)) {
    rmSync(pkg);
    console.log(`  removed ${pkg.replace(REPO + "/", "")}`);
  }
}
rmSync(join(REPO, "node_modules"), { recursive: true, force: true });
rmSync(join(REPO, COMPONENTS, "conformance/harness/node_modules"), { recursive: true, force: true });

console.log("\n=== Phase 16: Update README snippets ===");
const readme = join(REPO, "README.md");
if (existsSync(readme)) {
  let t = readFileSync(readme, "utf8");
  t = t.replace(/`registry\/`/g, "`AEP-Base-Node/registry/`");
  t = t.replace(/registry\/catalog\.json/g, "AEP-Base-Node/registry/catalog.json");
  if (!t.includes("AEP-SDKs")) {
    t += "\n\n## Layout (2.8 canonical)\n\n- `AEP-Base-Node/` - kernel, registry, potomitan, agent-control-extreme\n- `AEP-PROTOCOL-COMPONENTS/` - protocol components (one `lattice-channels/`)\n- `AEP-SDKs/` - language SDKs (not components)\n- `AEP-User-Experience/` - harness + skill\n- `AEP-Connectors/`, `AEP-Docks/`, `AEP-Policy-System/`\n";
  }
  writeFileSync(readme, t);
}

console.log("\nDone. Next: node AEP-Base-Node/registry/scripts/materialize-manifests-v1.mjs && cargo check");