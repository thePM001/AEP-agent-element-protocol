#!/usr/bin/env node

/**
 * Coding governance + git integration knowledge for CCA agent builders.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");

export const CODING_GOVERNANCE_WORKFLOW = [
  "aep propose --intent \"<statement>\" --paths <paths...>",
  "# agent edits under AEP_SEMANTIC_STRICT=1 (gateway checks propose token)",
  "aep announce --intent-id INT-... --agent-id <agent> [--thread-id ...]  # multi-agent",
  "# git commit / PR as normal - git stays substrate",
  "aep solidify --intent-id INT-... [--session-id <gateway-session>]  # auto-captures git HEAD",
  "aep semantic explain INT-...",
];

export function loadCodingGovernanceContext(repoRoot = REPO_ROOT) {
  return {
    component_id: "coding-governance",
    path: "AEP-Components/coding-governance/",
    subprotocol: "AEP-Subprotocols/coding-governance/",
    pairs_with: ["gap", "intent-ledger", "semantic-topology", "caw-framework", "lattice-memory"],
    nool_parity: {
      propose: "aep propose",
      blast_radius: "coding-governance blast_radius action",
      siee: "semantic impact envelope in propose",
      solidify: "aep solidify + intent-ledger hash chain",
      announce: "aep announce + task manifest + lattice frame",
      visualize: "Composer hyperlattice blast overlay (not a parallel DAG)",
      git: "git_refs auto-captured at propose and solidify; PR/commits unchanged",
    },
    git_integration: {
      enabled_by_default_for_coding_agents: true,
      auto_capture: true,
      propose_snapshot: "$AEP_DATA/intents/<INT-...>/git-refs-propose.json",
      solidify_field: "git_refs { commit, branch, describe, dirty, since_propose }",
      disable_env: "AEP_GIT_INTEGRATION=0",
      not_git_replacement: true,
    },
    agent_env: {
      AEP_SEMANTIC_STRICT: "1",
      AEP_REPO_ROOT: "<project-repo-root>",
      AEP_DATA: "~/.aep",
    },
    workflow_cli: CODING_GOVERNANCE_WORKFLOW,
    policy_overrides_template: {
      enabled: true,
      require_propose: true,
      git_integration: true,
      auto_git_refs: true,
      semantic_strict: true,
      subprotocol: "coding-governance",
    },
    cca_guidance: {
      always_enable_for: [
        "coding agents (Claude Code, Cursor, Codex via AEP)",
        "CAW containerized agent workflows",
        "multi-agent swarms with pre-change intent",
      ],
      enable_components: ["gap", "coding-governance", "intent-ledger", "semantic-topology"],
      set_policy_overrides_key: "coding_governance",
    },
  };
}

export function formatCodingGovernanceForPrompt(cg) {
  const lines = [
    "",
    "Coding governance (nool-style control plane, git-compatible):",
    `Subprotocol: ${cg.subprotocol}`,
    "",
    "nool parity (shipped in AEP 2.8 Phase 11):",
  ];
  for (const [k, v] of Object.entries(cg.nool_parity)) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push(
    "",
    "Git integration (NOT git replacement - same as nool.dev):",
    "- Git commits, branches, remotes, PRs, CI stay intact.",
    `- Propose captures HEAD → ${cg.git_integration.propose_snapshot}`,
    `- Solidify auto-records git_refs.commit/branch/dirty and since_propose diff.`,
    `- Disable auto-capture: ${cg.git_integration.disable_env}`,
    "",
    "Required agent environment when coding-governance enabled:",
  );
  for (const [k, v] of Object.entries(cg.agent_env)) {
    lines.push(`- ${k}=${v}`);
  }
  lines.push(
    "",
    "Mandatory workflow for CCA-built coding agents:",
  );
  for (const step of cg.workflow_cli) {
    lines.push(`  ${step}`);
  }
  lines.push(
    "",
    "CCA plan policy_overrides.coding_governance MUST include:",
    JSON.stringify(cg.policy_overrides_template, null, 2),
  );
  return lines.join("\n");
}