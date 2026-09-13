#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPolicySystemContext } from "./policy-system-context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");
const GAP_ROOT = join(REPO_ROOT, "AEP-Components/gap");

/** @param {string} repoRoot */
function loadComponentGapReferenceFiles(repoRoot) {
  const policiesDir = join(repoRoot, "AEP-Components/gap/policies/reference");
  const out = [];
  if (!existsSync(policiesDir)) return out;
  for (const name of readdirSync(policiesDir).filter((f) => f.endsWith(".gap"))) {
    const path = join(policiesDir, name);
    let address = basename(name, ".gap");
    let kind = "instruction";
    try {
      const raw = readFileSync(path, "utf8");
      const domainMatch = raw.match(/domain:\s*([^\n]+)/);
      const idMatch = raw.match(/^\s*id:\s*([^\n]+)/m);
      address =
        domainMatch && idMatch
          ? `${domainMatch[1].trim()}/${idMatch[1].trim()}`
          : basename(name, ".gap");
      if (/kind:\s*aep\.caw\.profile/m.test(raw)) kind = "caw-profile";
      else if (/kind:\s*aep\.task_manifest\.template/m.test(raw)) kind = "task-manifest";
      else if (/kind:\s*aep\.implementation_plan\.template/m.test(raw)) kind = "implementation-plan";
    } catch {
      /* keep basename */
    }
    out.push({
      file: `AEP-Components/gap/policies/reference/${name}`,
      address,
      kind,
      source: "AEP-Components/gap",
    });
  }
  return out;
}

const GAP_PRINCIPLES = [
  "Instructions are the primitive; patterns guard, actions resolve.",
  "Three layers: (1) constrained decoding, (2) structural validation, (3) governance lattice.",
  "Subprotocol-first: each domain has a validator at lattice Step 3.5.",
  "Composition types: atomic, sequence, conditional, loop, parallel, abstraction.",
  "Governance inline: trust_ring, covenants, budget, proof, scanners, tools.",
  "GAP enforces itself via meta-schema; invalid .gap cannot be activated.",
];

const SUBPROTOCOLS_KNOWN = [
  "ui",
  "workflows",
  "rest-api",
  "events",
  "iac",
  "commerce",
  "coding-governance",
  "caw",
  "ucb",
  "cca",
  "tensor",
  "molecular",
  "drone",
  "robotics",
  "material-science",
];

/**
 * Load GAP language knowledge for CCA prompts and context API.
 * @param {string} [repoRoot]
 */
export function loadGapContext(repoRoot = REPO_ROOT) {
  const gapRoot = join(repoRoot, "AEP-Components/gap");
  const schemasDir = join(gapRoot, "schemas");

  const schemas = [];
  if (existsSync(schemasDir)) {
    for (const name of readdirSync(schemasDir).filter((f) => f.endsWith(".json"))) {
      schemas.push({
        file: `AEP-Components/gap/schemas/${name}`,
        version: name.includes("v1.2") ? "1.2" : name.includes("v1") ? "1.0" : "unknown",
      });
    }
  }

  const policySystem = loadPolicySystemContext(repoRoot);
  const reference_policies = [
    ...policySystem.reference_policies.map((p) => ({
      file: p.path,
      address: p.domain,
      source: "AEP-Policy-System",
    })),
  ];
  const component_reference_policies = loadComponentGapReferenceFiles(repoRoot);
  reference_policies.push(...component_reference_policies);

  let meta_schema_required = ["address", "pattern", "action", "weight", "composition", "metadata"];
  try {
    const meta = JSON.parse(
      readFileSync(join(schemasDir, "gap-meta-schema-v1.2.json"), "utf8"),
    );
    if (Array.isArray(meta.required)) meta_schema_required = meta.required;
  } catch {
    // keep defaults
  }

  return {
    component_id: "gap",
    path: "AEP-Components/gap/",
    upstream: "https://github.com/thePM001/gap",
    principles: GAP_PRINCIPLES,
    meta_schema_required,
    schemas,
    reference_policies,
    component_reference_policies,
    subprotocols: SUBPROTOCOLS_KNOWN,
    file_format: {
      extension: ".gap",
      encoding: "UTF-8",
      syntax: "YAML 1.2",
      multi_document: "--- separators",
    },
    cca_guidance: {
      always_enable_for: [
        "governed agent deployments",
        "coding agents (Cursor, Claude Code, Codex)",
        "WASM policy evaluation nodes",
        "dynAEP Action Lattice workflows",
      ],
      policy_overrides_key: "gap",
      pairs_with: ["coding-governance", "dynaep-core", "wasm-policy-sandbox", "policy-engine"],
      do_not_confuse: {
        writing_gap: "writing.gap is EPSCOM prose lint, not the GAP instruction language",
        lrp: "GAP reference policies are not nation-state LRP slots unless wrapped as regulation packs",
      },
    },
  };
}

/**
 * Compact GAP section for LLM system prompt.
 * @param {ReturnType<typeof loadGapContext>} gap
 */
export function formatGapForPrompt(gap) {
  const lines = [
    "",
    "GAP (Governed Agentic Programming) - CCA must understand this language:",
    `Source: ${gap.path} (vendored from ${gap.upstream})`,
    "",
    "First principles:",
  ];
  for (const p of gap.principles) lines.push(`- ${p}`);

  lines.push(
    "",
    `File format: ${gap.file_format.extension} pure YAML, required top-level fields: ${gap.meta_schema_required.join(", ")}`,
    "",
    "Registered subprotocols (lattice Step 3.5 validators):",
    gap.subprotocols.join(", "),
    "",
    "Reference .gap policies (canonical: AEP-Policy-System/reference/ plus coding-governance in gap/):",
  );
  for (const pol of gap.reference_policies) {
    const src = pol.source ? ` [${pol.source}]` : "";
    lines.push(`- ${pol.address} -> ${pol.file}${src}`);
  }

  lines.push(
    "",
    "When planning deployments:",
    "- Enable component `gap` (default_enabled) for all governed agent stacks.",
    "- For AI coding agents, also enable `coding-governance` and set policy_overrides.coding_governance.require_propose when user wants pre-change intent.",
    "- Reference policies in policy_overrides.gap.reference_policies (paths above).",
    "- Use wasm_policy topology nodes when user mentions GAP eval or WASM policy.",
    "- dynAEP Action Lattice evaluates GAP instructions; do not route GAP through validation dock unless a validation engine is installed.",
    "",
    "Distinction:",
    "- `writing.gap` = EPSCOM prose style lint (em-dash ban). NOT the GAP language.",
    "- GAP `.gap` files = governed agent instructions with patterns, actions, composition, metadata.",
  );

  return lines.join("\n");
}