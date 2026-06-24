#!/usr/bin/env node

/**
 * CCA GAP policies for Composer Lite hyperlattice.
 * Validates via local NLA gapc engine (no external LLM).
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

export function resolveGapEngineUrl(env = process.env) {
  if (env.NLA_GAP_ENGINE_URL) return env.NLA_GAP_ENGINE_URL.replace(/\/$/, "");
  if (env.UCB_GAP_ENGINE_URL) return env.UCB_GAP_ENGINE_URL.replace(/\/$/, "");
  if (existsSync("/.dockerenv")) {
    const gateway = env.DOCKER_HOST_GATEWAY ?? "172.23.0.1";
    return `http://${gateway}:8407`;
  }
  return "http://127.0.0.1:8407";
}

export function loadCcaGapPolicies(repoRoot) {
  const root = repoRoot ?? join(COMPOSER_ROOT, "..");
  const refDir = join(root, COMPOSER_CCA_GAP_POLICIES_DIR);
  const policies = [];
  for (const file of CCA_GAP_POLICY_FILES) {
    const path = join(refDir, file);
    if (!existsSync(path)) continue;
    const parsed = parseGapFile(path);
    policies.push({
      file,
      path: `${COMPOSER_CCA_GAP_POLICIES_DIR}/${file}`,
      address: parsed.instruction?.address ?? null,
      instruction: parsed.instruction,
      runtime: parsed.runtime,
      synthesized_by: "gapc_validated",
      engine: resolveGapEngineUrl(),
    });
  }
  return policies;
}

export async function gapEngineHealth(env = process.env) {
  const base = resolveGapEngineUrl(env);
  const res = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`GAP engine health failed (${res.status})`);
  return res.json();
}

export async function validateGapDocument(document, env = process.env) {
  const base = resolveGapEngineUrl(env);
  const res = await fetch(`${base}/api/v1/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `GAP validate failed (${res.status})`);
  }
  return body;
}

export async function validateCcaGapPolicies(repoRoot, env = process.env) {
  const policies = loadCcaGapPolicies(repoRoot);
  const results = [];
  for (const policy of policies) {
    if (!policy.instruction) {
      results.push({ file: policy.file, ok: false, error: "missing instruction document" });
      continue;
    }
    try {
      const v = await validateGapDocument(policy.instruction, env);
      results.push({ file: policy.file, address: policy.address, ...v });
    } catch (err) {
      results.push({ file: policy.file, ok: false, error: err.message });
    }
  }
  return {
    ok: results.every((r) => r.ok !== false),
    engine: resolveGapEngineUrl(env),
    policies: results,
  };
}

export function ccaWritingConstraintsFromGap(policies = []) {
  const writing = policies.find((p) => p.file === "cca-writing-chat.gap");
  return writing?.instruction?.pattern?.constraints ?? [];
}

export function formatCcaGapPoliciesForPrompt(policies = []) {
  const lines = ["CCA GAP policies (NLA gapc engine, schema-validated, no external LLM):"];
  for (const p of policies) {
    const addr = p.address ? `${p.address.domain}/${p.address.id}` : p.file;
    const constraints = p.instruction?.pattern?.constraints ?? [];
    lines.push(`- ${addr}: ${p.instruction?.action?.content ?? ""}`);
    if (constraints.length) lines.push(`  constraints: ${constraints.join(", ")}`);
  }
  return lines.join("\n");
}