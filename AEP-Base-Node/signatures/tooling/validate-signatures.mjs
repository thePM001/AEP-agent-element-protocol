#!/usr/bin/env node
/** Validate EPSCOM trust bundle + signature files. */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSignaturesRegistry, loadTrustBundle } from "../lib/signatures-registry.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let errors = 0;

try {
  const reg = loadSignaturesRegistry(root);
  const trust = loadTrustBundle(root);

  if (!trust.ok) {
    console.error("FAIL: trust bundle missing");
    errors++;
  }

  const required = ["id", "authority", "severity", "category"];
  for (const sig of reg.signatures) {
    for (const field of required) {
      if (!sig[field]) {
        console.error(`FAIL: ${sig.file} missing ${field}`);
        errors++;
      }
    }
    if (sig.authority !== "EPSCOM") {
      console.error(`FAIL: ${sig.id} authority must be EPSCOM`);
      errors++;
    }
    if (!sig.detection?.patterns?.length) {
      console.error(`FAIL: ${sig.id} has no detection patterns`);
      errors++;
    }
  }

  if (trust.ok) {
    const listed = new Set((trust.bundle.entries ?? []).filter((e) => e.enabled !== false).map((e) => e.file));
    const onDisk = readdirSync(join(root, "signatures")).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of onDisk) {
      const rel = `signatures/${file}`;
      if (!listed.has(rel)) {
        console.error(`FAIL: orphan signature not in trust bundle: ${rel}`);
        errors++;
      }
    }
    for (const entry of trust.bundle.entries ?? []) {
      if (entry.enabled === false) continue;
      const path = join(root, entry.file);
      if (!existsSync(path)) {
        console.error(`FAIL: trust bundle references missing file: ${entry.file}`);
        errors++;
        continue;
      }
      const sha = createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");
      if (entry.sha256 && entry.sha256 !== "pending-local-verify" && entry.sha256 !== sha) {
        console.error(`FAIL: sha256 mismatch ${entry.id}`);
        errors++;
      }
    }
  }

  if (errors === 0) {
    console.log(`OK: ${reg.enabled_count} EPSCOM signatures validated at ${root}`);
    process.exit(0);
  }
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
}
process.exit(1);