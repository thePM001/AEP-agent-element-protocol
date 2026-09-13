#!/usr/bin/env node
/**
 * UCB refuses trust fields. Strip them from register wire and task manifests.
 */

export const TRUST_FIELD_NAMES = [
  "trust",
  "trust_score",
  "trust_tier",
  "trust_ring",
  "max_trust_score",
];

export function isTrustFieldName(name) {
  return TRUST_FIELD_NAMES.includes(String(name));
}

export function stripTrustFields(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripTrustFields);
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isTrustFieldName(key)) continue;
    out[key] = stripTrustFields(nested);
  }
  return out;
}
