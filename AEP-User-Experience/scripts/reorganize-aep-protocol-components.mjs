#!/usr/bin/env node
/**
 * Move all AEP protocol component folders under AEP-Components/
 * and rewrite catalog, manifests, imports, Cargo, Docker references.
 */

import {
  existsSync,
  mkdirSync,
  renameSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ROOT = "AEP-Components";

const MOVE_DIRS = [
  "lattice-crypto",
  "lattice-channels",
  "AEP-Base-Node",
  "lattice-memory",
  "agentmesh",
  "potomitan",
  "dynAEP",
  "lattice-channels",
  "cca",
  "setup-agent",
  "wizard",
  "composer-lite",
  "ucb",
  "typescript-sdk",
  "wasm",
  "scanners",
  "commerce",
  "economics",
  "schema-builder",
  "policy-builder",
  "connectors",
  "evaluation-chain",
  "session",
  "policy-engine",
  "evidence-ledger",
  "model-gateway",
  "fleet",
  "covenant",
  "knowledge-base",
  "trust-rings",
  "proof-bundle",
  "recovery",
  "workflow",
  "aepassist",
  "identity",
  "intent",
  "decomposition",
  "telemetry",
  "proxy",
  "datasets",
  "graph-engine",
  "verification",
  "streaming",
  "mcp-security",
  "aep-comm",
  "eval",
  "optimization",
  "permissions",
  "intercept",
  "lattice-channels",
  "conformance",
  "policies",
];

const SKIP_WALK = new Set(["node_modules", ".git", ROOT]);

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_WALK.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (/\.(ts|mjs|js|json|sh|toml|md|yml|yaml)$/.test(name)) out.push(p);
  }
  return out;
}

function prefixPath(p) {
  if (!p || p.startsWith(ROOT + "/") || p === ROOT + "/") return p;
  if (p === "AEP-Base-Node/registry/components/") return p;
  return `${ROOT}/${p}`;
}

function moveComponents() {
  const destRoot = join(REPO, ROOT);
  mkdirSync(destRoot, { recursive: true });
  for (const dir of MOVE_DIRS) {
    const src = join(REPO, dir);
    const dest = join(destRoot, dir);
    if (!existsSync(src)) {
      console.warn(`  skip missing ${dir}`);
      continue;
    }
    if (existsSync(dest)) {
      console.warn(`  already at ${ROOT}/${dir}`);
      continue;
    }
    renameSync(src, dest);
    console.log(`  moved ${dir} -> ${ROOT}/${dir}`);
  }
}

function updateCatalog() {
  const catalogPath = join(REPO, "AEP-Base-Node/registry", "catalog.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  catalog.repository.components_root = `${ROOT}/`;
  for (const entry of catalog.components) {
    if (entry.path && entry.path !== "AEP-Base-Node/registry/components/") {
      entry.path = prefixPath(entry.path);
    }
    if (entry.gap_ref) entry.gap_ref = prefixPath(entry.gap_ref);
  }
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log("Updated AEP-Base-Node/registry/catalog.json");
}

function updateCargoToml() {
  const cargoPath = join(REPO, "Cargo.toml");
  let text = readFileSync(cargoPath, "utf8");
  for (const dir of [
    "lattice-crypto",
    "lattice-channels",
    "agentmesh",
    "potomitan",
    "lattice-memory",
    "AEP-Base-Node",
    "wasm",
    "conformance",
  ]) {
    text = text.replaceAll(`"${dir}/crate"`, `"${ROOT}/${dir}/crate"`);
  }
  text = text.replaceAll(`default-members = ["AEP-Base-Node/crate"]`, `default-members = ["${ROOT}/AEP-Base-Node/crate"]`);
  writeFileSync(cargoPath, text);
  console.log("Updated Cargo.toml");
}

function patchFile(path, replacers) {
  if (!existsSync(path)) return false;
  let text = readFileSync(path, "utf8");
  const orig = text;
  for (const [from, to] of replacers) {
    if (typeof from === "string") text = text.split(from).join(to);
    else text = text.replace(from, to);
  }
  if (text !== orig) {
    writeFileSync(path, text);
    return true;
  }
  return false;
}

function updateRegistryLibImports() {
  patchFile(join(REPO, "AEP-Base-Node/registry", "lib", "registry.mjs"), [
    ['from "../../lattice-transport/', `from "../${ROOT}/lattice-transport/`],
    ['from "../../wizard/', `from "../${ROOT}/wizard/`],
  ]);
}

function updateComponentRegistryImports() {
  const files = [
    join(REPO, ROOT, "cca", "lib", "plan-executor.mjs"),
    join(REPO, ROOT, "cca", "lib", "registry-context.mjs"),
    join(REPO, ROOT, "composer-lite", "lib", "http-api.mjs"),
  ];
  for (const f of files) {
    patchFile(f, [['from "../../AEP-Base-Node/registry/', 'from "../../../AEP-Base-Node/registry/']]);
  }
}

function updateMaterializeScript() {
  const scriptPath = join(REPO, "AEP-Base-Node/registry", "scripts", "materialize-manifests-v1.mjs");
  let text = readFileSync(scriptPath, "utf8");
  const pathKeys = [
    "path:",
    "crate:",
    "binary:",
    "module:",
    "cli:",
    "gateway:",
    "barrel:",
    "entry:",
    "entrypoints:",
    "validator:",
    "spend_tracker:",
    "registry:",
    "orchestrator:",
    "barrel:",
    "typescript_bridge:",
    "harness:",
    "gap_ref:",
    "docker_path:",
    "dist:",
    "health:",
    "graph_api:",
    "lattice_transport:",
    "capabilities_path:",
    "port:",
    "socket:",
  ];
  // Prefix quoted paths that look like component roots (not registry/, tests/, http)
  const componentPrefixes = [
    "AEP-Base-Node/", "lattice-crypto/", "lattice-channel/", "lattice-memory/", "lattice-transport/",
    "agentmesh/", "potomitan/", "dynAEP/", "cca/", "setup-agent/", "wizard/", "composer-lite/",
    "ucb/", "typescript-sdk/", "wasm/", "conformance/", "scanners/", "commerce/", "economics/",
    "schema-builder/", "policy-builder/", "connectors/", "policies/", "evaluation-chain/", "session/",
    "policy-engine/", "evidence-ledger/", "model-gateway/", "fleet/", "covenant/", "knowledge-base/",
    "trust-rings/", "proof-bundle/", "recovery/", "workflow/", "aepassist/", "identity/", "intent/",
    "decomposition/", "telemetry/", "proxy/", "datasets/", "graph-engine/", "verification/",
    "streaming/", "mcp-security/", "aep-comm/", "eval/", "optimization/", "permissions/", "intercept/",
    "lattice-client/",
  ];
  for (const prefix of componentPrefixes) {
    const escaped = prefix.replace(/\//g, "\\/");
    text = text.replace(
      new RegExp(`(["'])(${escaped})`, "g"),
      (m, q, p) => (p.startsWith(ROOT + "/") ? m : `${q}${ROOT}/${p}`),
    );
  }
  text = text.replaceAll('docker_path: "/opt/aep/dynAEP"', `docker_path: "/opt/aep/${ROOT}/dynAEP"`);
  writeFileSync(scriptPath, text);
  console.log("Updated materialize-manifests-v1.mjs");
}

function bulkUpdateRepoFiles() {
  const componentNames = MOVE_DIRS.slice().sort((a, b) => b.length - a.length);
  let n = 0;
  const roots = [join(REPO, "AEP-NOSHIP/tests"), join(REPO, "AEP-User-Experience/scripts"), join(REPO, "AEP-Base-Node/registry"), join(REPO, "docker"), REPO];
  const rootFiles = ["vitest.config.ts", "Dockerfile", "docker-compose.public.yml"];
  for (const rf of rootFiles) {
    const p = join(REPO, rf);
    if (existsSync(p)) roots.push(p);
  }

  const files = new Set();
  for (const root of roots) {
    if (statSync(root).isFile()) files.add(root);
    else walkFiles(root, []).forEach((f) => files.add(f));
  }
  // also walk harness at repo root (not moved)
  walkFiles(join(REPO, "harness"), []).forEach((f) => files.add(f));

  for (const file of files) {
    if (file.includes(`${ROOT}/`) && !file.includes("reorganize-aep-protocol-components")) continue;
    if (file.endsWith("reorganize-aep-protocol-components.mjs")) continue;
    let text = readFileSync(file, "utf8");
    const orig = text;

    // tests and scripts: ../../component/ -> ../../AEP-Components/component/
    for (const name of componentNames) {
      text = text.split(`../../${name}/`).join(`../../${ROOT}/${name}/`);
      text = text.split(`"../${name}/`).join(`"../${ROOT}/${name}/`);
      text = text.split(`'../${name}/`).join(`'../${ROOT}/${name}/`);
      text = text.split(`join(repoRoot, "${name}`).join(`join(repoRoot, "${ROOT}/${name}`);
      text = text.split(`join(REPO_ROOT, "${name}`).join(`join(REPO_ROOT, "${ROOT}/${name}`);
      text = text.split(`join(REPO, "${name}`).join(`join(REPO, "${ROOT}/${name}`);
      if (!text.includes(`"${ROOT}/${name}/`)) {
        text = text.split(`"${name}/`).join(`"${ROOT}/${name}/`);
      }
    }

    // Dockerfile COPY lines
    text = text.replace(/^COPY ([a-zA-Z0-9_-]+)\/ /gm, (line, dir) => {
      if (MOVE_DIRS.includes(dir)) return `COPY ${ROOT}/${dir}/ ./${ROOT}/${dir}/\n`;
      return line;
    });

    // /opt/aep/ paths in docker
    for (const name of componentNames) {
      text = text.split(`/opt/aep/${name}/`).join(`/opt/aep/${ROOT}/${name}/`);
    }

    if (text !== orig) {
      writeFileSync(file, text);
      n++;
    }
  }
  console.log(`Bulk-patched ${n} files`);
}

function writeComponentsReadme() {
  const readme = join(REPO, ROOT, "README.md");
  writeFileSync(
    readme,
    `# AEP Protocol Components

All bundled AEP protocol components live under this directory. Each subfolder is a first-class component with its own \`README.md\`, registry manifest (\`AEP-Base-Node/registry/components/{id}.json\`), and \`lib/\` or \`crate/\` implementation.

The TypeScript SDK (\`typescript-sdk/\`) is a **thin client surface** only (\`index.ts\`, \`gateway.ts\`, \`cli.ts\`). It re-exports sibling components here; it is not a monolith.

Infrastructure that stays at the repository root:

- \`registry/\` - component catalog and manifest JSON
- \`AEP-NOSHIP/tests/\` - conformance and unit tests
- \`docker/\` - container entrypoint and runtime deps
- \`AEP-User-Experience/scripts/\` - manual modification and E2E tooling

CCA and the setup agent resolve component paths via \`AEP-Base-Node/registry/catalog.json\` (\`repository.components_root\`).
`,
  );
}

console.log(`Creating ${ROOT}/ and moving component folders...`);
moveComponents();
updateCatalog();
updateCargoToml();
updateRegistryLibImports();
updateComponentRegistryImports();
updateMaterializeScript();
bulkUpdateRepoFiles();
writeComponentsReadme();
console.log("Done. Run: node AEP-Base-Node/registry/scripts/materialize-manifests-v1.mjs");