/**
 * Run of the shared egress vector file against egress-address.mjs. The Rust crate runs the
 * same file in its unit tests. Returns one line per wrong row, so an empty list is a pass.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADDRESS_CLASSES, EgressDeny, checkUrl, classifyAddress, policyAllows } from "./egress-address.mjs";

export const VECTOR_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "vectors", "egress-address-vectors.json");

export function loadEgressVectors(path = VECTOR_FILE) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function policyOf(vectors, name) {
  const p = vectors.policies[name];
  return { allowLoopback: p.allow_loopback === true, allowPrivate: p.allow_private === true };
}

export function runEgressVectors(vectors = loadEgressVectors()) {
  const wrong = [];
  const listed = [...vectors.classes].sort().join(",");
  if (listed !== [...ADDRESS_CLASSES].sort().join(",")) wrong.push(`classes: file ${listed}`);
  for (const row of vectors.addresses) {
    const cls = classifyAddress(row.ip);
    if (cls !== row.class) wrong.push(`${row.ip}: class ${cls}`);
    for (const [name, want] of Object.entries(row.allowed)) {
      const got = cls !== null && policyAllows(policyOf(vectors, name), cls);
      if (got !== want) wrong.push(`${row.ip}: policy ${name} gave ${got}`);
    }
  }
  const policy = policyOf(vectors, "default");
  for (const row of vectors.urls) {
    try {
      const target = checkUrl(row.url, policy);
      if (row.verdict !== "allow") wrong.push(`${row.url}: allowed`);
      else if (target.literal === null) wrong.push(`${row.url}: allowed without a literal address`);
    } catch (err) {
      if (!(err instanceof EgressDeny)) throw err;
      if (row.verdict === "allow") wrong.push(`${row.url}: refused by ${err.message}`);
      else if (row.class !== undefined && err.addressClass !== row.class) wrong.push(`${row.url}: closed by ${err.message}`);
    }
  }
  return wrong;
}
