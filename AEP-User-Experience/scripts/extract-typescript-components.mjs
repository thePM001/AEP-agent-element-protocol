#!/usr/bin/env node
/**
 * Extract typescript-sdk/src subsystems into first-class AEP component folders.
 * typescript-sdk/src retains ONLY: index.ts, gateway.ts, cli.ts
 */

import {
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(REPO, "AEP-Components/typescript-sdk", "src");

/**
 * @type {{ src: string, component: string, subdir?: string }[]}
 * subdir: name under lib/ (default: flatten files into lib/ root for single-file modules)
 */
const MOVES = [
  { src: "scanners", component: "scanners" },
  { src: "evaluation-chain", component: "evaluation-chain" },
  { src: "session", component: "session" },
  { src: "policy", component: "policy-engine", subdir: "policy" },
  { src: "ledger", component: "evidence-ledger", subdir: "ledger" },
  { src: "evidence", component: "evidence-ledger", subdir: "evidence" },
  { src: "rollback", component: "evidence-ledger", subdir: "rollback" },
  { src: "model-gateway", component: "model-gateway" },
  { src: "fleet", component: "fleet" },
  { src: "covenant", component: "covenant" },
  { src: "knowledge", component: "knowledge-base", subdir: "knowledge" },
  { src: "trust", component: "trust-rings", subdir: "trust" },
  { src: "rings", component: "trust-rings", subdir: "rings" },
  { src: "proof-bundle", component: "proof-bundle" },
  { src: "recovery", component: "recovery" },
  { src: "workflow", component: "workflow" },
  { src: "aepassist", component: "aepassist", subdir: "aepassist" },
  { src: "assist", component: "aepassist", subdir: "assist" },
  { src: "identity", component: "identity" },
  { src: "intent", component: "intent" },
  { src: "decomposition", component: "decomposition" },
  { src: "telemetry", component: "telemetry" },
  { src: "proxy", component: "proxy" },
  { src: "datasets", component: "datasets" },
  { src: "graph", component: "graph-engine", subdir: "graph" },
  { src: "verification", component: "verification" },
  { src: "streaming", component: "streaming" },
  { src: "subprotocols/mcp-security", component: "mcp-security", subdir: "mcp-security" },
  { src: "aep-comm", component: "aep-comm" },
  { src: "eval", component: "eval" },
  { src: "optimization", component: "optimization" },
  { src: "permissions", component: "permissions" },
  { src: "intercept", component: "intercept" },
  { src: "lattice", component: "lattice-channels", subdir: "lattice" },
];

/** @type {Record<string, string>} old import prefix (after ../) -> new relative from any component file */
const MODULE_TARGETS = {
  scanners: "AEP-Components/scanners/lib",
  "evaluation-chain": "AEP-Components/evaluation-chain/lib",
  session: "AEP-Components/session/lib",
  policy: "AEP-Components/policy-engine/lib/policy",
  ledger: "AEP-Components/evidence-ledger/lib/ledger",
  evidence: "AEP-Components/evidence-ledger/lib/evidence",
  rollback: "AEP-Components/evidence-ledger/lib/rollback",
  "model-gateway": "AEP-Components/model-gateway/lib",
  fleet: "AEP-Components/fleet/lib",
  covenant: "AEP-Components/covenant/lib",
  knowledge: "AEP-Components/knowledge-base/lib/knowledge",
  trust: "AEP-Components/trust-rings/lib/trust",
  rings: "AEP-Components/trust-rings/lib/rings",
  "proof-bundle": "AEP-Components/proof-bundle/lib",
  recovery: "AEP-Components/recovery/lib",
  workflow: "AEP-Components/workflow/lib",
  aepassist: "AEP-Components/aepassist/lib/aepassist",
  assist: "AEP-Components/aepassist/lib/assist",
  identity: "AEP-Components/identity/lib",
  intent: "AEP-Components/intent/lib",
  decomposition: "AEP-Components/decomposition/lib",
  telemetry: "AEP-Components/telemetry/lib",
  proxy: "AEP-Components/proxy/lib",
  datasets: "AEP-Components/datasets/lib",
  graph: "AEP-Components/graph-engine/lib/graph",
  verification: "AEP-Components/verification/lib",
  streaming: "AEP-Components/streaming/lib",
  "subprotocols/mcp-security": "AEP-Components/mcp-security/lib/mcp-security",
  "mcp-security": "AEP-Components/mcp-security/lib/mcp-security",
  "aep-comm": "AEP-Components/aep-comm/lib",
  eval: "AEP-Components/eval/lib",
  optimization: "AEP-Components/optimization/lib",
  permissions: "AEP-Components/permissions/lib",
  intercept: "AEP-Components/intercept/lib",
  lattice: "AEP-Components/lattice-channels/client/lib/lattice",
  commerce: "AEP-Subprotocols/commerce/lib",
  economics: "AEP-Components/economics/lib",
  "schema-builder": "AEP-Policy-System/schema-builder/lib",
  "policy-builder": "AEP-Policy-System/policy-builder/lib",
};

function moveTree(srcPath, destPath) {
  mkdirSync(dirname(destPath), { recursive: true });
  if (!existsSync(srcPath)) return false;
  renameSync(srcPath, destPath);
  return true;
}

function moveModule({ src, component, subdir }) {
  const srcPath = join(SRC, src);
  if (!existsSync(srcPath)) return;
  const libRoot = join(REPO, component, "lib");
  mkdirSync(libRoot, { recursive: true });
  const dest = subdir ? join(libRoot, subdir) : libRoot;
  if (existsSync(dest)) {
    for (const f of readdirSync(srcPath)) {
      const from = join(srcPath, f);
      const to = join(dest, f);
      if (existsSync(to) && statSync(from).isDirectory()) {
        for (const g of readdirSync(from)) {
          renameSync(join(from, g), join(to, g));
        }
      } else {
        renameSync(from, to);
      }
    }
    rmSync(srcPath, { recursive: true, force: true });
  } else {
    moveTree(srcPath, dest);
  }
  console.log(`  ${src} -> ${component}/lib/${subdir ?? ""}`);
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      walkFiles(p, out);
    } else if (/\.(ts|mjs|js)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

import { relative } from "node:path";

function relImport(fromFile, toFile) {
  let r = relative(dirname(fromFile), toFile).replace(/\\/g, "/");
  if (!r.startsWith(".")) r = `./${r}`;
  return r;
}

function rewriteImportsFixed(filePath) {
  let text = readFileSync(filePath, "utf8");
  const original = text;

  for (const [mod, target] of Object.entries(MODULE_TARGETS)) {
    const escaped = mod.replace("/", "\\/");
    text = text.replace(
      new RegExp(`from "(\\.\\./)+${escaped}/([^"]+)"`, "g"),
      (_m, _dots, rest) => `from "${relImport(filePath, join(REPO, target, rest))}"`,
    );
    text = text.replace(
      new RegExp(`from '(\\.\\./)+${escaped}/([^']+)'`, "g"),
      (_m, _dots, rest) => `from '${relImport(filePath, join(REPO, target, rest))}'`,
    );
    text = text.replace(
      new RegExp(`from "\\./${escaped}/([^"]+)"`, "g"),
      (_m, rest) => `from "${relImport(filePath, join(REPO, target, rest))}"`,
    );
    text = text.replace(
      new RegExp(`from '\\./${escaped}/([^']+)'`, "g"),
      (_m, rest) => `from '${relImport(filePath, join(REPO, target, rest))}'`,
    );
  }

  if (text !== original) writeFileSync(filePath, text);
  return text !== original;
}

console.log("Extracting TypeScript subsystems from typescript-sdk/src ...");
const seen = new Set();
for (const move of MOVES) {
  const key = `${move.src}:${move.component}`;
  if (seen.has(key)) continue;
  seen.add(key);
  moveModule(move);
}

if (existsSync(join(SRC, "subprotocols"))) {
  try {
    rmSync(join(SRC, "subprotocols"), { recursive: true, force: true });
  } catch {
    /* */
  }
}
if (existsSync(join(SRC, "cli"))) {
  // keep cli helpers next to cli.ts if any - move to typescript-sdk/cli/
  const cliDest = join(REPO, "AEP-Components/typescript-sdk", "cli");
  mkdirSync(cliDest, { recursive: true });
  for (const f of readdirSync(join(SRC, "cli"))) {
    renameSync(join(SRC, "cli", f), join(cliDest, f));
  }
  rmSync(join(SRC, "cli"), { recursive: true, force: true });
}

const roots = [REPO, join(REPO, "AEP-NOSHIP/tests"), join(REPO, "examples")];
const files = new Set();
for (const root of roots) {
  walkFiles(root, []).forEach((f) => files.add(f));
}

let n = 0;
for (const f of files) {
  if (f.includes("node_modules")) continue;
  if (rewriteImportsFixed(f)) n++;
}
console.log(`Rewrote imports in ${n} files.`);

const remaining = existsSync(SRC) ? readdirSync(SRC) : [];
console.log("AEP-SDKs/typescript/aep-protocol/src remaining:", remaining.join(", "));