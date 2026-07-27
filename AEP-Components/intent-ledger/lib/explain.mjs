#!/usr/bin/env node

import { explainIntent, verifyChain } from "./ledger.mjs";
import { buildLatticeBlastOverlay } from "../../semantic-topology/lib/lattice-overlay.mjs";
import { buildPolicyLatticeView } from "../../../AEP-Composer-Lite/lib/policy-lattice.mjs";
import {
  resolveEvidenceLedgerDir,
  summarizeEvidenceSession,
} from "./evidence-link.mjs";
import { historyIntentKnots, searchIntentKnots } from "./intent-knots.mjs";

/**
 * Rich intent explanation: ledger chain + hyperlattice blast overlay + policy lattice summary.
 * @param {string} dataDir
 * @param {string} intentId
 * @param {{ activeLrps?: string[] }} [opts]
 */
export function explainIntentRich(dataDir, intentId, opts = {}) {
  const base = explainIntent(dataDir, intentId);
  const activeLrps = opts.activeLrps ?? [];

  let lattice_overlay = null;
  let overlay_error = null;
  try {
    lattice_overlay = buildLatticeBlastOverlay({
      intentId,
      dataDir,
      activeLrps,
    });
  } catch (err) {
    overlay_error = err instanceof Error ? err.message : String(err);
  }

  const policyView = buildPolicyLatticeView(activeLrps);
  const chainVerify = verifyChain(dataDir);

  const evidenceRefs = (base.solidify_chain ?? [])
    .map((e) => e.evidence_ledger_ref)
    .filter(Boolean);
  const ledgerDir = resolveEvidenceLedgerDir(dataDir, opts.ledgerDir);
  const evidence_sessions = evidenceRefs.map((ref) =>
    summarizeEvidenceSession(ref.ledger_dir ?? ledgerDir, ref.session_id),
  );

  const intent_knots = {
    history: historyIntentKnots(intentId, { dataDir, latticeDb: opts.latticeDb }),
    nearest: searchIntentKnots(intentId, { dataDir, latticeDb: opts.latticeDb, limit: 5 }),
  };

  const git = {
    at_propose: base.git_refs_propose ?? null,
    at_solidify: (base.solidify_chain ?? [])
      .map((e) => e.git_refs)
      .filter(Boolean),
  };

  return {
    ...base,
    git,
    topology: "hyperlattice",
    provenance: {
      chain_valid: chainVerify.valid,
      chain_length: chainVerify.length ?? 0,
      chain_broken_at: chainVerify.broken_at ?? null,
    },
    evidence_sessions,
    intent_knots,
    lattice_overlay,
    overlay_error,
    policy_lattice_summary: {
      hierarchy: (policyView.hierarchy ?? []).map((h) => ({
        id: h.id,
        label: h.label,
        level: h.level,
      })),
      active_lrp_ids: (policyView.active_lrps ?? []).map((l) => l.id),
      policy_bindings: lattice_overlay?.policy_bindings ?? [],
      channel_bindings: (policyView.channel_bindings ?? []).length,
    },
    composer: {
      graph_ref: "composer-lite-graph.json",
      blast_overlay_url: `/api/graph/blast-overlay?intent_id=${encodeURIComponent(intentId)}`,
      highlighted_node_count: lattice_overlay?.highlighted_node_ids?.length ?? 0,
    },
  };
}