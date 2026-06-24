#!/usr/bin/env node
/**
 * Finish TypeScript SDK decomposition:
 * - Fix broken index.ts paths
 * - Rewrite test imports away from typescript-sdk/src/
 * - Add catalog entries + READMEs for extracted components
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Old typescript-sdk/src module prefix -> component lib path */
const TEST_IMPORT_MAP = [
  ["AEP-SDKs/typescript/aep-protocol/src/policy/", "AEP-Components/policy-engine/lib/policy/"],
  ["AEP-SDKs/typescript/aep-protocol/src/ledger/", "AEP-Components/evidence-ledger/lib/ledger/"],
  ["AEP-SDKs/typescript/aep-protocol/src/evidence/", "AEP-Components/evidence-ledger/lib/evidence/"],
  ["AEP-SDKs/typescript/aep-protocol/src/rollback/", "AEP-Components/evidence-ledger/lib/rollback/"],
  ["AEP-SDKs/typescript/aep-protocol/src/subprotocols/mcp-security/", "AEP-Components/mcp-security/lib/mcp-security/"],
  ["AEP-SDKs/typescript/aep-protocol/src/aepassist/", "AEP-Components/aepassist/lib/aepassist/"],
  ["AEP-SDKs/typescript/aep-protocol/src/assist/", "AEP-Components/aepassist/lib/assist/"],
  ["AEP-SDKs/typescript/aep-protocol/src/knowledge/", "AEP-Components/knowledge-base/lib/knowledge/"],
  ["AEP-SDKs/typescript/aep-protocol/src/trust/", "AEP-Components/trust-rings/lib/trust/"],
  ["AEP-SDKs/typescript/aep-protocol/src/rings/", "AEP-Components/trust-rings/lib/rings/"],
  ["AEP-SDKs/typescript/aep-protocol/src/graph/", "AEP-Components/graph-engine/lib/graph/"],
  ["AEP-SDKs/typescript/aep-protocol/src/lattice/", "AEP-Components/lattice-channels/client/lib/lattice/"],
  ["AEP-SDKs/typescript/aep-protocol/src/scanners/", "AEP-Components/scanners/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/evaluation-chain/", "AEP-Components/evaluation-chain/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/session/", "AEP-Components/session/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/model-gateway/", "AEP-Components/model-gateway/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/fleet/", "AEP-Components/fleet/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/covenant/", "AEP-Components/covenant/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/proof-bundle/", "AEP-Components/proof-bundle/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/recovery/", "AEP-Components/recovery/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/workflow/", "AEP-Components/workflow/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/identity/", "AEP-Components/identity/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/intent/", "AEP-Components/intent/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/decomposition/", "AEP-Components/decomposition/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/telemetry/", "AEP-Components/telemetry/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/proxy/", "AEP-Components/proxy/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/datasets/", "AEP-Components/datasets/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/verification/", "AEP-Components/verification/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/streaming/", "AEP-Components/streaming/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/aep-comm/", "AEP-Components/aep-comm/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/eval/", "AEP-Components/eval/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/optimization/", "AEP-Components/optimization/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/permissions/", "AEP-Components/permissions/lib/"],
  ["AEP-SDKs/typescript/aep-protocol/src/intercept/", "AEP-Components/intercept/lib/"],
];

const TS_COMPONENTS = [
  { id: "evaluation-chain", name: "Evaluation Chain", kind: "library", path: "AEP-Components/evaluation-chain/", description: "Short-circuit evaluation chain with step activation profiles." },
  { id: "session", name: "Session Governance", kind: "library", path: "AEP-Components/session/", description: "Agent session lifecycle, kill switch, and session manager." },
  { id: "policy-engine", name: "Policy Engine", kind: "library", path: "AEP-Components/policy-engine/", description: "YAML policy loading, validation, and evaluation." },
  { id: "evidence-ledger", name: "Evidence Ledger", kind: "library", path: "AEP-Components/evidence-ledger/", description: "Merkle evidence ledger, rollback, and quantum timestamps." },
  { id: "model-gateway", name: "Model Gateway", kind: "library", path: "AEP-Components/model-gateway/", description: "Governed multi-provider LLM gateway with adapters." },
  { id: "fleet", name: "Fleet Governance", kind: "library", path: "AEP-Components/fleet/", description: "Multi-agent fleet manager, spawn governance, message scanning." },
  { id: "covenant", name: "Behavioral Covenants", kind: "library", path: "AEP-Components/covenant/", description: "Parse, evaluate, and compile behavioral covenant specs." },
  { id: "knowledge-base", name: "Knowledge Base", kind: "library", path: "AEP-Components/knowledge-base/", description: "Lattice-governed knowledge ingest and retrieval." },
  { id: "trust-rings", name: "Trust and Rings", kind: "library", path: "AEP-Components/trust-rings/", description: "Trust scoring and execution ring capability gating." },
  { id: "proof-bundle", name: "Proof Bundles", kind: "library", path: "AEP-Components/proof-bundle/", description: "Build and verify session proof bundles with reliability index." },
  { id: "recovery", name: "Recovery Engine", kind: "library", path: "AEP-Components/recovery/", description: "Violation detection and governed recovery attempts." },
  { id: "workflow", name: "Workflow Phases", kind: "library", path: "AEP-Components/workflow/", description: "Multi-phase workflow executor and fine-tuning templates." },
  { id: "aepassist", name: "AEP Assist", kind: "agent", path: "AEP-Components/aepassist/", description: "Interactive assistant, presets, and slash-command generators." },
  { id: "identity", name: "Agent Identity", kind: "library", path: "AEP-Components/identity/", description: "Agent identity manager and compact identity types." },
  { id: "intent", name: "Intent Drift", kind: "library", path: "AEP-Components/intent/", description: "Intent baseline and drift detection." },
  { id: "decomposition", name: "Task Decomposition", kind: "library", path: "AEP-Components/decomposition/", description: "Governed task tree decomposition and completion gates." },
  { id: "telemetry", name: "Telemetry Export", kind: "library", path: "AEP-Components/telemetry/", description: "OpenTelemetry span and event exporter for AEP." },
  { id: "proxy", name: "AEP Proxy", kind: "library", path: "AEP-Components/proxy/", description: "MCP and shell proxy servers under lattice governance." },
  { id: "datasets", name: "Dataset Manager", kind: "library", path: "AEP-Components/datasets/", description: "Governed dataset management for eval and training." },
  { id: "graph-engine", name: "Graph Engine", kind: "library", path: "AEP-Components/graph-engine/", description: "Agent governance graph engine and scene registry." },
  { id: "verification", name: "Cross-Agent Verification", kind: "library", path: "AEP-Components/verification/", description: "Handshake proofs and counterparty verification." },
  { id: "streaming", name: "Streaming Validation", kind: "library", path: "AEP-Components/streaming/", description: "Stream validator and middleware for governed output." },
  { id: "mcp-security", name: "MCP Security", kind: "regulation", path: "AEP-Components/mcp-security/", description: "MCP subprotocol security scanners and policies." },
  { id: "aep-comm", name: "AEP Communication", kind: "library", path: "AEP-Components/aep-comm/", description: "Inter-agent communication helpers." },
  { id: "eval", name: "Eval Lifecycle", kind: "library", path: "AEP-Components/eval/", description: "Eval runner, rule generator, and ML metrics." },
  { id: "optimization", name: "Prompt Optimization", kind: "library", path: "AEP-Components/optimization/", description: "Governed prompt optimizer and version manager." },
  { id: "permissions", name: "Permissions", kind: "library", path: "AEP-Components/permissions/", description: "Capability permission checks for agent actions." },
  { id: "intercept", name: "Action Intercept", kind: "library", path: "AEP-Components/intercept/", description: "Pre/post action intercept hooks." },
  { id: "lattice-channels", name: "Lattice Client", kind: "library", path: "AEP-Components/lattice-channels/client/", description: "TypeScript lattice client helpers." },
];

function fixIndexTs() {
  const indexPath = join(REPO, "AEP-SDKs/typescript/aep-protocol/src/index.ts");
  let text = readFileSync(indexPath, "utf8");
  text = text.replace(/from "\.\.\/\.\.\/([^"]+)"/g, 'from "../../../../AEP-Components/$1"');
  text = text.replace(/\/lib\/lib\//g, "/lib/");
  text = text.replace(
    /AEP-Components\/AEP-Components\//g,
    "AEP-Components/",
  );
  writeFileSync(indexPath, text);
  console.log("Fixed AEP-SDKs/typescript/aep-protocol/src/index.ts");
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      walkFiles(p, out);
    } else if (/\.(ts|mjs|js|md)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function fixTestImports() {
  const roots = [join(REPO, "AEP-NOSHIP/tests"), join(REPO, "AEP-Components/commerce"), join(REPO, "AEP-Components/aepassist")];
  let n = 0;
  for (const root of roots) {
    for (const file of walkFiles(root)) {
      let text = readFileSync(file, "utf8");
      const orig = text;
      for (const [from, to] of TEST_IMPORT_MAP) {
        text = text.split(from).join(to);
      }
      if (text !== orig) {
        writeFileSync(file, text);
        n++;
      }
    }
  }
  console.log(`Fixed imports in ${n} files`);
}

function ensureReadmes() {
  const catalog = JSON.parse(readFileSync(join(REPO, "AEP-Base-Node/registry", "catalog.json"), "utf8"));
  let n = 0;
  for (const entry of catalog.components) {
    if (entry.bundled === false || entry.kind === "template") continue;
    const readme = join(REPO, entry.path, "README.md");
    if (existsSync(readme)) continue;
    mkdirSync(dirname(readme), { recursive: true });
    const desc = entry.description || `${entry.name} AEP component.`;
    writeFileSync(
      readme,
      `# ${entry.name}\n\n${desc}\n\n- **Component ID:** \`${entry.id}\`\n- **Path:** \`${entry.path}\`\n- **Manifest:** \`${entry.manifest}\`\n\nRe-exported by \`typescript-sdk/\` for programmatic access. Runtime code lives in \`lib/\`.\n`,
    );
    n++;
    console.log(`  wrote ${entry.path}README.md`);
  }
  console.log(`Created ${n} READMEs`);
}

function updateCatalog() {
  const catalogPath = join(REPO, "AEP-Base-Node/registry", "catalog.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

  const gap = catalog.components.find((c) => c.id === "gap-runtime-scanners");
  if (gap) {
    gap.path = "AEP-Components/scanners/";
    gap.description = "Optional 11-scanner GAP bundle (extracted from typescript-sdk).";
  }

  const existing = new Set(catalog.components.map((c) => c.id));
  for (const comp of TS_COMPONENTS) {
    if (existing.has(comp.id)) continue;
    catalog.components.push({
      id: comp.id,
      name: comp.name,
      kind: comp.kind,
      bundled: true,
      default_enabled: comp.id === "policy-engine" || comp.id === "session" || comp.id === "evidence-ledger",
      path: comp.path,
      description: comp.description,
      manifest: `AEP-Base-Node/registry/components/${comp.id}.json`,
    });
    console.log(`  catalog +${comp.id}`);
  }

  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Catalog now has ${catalog.components.length} components`);
}

fixIndexTs();
fixTestImports();
updateCatalog();
ensureReadmes();