#!/usr/bin/env node
/**
 * EPSCOM detection signature registry (Base Node kernel adjunct).
 * Loads trust-bundle manifest and YAML signature files from AEP-Base-Node/signatures/.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
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
 * @param {string} root
 */
export function loadTrustBundle(root = DEFAULT_SIGNATURES_ROOT) {
  const path = join(root, "trust-bundle/manifest.json");
  if (!existsSync(path)) {
    return { ok: false, error: "trust_bundle_missing", path };
  }
  const bundle = JSON.parse(readFileSync(path, "utf8"));
  return { ok: true, path, bundle };
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
  const trust = loadTrustBundle(root);
  if (!trust.ok) {
    if (strict) return [];
    return _loadAllYamlFiles(root);
  }

  const entries = trust.bundle.entries ?? [];
  const loaded = [];
  for (const entry of entries) {
    if (entry.enabled === false) continue;
    const rel = String(entry.file ?? "").replace(/^\//, "");
    const path = join(root, rel);
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