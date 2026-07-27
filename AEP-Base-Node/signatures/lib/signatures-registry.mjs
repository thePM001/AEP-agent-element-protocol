#!/usr/bin/env node
/**
 * EPSCOM detection signature registry (Base Node kernel adjunct).
 * Loads trust-bundle manifest and YAML signature files from AEP-Base-Node/signatures/.
 */

import { createHash, createHmac } from "node:crypto";

/** Fail-closed path: join root+rel must stay under root (no .. escape). */
function safeUnderRoot(root, rel) {
  const cleaned = String(rel ?? "").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) return null;
  if (cleaned.split(/[/\\]/).some((p) => p === "..")) return null;
  const resolvedRoot = resolve(root);
  const fpath = resolve(root, cleaned);
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  if (fpath !== resolvedRoot && !fpath.startsWith(rootPrefix)) return null;
  return fpath;
}

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SIGNATURES_ROOT = join(__dirname, "..");

/**
 * @param {string} [repoRoot]
 */
export function resolveSignaturesRoot(repoRoot, env = process.env) {
  if (env.AEP_EPSCOM_SIGNATURES_PATH) {
    return String(env.AEP_EPSCOM_SIGNATURES_PATH).replace(/\/$/, "");
  }
  if (repoRoot) {
    const candidate = join(repoRoot, "AEP-Base-Node/signatures");
    if (existsSync(candidate)) return candidate;
  }
  return DEFAULT_SIGNATURES_ROOT;
}

/**
 * Load trust bundle and crypto-verify entry digests + optional HMAC signature.
 * HIGH: bundle is not trusted from JSON parse alone.
 * @param {string} root
 * @param {{ strict?: boolean }} [opts]
 */
export function loadTrustBundle(root = DEFAULT_SIGNATURES_ROOT, opts = {}) {
  const strict = opts.strict !== false;
  const path = join(root, "trust-bundle/manifest.json");
  if (!existsSync(path)) {
    return { ok: false, error: "trust_bundle_missing", path };
  }
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, error: "trust_bundle_invalid_json", path, detail: String(e) };
  }
  const entries = Array.isArray(bundle.entries) ? bundle.entries : [];
  if (strict && entries.length === 0) {
    return { ok: false, error: "trust_bundle_empty", path };
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: "trust_bundle_entry_invalid", path };
    }
    const sha = entry.sha256;
    if (!sha || typeof sha !== "string") {
      return { ok: false, error: `trust_bundle_entry_missing_sha256:${entry.id ?? "?"}`, path };
    }
    if (sha === "pending-local-verify") {
      if (strict) {
        return { ok: false, error: `trust_bundle_pending_verify:${entry.id ?? "?"}`, path };
      }
      continue;
    }
    if (!/^[0-9a-f]{64}$/i.test(sha)) {
      return { ok: false, error: `trust_bundle_entry_bad_sha256:${entry.id ?? "?"}`, path };
    }
    const rel = String(entry.file ?? "").replace(/^\//, "");
    if (rel) {
      const fpath = safeUnderRoot(root, rel);
      if (!fpath) {
        return { ok: false, error: `trust_bundle_entry_path_escape:${entry.id ?? rel}`, path };
      }
      if (existsSync(fpath)) {
        const got = createHash("sha256").update(readFileSync(fpath)).digest("hex");
        if (got.toLowerCase() !== sha.toLowerCase()) {
          return {
            ok: false,
            error: `trust_bundle_sha256_mismatch:${entry.id ?? rel}`,
            path,
            expected: sha,
            got,
          };
        }
      } else if (strict) {
        return { ok: false, error: `trust_bundle_file_missing:${rel}`, path };
      }
    }
  }
  const hmacKey = process.env.AEP_TRUST_BUNDLE_HMAC_KEY;
  let crypto_verified = false;
  if (bundle.signature) {
    if (!hmacKey) {
      if (strict) {
        return { ok: false, error: "trust_bundle_signature_key_missing", path };
      }
    } else {
      const clone = { ...bundle };
      delete clone.signature;
      const expected = createHmac("sha256", hmacKey)
        .update(JSON.stringify(clone))
        .digest("hex");
      if (expected.toLowerCase() !== String(bundle.signature).toLowerCase()) {
        return { ok: false, error: "trust_bundle_signature_invalid", path };
      }
      crypto_verified = true;
    }
  } else if (strict && process.env.AEP_TRUST_BUNDLE_REQUIRE_HMAC === "1") {
    return { ok: false, error: "trust_bundle_signature_missing", path };
  }
  // Manifests that claim PQ/ML-DSA authenticity must not pass strict load without crypto verify.
  // Integrity-only modes (sha256-structure) may mention planned PQ without claiming live verify.
  const v = bundle.verification && typeof bundle.verification === "object" ? bundle.verification : {};
  const mode = String(v.mode || "").toLowerCase();
  const integrityOnly =
    mode === "sha256-structure" ||
    mode === "sha256" ||
    mode === "integrity" ||
    mode === "hash";
  const claimsPq =
    !integrityOnly &&
    Boolean(
      v.pq_signature ||
        /ml-dsa|pq/i.test(mode) ||
        /ml-dsa|pq/i.test(String(v.note || "")),
    );
  if (strict && claimsPq && !crypto_verified) {
    return {
      ok: false,
      error: "trust_bundle_pq_claim_unverified",
      path,
      detail: "manifest claims PQ signature but only SHA-256 integrity was checked",
    };
  }
  // integrity of entry hashes may pass without cryptographic authenticity
  return { ok: true, path, bundle, crypto_verified, integrity_checked: true };
}

/**
 * Minimal YAML parser for flat EPSCOM signature files.
 * @param {string} raw
 */
function unescapeYamlString(value) {
  return value
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function parseSimpleYaml(raw) {
  const out = {
    detection: { patterns: [] },
    metadata: {},
    response: {},
  };
  let section = null;
  let inPatterns = false;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (!line.startsWith(" ") && !line.startsWith("\t") && trimmed.endsWith(":") && !trimmed.includes(": ")) {
      section = trimmed.slice(0, -1);
      inPatterns = false;
      continue;
    }

    if (trimmed.startsWith("- ") && (inPatterns || section === "detection")) {
      const rawPattern = trimmed.slice(2).replace(/^["']|["']$/g, "");
      out.detection.patterns.push(unescapeYamlString(rawPattern));
      inPatterns = true;
      continue;
    }

    const idx = trimmed.indexOf(": ");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 2).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = unescapeYamlString(value.slice(1, -1));
    }

    if (section === "detection") {
      if (key === "patterns") {
        inPatterns = true;
        continue;
      }
      inPatterns = false;
      if (key === "case_insensitive") out.detection[key] = value === "true";
      else out.detection[key] = value;
    } else if (section === "metadata") {
      out.metadata[key] = value;
    } else if (section === "response") {
      out.response[key] = value;
    } else {
      if (key === "enabled") out[key] = value === "true";
      else out[key] = value;
    }
  }
  return out;
}

/**
 * Load only trust-bundle-listed signature files; verify SHA-256.
 * @param {string} root
 * @param {{ strict?: boolean }} [opts]
 */
export function loadSignatureFiles(root = DEFAULT_SIGNATURES_ROOT, opts = {}) {
  const strict = opts.strict !== false;
  const trust = loadTrustBundle(root, { strict });
  if (!trust.ok) {
    // Always fail closed: never load unbundled YAML as detection authority
    throw new Error(`trust bundle crypto verify failed: ${trust.error ?? "unknown"}`);
  }

  const entries = trust.bundle.entries ?? [];
  const loaded = [];
  for (const entry of entries) {
    if (entry.enabled === false) continue;
    const rel = String(entry.file ?? "").replace(/^\//, "");
    const path = safeUnderRoot(root, rel);
    if (!path) {
      if (strict) throw new Error(`trust bundle entry path escape: ${rel}`);
      continue;
    }
    if (!existsSync(path)) {
      if (strict) throw new Error(`trust bundle entry missing: ${rel}`);
      continue;
    }
    const raw = readFileSync(path, "utf8");
    const sha256 = createHash("sha256").update(raw).digest("hex");
    if (entry.sha256 === "pending-local-verify" && strict) {
      throw new Error(`trust bundle entry ${entry.id} has pending-local-verify hash in strict mode`);
    }
    if (entry.sha256 && entry.sha256 !== "pending-local-verify" && entry.sha256 !== sha256) {
      throw new Error(`sha256 mismatch for ${entry.id}: expected ${entry.sha256}, got ${sha256}`);
    }
    const parsed = parseSimpleYaml(raw);
    loaded.push({ file: rel, path, sha256, bundle_id: entry.id, ...parsed });
  }
  return loaded;
}

function _loadAllYamlFiles(root) {
  const sigDir = join(root, "signatures");
  if (!existsSync(sigDir)) return [];
  return readdirSync(sigDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((file) => {
      const path = join(sigDir, file);
      const raw = readFileSync(path, "utf8");
      return { file, path, sha256: createHash("sha256").update(raw).digest("hex"), ...parseSimpleYaml(raw) };
    });
}

/**
 * @param {string} root
 */
export function loadSignaturesRegistry(root = DEFAULT_SIGNATURES_ROOT) {
  const trust = loadTrustBundle(root);
  const signatures = loadSignatureFiles(root);
  const enabled = signatures.filter((s) => s.enabled !== false);
  return {
    authority: "EPSCOM",
    root,
    trust_bundle: trust.ok ? trust.bundle : null,
    signatures,
    enabled_count: enabled.length,
    total_count: signatures.length,
    categories: [...new Set(enabled.map((s) => s.category).filter(Boolean))],
  };
}

/**
 * Scan text against loaded EPSCOM detection signatures.
 * @param {string} text
 * @param {string} [root]
 */
export function scanWithSignatures(text, root = DEFAULT_SIGNATURES_ROOT) {
  const signatures = loadSignatureFiles(root).filter((s) => s.enabled !== false);
  const hits = [];
  for (const sig of signatures) {
    const patterns = sig.detection?.patterns ?? [];
    const flags = sig.detection?.case_insensitive === false ? "" : "i";
    for (const pattern of patterns) {
      try {
        const re = new RegExp(pattern, flags);
        if (re.test(text)) {
          hits.push({
            id: sig.id,
            category: sig.category,
            severity: sig.severity,
            action: sig.response?.action ?? "warn",
          });
          break;
        }
      } catch (err) {
        if (process.env.AEP_EPSCOM_SIGNATURES_STRICT !== "0") {
          throw new Error(`invalid regex in ${sig.id ?? sig.file}: ${pattern} (${err})`);
        }
      }
    }
  }
  return { ok: hits.length === 0, hits, scanned: signatures.length };
}