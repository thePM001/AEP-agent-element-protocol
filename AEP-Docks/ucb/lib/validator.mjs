/**
 * UCB coherence validation operator (middle layer).
 * Implements P_R, P_C, P_S, P_P predicates from Research Paper 005.
 */

import { bindingFingerprint } from "./translator.mjs";

const FORBIDDEN_PATTERNS = [
  /\bignore\s+all\s+previous\b/i,
  /\bsystem\s+prompt\s+override\b/i,
  /\bDROP\s+TABLE\b/i,
  /\brm\s+-rf\b/i,
];

export function validateProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") {
    return { ok: false, predicate: "P_P", error: "provenance object required" };
  }
  if (!provenance.source || !provenance.protocol || !provenance.session_id) {
    return {
      ok: false,
      predicate: "P_P",
      error: "provenance requires source, protocol, session_id",
    };
  }
  return { ok: true, predicate: "P_P" };
}

export function validateStructuralComplexity(payload) {
  const keys = Object.keys(payload ?? {});
  if (keys.length < 1) {
    return { ok: false, predicate: "P_S", error: "payload must contain at least one field" };
  }
  return { ok: true, predicate: "P_S", factor_count: keys.length };
}

export function validateNonContradiction(payload) {
  const text = JSON.stringify(payload ?? {});
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      return { ok: false, predicate: "P_C", error: "forbidden destructive pattern detected" };
    }
  }
  return { ok: true, predicate: "P_C" };
}

export function validateResonance(payload, context = {}) {
  const fingerprint = bindingFingerprint(payload);
  const prior = context.prior_fingerprints ?? [];
  if (prior.length === 0) {
    return { ok: true, predicate: "P_R", resonance: 1, fingerprint };
  }
  const matches = prior.filter((p) => p === fingerprint).length;
  const resonance = 1 - matches / prior.length;
  const threshold = Number(context.resonance_threshold ?? 0.05);
  if (resonance < threshold) {
    return {
      ok: false,
      predicate: "P_R",
      error: "resonance below threshold (duplicate foreign payload)",
      resonance,
      fingerprint,
    };
  }
  return { ok: true, predicate: "P_R", resonance, fingerprint };
}

export function validateForeignIngest(body, context = {}) {
  const provenance = body.provenance;
  const checks = [
    validateProvenance(provenance),
    validateStructuralComplexity(body.payload ?? body.content ?? body.data ?? {}),
    validateNonContradiction(body.payload ?? body.content ?? body.data ?? {}),
    validateResonance(body.payload ?? body.content ?? body.data ?? {}, context),
  ];
  const failed = checks.find((c) => !c.ok);
  if (failed) {
    return { ok: false, ...failed, checks };
  }
  return {
    ok: true,
    checks: checks.map((c) => ({ predicate: c.predicate, ok: true })),
    provenance,
  };
}