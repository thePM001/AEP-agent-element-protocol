#!/usr/bin/env node

import { explainIntent, verifyChain } from "./ledger.mjs";
import { buildPolicyLatticeView } from "../../hyperlattice/lib/policy-lattice.mjs";
import {
  resolveEvidenceLedgerDir,
  summarizeEvidenceSession,
} from "./evidence-link.mjs";
import { historyIntentKnots, searchIntentKnots } from "./intent-knots.mjs";

/**
 * Rich intent explanation: ledger chain + evidence sessions + intent knots + policy lattice summary.
 * @param {string} dataDir
 * @param {string} intentId
 * @param {{ activeLrps?: string[] }} [opts]
 */
export function explainIntentRich(dataDir, intentId, opts = {}) {
  const base = explainIntent(dataDir, intentId);
  const activeLrps = opts.activeLrps ?? [];

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
    policy_lattice_summary: {
      hierarchy: (policyView.hierarchy ?? []).map((h) => ({
        id: h.id,
        label: h.label,
        level: h.level,
      })),
      active_lrp_ids: (policyView.active_lrps ?? []).map((l) => l.id),
      channel_bindings: (policyView.channel_bindings ?? []).length,
    },
  };
}