#!/usr/bin/env node

import { loadSignaturesRegistry, resolveSignaturesRoot } from "./signatures-registry.mjs";

/**
 * EPSCOM signatures knowledge bundle for CCA.
 * @param {string} [repoRoot]
 * @param {object} [env]
 */
export function loadSignaturesContext(repoRoot, env = process.env) {
  const root = resolveSignaturesRoot(repoRoot, env);
  const registry = loadSignaturesRegistry(root);
  return {
    root,
    authority: "EPSCOM",
    enabled_by_default: true,
    trust_bundle: registry.trust_bundle?.bundle_version ?? null,
    signature_count: registry.total_count,
    enabled_count: registry.enabled_count,
    categories: registry.categories,
    signatures: registry.signatures.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      severity: s.severity,
      action: s.response?.action,
    })),
    principles: [
      "EPSCOM-authored detection signatures ship with Base Node (not optional slop).",
      "Trust bundle manifest indexes all signature files; subscribers verify before load.",
      "Writing, injection, lattice-bypass, and exfiltration categories align with EPSCOM kernel.",
      "Scanners and validation dock consume signatures from AEP-Base-Node/signatures/.",
    ],
  };
}

/**
 * @param {object} ctx - from loadSignaturesContext
 */
export function formatSignaturesForPrompt(ctx) {
  if (!ctx) return "";
  const lines = [
    "",
    "EPSCOM Detection Signatures (AEP-Base-Node/signatures/, default wired):",
    `Authority: ${ctx.authority} | root: ${ctx.root}`,
    `Loaded: ${ctx.enabled_count}/${ctx.signature_count} | categories: ${ctx.categories.join(", ")}`,
    "Signatures:",
  ];
  for (const s of ctx.signatures ?? []) {
    lines.push(`- ${s.id} [${s.severity}/${s.category}] ${s.name} → ${s.action ?? "warn"}`);
  }
  for (const p of ctx.principles ?? []) {
    lines.push(`  * ${p}`);
  }
  return lines.join("\n");
}