#!/usr/bin/env node
/**
 * Validate CCA GAP policies against the NLA gapc engine (schema + grammar).
 * No external LLM APIs. Policies live under AEP-Composer-Lite/policies/reference/.
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

if (!validation.ok) process.exit(1);