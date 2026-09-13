#!/usr/bin/env node
/**
 * Validate CCA GAP policies against the NLA gapc engine (schema + grammar).
 * No external LLM APIs. Policies live under AEP-Composer-Lite/policies/reference/.
 * Requires NLA_GAP_ENGINE_URL. Refuses when that variable is unset.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadCcaGapPolicies,
  validateCcaGapPolicies,
  gapEngineHealth,
} from "../lib/hyperlattice/gap-constrained-engine.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const health = await gapEngineHealth();
if (health && (health.skipped || health.configured === false)) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "NLA_GAP_ENGINE_URL is unset",
        reason: (health && health.reason) || "remote GAP engine is not called",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
const policies = loadCcaGapPolicies(repoRoot);
const validation = await validateCcaGapPolicies(repoRoot);

console.log(
  JSON.stringify(
    {
      engine: health,
      policy_count: policies.length,
      policies: policies.map((p) => ({ file: p.file, address: p.address, path: p.path })),
      validation,
    },
    null,
    2,
  ),
);

if (validation.ok === false) process.exit(1);
