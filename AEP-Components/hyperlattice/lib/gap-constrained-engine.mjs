#!/usr/bin/env node

/**
 * CCA GAP policies for Composer Lite hyperlattice.
 * No external LLM. Optional remote schema validate uses NLA_GAP_ENGINE_URL only when set.
 * When that variable is unset, health and validate skip the network and do not invent a URL.
 * Public UCB compile is local gap-manifest-v1 and is not this path.
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGapFile } from "../../../AEP-Components/gap/lib/gap-compile.mjs";
import {
  COMPOSER_CCA_GAP_POLICIES_DIR,
} from "./paths.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPOSER_ROOT = join(__dirname, "../..");

export const CCA_GAP_POLICY_FILES = [
  "cca-writing-chat.gap",
  "cca-composer-protocol.gap",
  "cca-hyperlattice.gap",
];

export const GAP_ENGINE_UNSET_REASON =
  "NLA_GAP_ENGINE_URL is unset; remote GAP engine is not called";

function trimEngineUrl(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\/$/, "");
}

function envValue(env, key) {
  if (env && typeof env === "object") return env[key];
  return undefined;
}

export function resolveGapEngineUrl(env = process.env) {
  const nla = trimEngineUrl(envValue(env, "NLA_GAP_ENGINE_URL"));
  if (nla) return nla;
  return null;
}

export function gapEngineConfigured(env = process.env) {
  return resolveGapEngineUrl(env) !== null;
}

function skippedEngineResult(extra = {}) {
  return {
    ok: false,
    configured: false,
    skipped: true,
    reason: GAP_ENGINE_UNSET_REASON,
    ...extra,
  };
}

export function loadCcaGapPolicies(repoRoot, env = process.env) {
  const root = repoRoot ?? join(COMPOSER_ROOT, "..");
  const refDir = join(root, COMPOSER_CCA_GAP_POLICIES_DIR);
  const engine = resolveGapEngineUrl(env);
  const policies = [];
  for (const file of CCA_GAP_POLICY_FILES) {
    const path = join(refDir, file);
    if (existsSync(path) === false) continue;
    const parsed = parseGapFile(path);
    const instruction = parsed.instruction;
    const address = instruction && instruction.address ? instruction.address : null;
    policies.push({
      file,
      path: `${COMPOSER_CCA_GAP_POLICIES_DIR}/${file}`,
      address,
      instruction,
      runtime: parsed.runtime,
      synthesized_by: engine ? "gapc_validated" : "local_gap_parse",
      engine,
    });
  }
  return policies;
}

export async function gapEngineHealth(env = process.env) {
  const base = resolveGapEngineUrl(env);
  if (base === null) return skippedEngineResult();
  const res = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
  if (res.ok === false) throw new Error(`GAP engine health failed (${res.status})`);
  const body = await res.json();
  return { ...body, configured: true, skipped: false, engine: base };
}

export async function validateGapDocument(document, env = process.env) {
  const base = resolveGapEngineUrl(env);
  if (base === null) return skippedEngineResult();
  const res = await fetch(`${base}/api/v1/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (res.ok === false) {
    throw new Error(body.error ?? `GAP validate failed (${res.status})`);
  }
  return body;
}

export async function validateCcaGapPolicies(repoRoot, env = process.env) {
  const policies = loadCcaGapPolicies(repoRoot, env);
  const base = resolveGapEngineUrl(env);
  if (base === null) {
    return {
      ok: false,
      configured: false,
      skipped: true,
      engine: null,
      reason: GAP_ENGINE_UNSET_REASON,
      policies: policies.map((p) => ({
        file: p.file,
        ok: false,
        skipped: true,
        error: GAP_ENGINE_UNSET_REASON,
      })),
    };
  }
  const results = [];
  for (const policy of policies) {
    if (policy.instruction) {
      try {
        const v = await validateGapDocument(policy.instruction, env);
        results.push({ file: policy.file, address: policy.address, ...v });
      } catch (err) {
        results.push({ file: policy.file, ok: false, error: err.message });
      }
    } else {
      results.push({ file: policy.file, ok: false, error: "missing instruction document" });
    }
  }
  return {
    ok: results.every((r) => r.ok !== false),
    configured: true,
    skipped: false,
    engine: base,
    policies: results,
  };
}

export function ccaWritingConstraintsFromGap(policies = []) {
  const writing = policies.find((p) => p.file === "cca-writing-chat.gap");
  if (
    writing
    && writing.instruction
    && writing.instruction.pattern
    && writing.instruction.pattern.constraints
  ) {
    return writing.instruction.pattern.constraints;
  }
  return [];
}

export function formatCcaGapPoliciesForPrompt(policies = []) {
  const lines = ["CCA GAP policies (NLA gapc engine, schema-validated, no external LLM):"];
  for (const p of policies) {
    const addr =
      p.address && p.address.domain && p.address.id
        ? `${p.address.domain}/${p.address.id}`
        : p.file;
    const constraints =
      p.instruction
      && p.instruction.pattern
      && p.instruction.pattern.constraints
        ? p.instruction.pattern.constraints
        : [];
    const content =
      p.instruction && p.instruction.action && p.instruction.action.content
        ? p.instruction.action.content
        : "";
    lines.push(`- ${addr}: ${content}`);
    if (constraints.length) lines.push(`  constraints: ${constraints.join(", ")}`);
  }
  return lines.join("\n");
}
