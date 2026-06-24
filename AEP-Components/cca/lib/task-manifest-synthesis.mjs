#!/usr/bin/env node

import { synthesizeTaskManifestFromGap } from "../../gap/lib/gap-compile.mjs";
import { saveTaskManifest } from "../../coding-governance/lib/task-manifest.mjs";

/**
 * Emit GAP-synthesized task manifests for agents enabled in an ImplementationPlan.
 * @param {object} plan
 * @param {string} dataDir
 * @param {string} [repoRoot]
 */
export function synthesizeTaskManifestsFromPlan(plan, dataDir, repoRoot) {
  const caw = plan.policy_overrides?.caw_framework ?? plan.agent_runtime?.caw;
  const agentId = plan.agent_runtime?.agent_id ?? "cca-primary-agent";
  const manifest = synthesizeTaskManifestFromGap(
    {
      agent_id: agentId,
      session_id: plan.agent_runtime?.session_id,
      intent_summary: plan.user_intent,
      allowed_operations: buildAllowedOperations(plan),
      caw_profile: caw?.mount_profile ?? "agent-sandbox",
      gap_address: caw?.gap_address ?? "dev.aep.caw/agent-sandbox.v1",
      trust_score: 700,
      coding_governance: plan.policy_overrides?.coding_governance
        ? { require_propose: plan.policy_overrides.coding_governance.require_propose }
        : undefined,
    },
    repoRoot,
  );
  manifest.synthesized_by = "cca_plan";
  const path = saveTaskManifest(manifest, dataDir);
  return { manifest, path };
}

function buildAllowedOperations(plan) {
  const ops = new Set(["lattice:cross"]);
  if (plan.policy_overrides?.coding_governance?.require_propose) {
    ops.add("coding:propose");
    ops.add("coding:announce");
  }
  if (plan.policy_overrides?.caw_framework?.mount_profile) {
    ops.add(`caw:profile:${plan.policy_overrides.caw_framework.mount_profile}`);
  }
  for (const id of plan.components?.filter((c) => c.enabled).map((c) => c.id) ?? []) {
    ops.add(`component:${id}`);
  }
  return [...ops].sort();
}