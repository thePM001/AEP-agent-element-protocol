#!/usr/bin/env node

import { invokeCodingGovernanceRust } from "../../../AEP-SDKs/typescript/aep-protocol/lib/subprotocol-rust.mjs";
import { appendSolidifyRecord } from "../../intent-ledger/lib/ledger.mjs";
import {
  buildEvidenceLedgerRef,
  resolveEvidenceLedgerDir,
} from "../../intent-ledger/lib/evidence-link.mjs";
import { recordIntentKnot } from "../../intent-ledger/lib/intent-knots.mjs";
import { enrichSolidifyRecordWithGit } from "./git-integration.mjs";
import { enrichSolidifyWithHcseArtifact } from "../../hcse/lib/hcse-integration.mjs";
import { expandHome, defaultPaths } from "../../wizard/lib/paths.mjs";

/**
 * @param {object} record - SolidifyRecord fields
 * @param {object} [opts]
 * @param {string} [opts.dataDir]
 * @param {string} [opts.sessionId] - gateway evidence-ledger session to cross-ref
 * @param {string} [opts.ledgerDir]
 */
export function runSolidify(record, opts = {}) {
  const resolved = typeof opts === "string" ? { dataDir: opts } : opts;
  const dataDir = expandHome(resolved.dataDir ?? defaultPaths().dataDir);
  const { record: enriched, git: gitCapture } = enrichSolidifyRecordWithGit(
    { ...record },
    {
      dataDir,
      skipGit: resolved.skipGit,
      repoRoot: resolved.repoRoot,
    },
  );
  const withHcse = enrichSolidifyWithHcseArtifact(enriched, {
    repoRoot: resolved.repoRoot,
  });
  const payload = { ...withHcse };

  if (resolved.sessionId && !payload.evidence_ledger_ref) {
    const ledgerDir = resolveEvidenceLedgerDir(dataDir, resolved.ledgerDir);
    payload.evidence_ledger_ref = buildEvidenceLedgerRef(ledgerDir, resolved.sessionId);
  }

  const validation = invokeCodingGovernanceRust("solidify", payload);
  if (!validation.valid) return { validation, entry: null, git: gitCapture };

  const entry = appendSolidifyRecord(dataDir, payload);
  const intentKnot = recordIntentKnot(
    "solidify",
    {
      intentId: payload.intent_id,
      solidifyEntry: entry,
      sessionId: resolved.sessionId ?? payload.evidence_ledger_ref?.session_id,
    },
    { dataDir },
  );
  return { validation, entry, intent_knot: intentKnot, git: gitCapture };
}