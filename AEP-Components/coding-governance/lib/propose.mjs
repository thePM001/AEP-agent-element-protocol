#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRepoRoot } from "./paths.mjs";
import { invokeCodingGovernanceRust } from "../../../AEP-SDKs/typescript/aep-protocol/lib/subprotocol-rust.mjs";
import { saveIntentSnapshot } from "../../intent-ledger/lib/ledger.mjs";
import { recordIntentKnot } from "../../intent-ledger/lib/intent-knots.mjs";
import { enrichProposeWithGit } from "./git-integration.mjs";
import { enrichProposeWithHcse } from "../../hcse/lib/hcse-integration.mjs";
import { expandHome, defaultPaths } from "../../wizard/lib/paths.mjs";

/**
 * Declare coding intent, run blast radius, persist snapshot, return propose result.
 * @param {object} opts
 * @param {string} opts.statement
 * @param {object} opts.envelope
 * @param {string[]} [opts.paths]
 * @param {string} [opts.dataDir]
 */
export function runPropose({
  statement,
  envelope,
  paths = [],
  dataDir = expandHome(defaultPaths().dataDir),
  skipGit = false,
  repoRoot,
}) {
  const payload = {
    statement,
    envelope,
    paths,
    repo_root: resolveRepoRoot(),
  };

  const result = invokeCodingGovernanceRust("propose", payload);
  if (!result.valid) {
    return result;
  }

  const detail = result.detail ?? {};
  const intentId = detail.intent_id;
  if (intentId) {
    saveIntentSnapshot(
      dataDir,
      intentId,
      { statement, envelope },
      detail.blast_radius ?? null,
    );
    mkdirSync(join(dataDir, "tokens"), { recursive: true });
    writeFileSync(
      join(dataDir, "tokens", "active-propose.json"),
      JSON.stringify(detail.propose_token ?? {}, null, 2),
    );

    const intentKnot = recordIntentKnot(
      "propose",
      {
        intentId,
        statement,
        blastRadius: detail.blast_radius ?? null,
        proposeToken: detail.propose_token ?? null,
      },
      { dataDir },
    );
    const gitCapture = enrichProposeWithGit(dataDir, intentId, { skipGit, repoRoot });
    const withHcse = enrichProposeWithHcse(
      { ...detail, intent_knot: intentKnot, git: gitCapture.git },
      { dataDir, paths, repoRoot },
    );
    result.detail = withHcse;
  }

  return result;
}