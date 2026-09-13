#!/usr/bin/env node

import { synthesizeTaskManifestFromGap } from "../../gap/lib/gap-compile.mjs";
import { saveTaskManifest } from "../../coding-governance/lib/task-manifest.mjs";
import { stripTrustFields, isTrustFieldName } from "./strip-trust-fields.mjs";

/**
 * Emit GAP-synthesized task manifests for agents enabled in an ImplementationPlan.
 * Trust fields are absent. UCB refuses trust scores on the wire.
 * @param {object} plan
 * @param {string} dataDir
 * @param {string} [repoRoot]
 */
export function synthesizeTaskManifestsFromPlan(plan, dataDir, repoRoot) {
  const caw = plan.policy_overrides?.caw_framework ?? plan.agent_runtime?.caw;
  const agentId = plan.agent_runtime?.agent_id ?? "cca-primary-agent";
  const raw = synthesizeTaskManifestFromGap(
    {
      agent_id: agentId,
      session_id: plan.agent_runtime?.session_id,
      intent_summary: plan.user_intent,
      allowed_operations: buildAllowedOperations(plan),
      caw_profile: caw?.mount_profile ?? "agent-sandbox",
      gap_address: caw?.gap_address ?? "dev.aep.caw/agent-sandbox.v1",
      coding_governance: plan.policy_overrides?.coding_governance
        ? { require_propose: plan.policy_overrides.coding_governance.require_propose }
        : undefined,
    },
    repoRoot,
  );
  const manifest = stripTrustFields(raw);
  assertTrustFieldsAbsent(manifest, "synthesized task manifest");
  manifest.synthesized_by = "cca_plan";
  const path = saveTaskManifest(manifest, dataDir);
  return { manifest, path };
}

function assertTrustFieldsAbsent(value, label) {
  if (value == null || typeof value !== "object") return;
  const stack = [value];
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    for (const [key, nested] of Object.entries(cur)) {
      if (isTrustFieldName(key)) {
        throw new Error(`${label} refuses trust fields`);
      }
      if (nested && typeof nested === "object") stack.push(nested);
    }
  }
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
