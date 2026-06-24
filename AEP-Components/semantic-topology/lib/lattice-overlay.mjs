#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { explainIntent } from "../../intent-ledger/lib/ledger.mjs";
import { loadGraph } from "../../../AEP-Composer-Lite/lib/graph-store.mjs";
import { buildPolicyLatticeView } from "../../../AEP-Composer-Lite/lib/policy-lattice.mjs";
import { invokeCodingGovernanceRust } from "../../../AEP-SDKs/typescript/aep-protocol/lib/subprotocol-rust.mjs";
import { resolveRepoRoot } from "../../coding-governance/lib/paths.mjs";

function catalogComponentIds(repoRoot) {
  const catalogPath = join(repoRoot, "AEP-Base-Node/registry/catalog.json");
  if (!existsSync(catalogPath)) return new Set();
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  return new Set((catalog.components ?? []).map((c) => c.id).filter(Boolean));
}

function nodeCatalogId(node) {
  return node?.data?.catalog_id ?? node?.data?.component_id ?? null;
}

function resolvePolicyBindings(componentIds, neighborIds, activeLrps) {
  const componentSet = new Set(componentIds);
  const neighborSet = new Set(neighborIds);
  const policyView = buildPolicyLatticeView(activeLrps);
  const bindings = [];
  const seen = new Set();

  const push = (lrpId, reason, extra = {}) => {
    const key = `${lrpId}:${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    const meta = policyView.active_lrps?.find((l) => l.id === lrpId);
    bindings.push({
      lrp_id: lrpId,
      name: meta?.name ?? lrpId,
      docking_port: meta?.docking_port ?? null,
      gap_ref: meta?.gap_ref ?? null,
      reason,
      ...extra,
    });
  };

  for (const lrp of policyView.active_lrps ?? []) {
    if (componentSet.has(lrp.id)) {
      push(lrp.id, "component_in_blast");
    }
  }

  const governanceTouch =
    componentSet.has("gap") ||
    componentSet.has("coding-governance") ||
    neighborSet.has("gap") ||
    neighborSet.has("coding-governance");

  if (governanceTouch) {
    for (const lrp of policyView.active_lrps ?? []) {
      if (lrp.gap_ref) push(lrp.id, "gap_stack");
    }
  }

  if (componentSet.has("coding-governance") || componentSet.has("cca")) {
    const epscom = policyView.active_lrps?.find((l) => l.mandatory || l.category === "epscom");
    if (epscom) push(epscom.id, "epscom_governance");
  }

  for (const lrp of policyView.active_lrps ?? []) {
    if (neighborSet.has(lrp.id)) {
      push(lrp.id, "registry_neighbor");
    }
  }

  bindings.sort((a, b) => a.lrp_id.localeCompare(b.lrp_id));
  return bindings;
}

/**
 * Project blast radius onto the existing Composer hyperlattice canvas.
 * @param {object} opts
 * @param {string} opts.intentId
 * @param {string} opts.dataDir - AEP_DATA (composer graph + intent snapshots)
 * @param {string[]} [opts.activeLrps]
 */
export function buildLatticeBlastOverlay({
  intentId,
  dataDir,
  activeLrps = [],
}) {
  const intent = explainIntent(dataDir, intentId);
  const blast = intent.blast_radius;
  const componentIds = [...new Set(blast?.impact?.components ?? [])];

  const graph = loadGraph(dataDir);
  const highlighted = graph.nodes
    .filter((n) => {
      const cid = nodeCatalogId(n);
      return cid && componentIds.includes(cid);
    })
    .map((n) => n.id);

  const repoRoot = resolveRepoRoot();
  const neighbors = [];
  for (const cid of componentIds) {
    const q = invokeCodingGovernanceRust("semantic_query", {
      component_id: cid,
      repo_root: repoRoot,
    });
    if (q.valid && q.detail?.neighbors) {
      for (const n of q.detail.neighbors) {
        neighbors.push(n);
      }
    }
  }
  const dedupedNeighbors = dedupeNeighbors(neighbors);
  const neighborIds = dedupedNeighbors.map((n) => n.id);
  const policyBindings = resolvePolicyBindings(componentIds, neighborIds, activeLrps);

  return {
    overlay_version: "1",
    intent_id: intentId,
    statement: intent.declaration?.statement ?? null,
    component_ids: componentIds,
    highlighted_node_ids: highlighted,
    registry_neighbors: dedupedNeighbors,
    policy_bindings: policyBindings,
    policy_lrps: policyBindings.map((b) => b.lrp_id),
    within_envelope: blast?.within_envelope ?? null,
    computed_at: new Date().toISOString(),
    graph_ref: "composer-lite-graph.json",
    topology: "hyperlattice",
  };
}

function dedupeNeighbors(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.id}:${row.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}