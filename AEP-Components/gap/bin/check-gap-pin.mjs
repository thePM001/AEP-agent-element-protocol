#!/usr/bin/env node
// GAP byte pin check. GAP-OPEN-SOURCE is the one source of the GAP profile crate, the
// GAP meta schemas and gap-versions.toml. AEP holds byte copies listed in
// AEP-Components/gap/gap-pin.txt with the GAP commit they came from.
//
//   node AEP-Components/gap/bin/check-gap-pin.mjs              byte check and version check
//   node AEP-Components/gap/bin/check-gap-pin.mjs --gap DIR    also compare with a GAP checkout
//   node AEP-Components/gap/bin/check-gap-pin.mjs --repin DIR  copy from a GAP checkout and rewrite the pin
//
// Hashes are sha256 written in lowercase RFC 4648 base32 without padding.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const AEP_ROOT = resolve(here, "../../..");
export const PIN_PATH = "AEP-Components/gap/gap-pin.txt";
const CRATE_SRC = "AEP-Components/gap-schema-profile-v13/crate/src";
const CRATE_MANIFEST = "AEP-Components/gap-schema-profile-v13/crate/Cargo.toml";
const VERSIONS = "AEP-Components/gap/gap-versions.toml";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function base32(bytes) {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function digest(bytes) {
  return base32(createHash("sha256").update(bytes).digest());
}

/// Commit id at HEAD of a git checkout, read from .git without running git.
export function gitHead(dir) {
  const gitDir = join(dir, ".git");
  const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
  if (/^[0-9a-f]{40}$/.test(head)) return head;
  const m = /^ref: (refs\/\S+)$/.exec(head);
  if (!m) throw new Error(`${gitDir}/HEAD not understood`);
  const loose = join(gitDir, m[1]);
  if (existsSync(loose)) return readFileSync(loose, "utf8").trim();
  const packed = join(gitDir, "packed-refs");
  if (existsSync(packed)) {
    for (const line of readFileSync(packed, "utf8").split("\n")) {
      const [id, name] = line.trim().split(" ");
      if (name === m[1] && /^[0-9a-f]{40}$/.test(id)) return id;
    }
  }
  throw new Error(`${gitDir}: ${m[1]} does not resolve`);
}

export function parsePin(text) {
  const pin = { repository: "", commit: "", files: [], header: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      pin.header.push(raw);
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts[0] === "gap_repository" && parts.length === 2) pin.repository = parts[1];
    else if (parts[0] === "gap_commit" && parts.length === 2) pin.commit = parts[1];
    else if (parts[0] === "file" && parts.length === 4) {
      pin.files.push({ hash: parts[1], gap: parts[2], aep: parts[3] });
    } else throw new Error(`${PIN_PATH}: line not understood: ${line}`);
  }
  if (!pin.repository) throw new Error(`${PIN_PATH}: gap_repository missing`);
  if (!/^[0-9a-f]{40}$/.test(pin.commit)) throw new Error(`${PIN_PATH}: gap_commit is not a commit id`);
  if (pin.files.length === 0) throw new Error(`${PIN_PATH}: no file lines`);
  return pin;
}

export function renderPin(pin) {
  const lines = [...pin.header, `gap_repository ${pin.repository}`, `gap_commit ${pin.commit}`];
  for (const f of pin.files) lines.push(`file ${f.hash} ${f.gap} ${f.aep}`);
  return `${lines.join("\n")}\n`;
}

/// key = "value" lines of gap-versions.toml.
export function parseVersions(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"$/.exec(line);
    if (!m) throw new Error(`${VERSIONS}: line not understood: ${line}`);
    out[m[1]] = m[2];
  }
  return out;
}

function cargoPackageVersion(text, table) {
  let inTable = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inTable = line === `[${table}]`;
      continue;
    }
    const m = /^version\s*=\s*"([^"]+)"$/.exec(line);
    if (inTable && m) return m[1];
  }
  return null;
}

/// Every problem of the AEP tree against the pin. Empty means green.
export function checkPin(root = AEP_ROOT, gapDir = null) {
  const problems = [];
  const read = (rel) => readFileSync(join(root, rel));
  const pin = parsePin(read(PIN_PATH).toString("utf8"));

  for (const f of pin.files) {
    const at = join(root, f.aep);
    if (!existsSync(at)) {
      problems.push(`byte check: ${f.aep} is missing`);
      continue;
    }
    const got = digest(readFileSync(at));
    if (got !== f.hash) problems.push(`byte check: ${f.aep} differs from GAP ${f.gap} at ${pin.commit}`);
    if (gapDir) {
      const g = join(gapDir, f.gap);
      if (!existsSync(g)) problems.push(`GAP checkout has no ${f.gap}`);
      else if (digest(readFileSync(g)) !== f.hash) {
        problems.push(`GAP checkout ${f.gap} differs from the pinned bytes`);
      }
    }
  }

  // The pinned crate src holds the pinned files and nothing else.
  const pinnedSrc = new Set(
    pin.files.filter((f) => f.aep.startsWith(`${CRATE_SRC}/`)).map((f) => f.aep.slice(CRATE_SRC.length + 1)),
  );
  for (const name of readdirSync(join(root, CRATE_SRC))) {
    if (!pinnedSrc.has(name)) problems.push(`byte check: ${CRATE_SRC}/${name} is not a pinned GAP file`);
  }

  // Version check: the pinned GAP version values agree with this AEP release.
  const versions = parseVersions(read(VERSIONS).toString("utf8"));
  const aepCargo = cargoPackageVersion(read("Cargo.toml").toString("utf8"), "workspace.package");
  const aepNode = JSON.parse(read("package.json").toString("utf8")).version;
  if (versions.aep !== aepCargo) {
    problems.push(`version check: GAP names AEP ${versions.aep}, Cargo.toml workspace.package is ${aepCargo}`);
  }
  if (versions.aep !== aepNode) {
    problems.push(`version check: GAP names AEP ${versions.aep}, package.json is ${aepNode}`);
  }
  const crateVersion = cargoPackageVersion(read(CRATE_MANIFEST).toString("utf8"), "package");
  if (versions["gap-schema-profile-v13"] !== crateVersion) {
    problems.push(
      `version check: GAP names gap-schema-profile-v13 ${versions["gap-schema-profile-v13"]}, the pinned crate is ${crateVersion}`,
    );
  }
  const live = `AEP-Components/gap/schemas/gap-meta-schema-v${versions.live_schema}.json`;
  if (!pin.files.some((f) => f.aep === live)) problems.push(`version check: live schema ${live} is not pinned`);

  if (gapDir && existsSync(join(gapDir, ".git"))) {
    const head = gitHead(gapDir);
    if (head !== pin.commit) problems.push(`GAP checkout is at ${head}, the pin names ${pin.commit}`);
  }
  return problems;
}

/// Copy every pinned file from a GAP checkout and rewrite the pin with its commit.
export function repin(gapDir, root = AEP_ROOT) {
  const pin = parsePin(readFileSync(join(root, PIN_PATH), "utf8"));
  pin.commit = gitHead(gapDir);
  for (const f of pin.files) {
    copyFileSync(join(gapDir, f.gap), join(root, f.aep));
    f.hash = digest(readFileSync(join(root, f.aep)));
  }
  writeFileSync(join(root, PIN_PATH), renderPin(pin));
  return pin;
}

function main(argv) {
  let gapDir = null;
  if (argv[0] === "--repin" && argv[1] && argv.length === 2) {
    const pin = repin(resolve(argv[1]));
    console.log(`repinned ${pin.files.length} files to GAP ${pin.commit}`);
    gapDir = resolve(argv[1]);
  } else if (argv[0] === "--gap" && argv[1] && argv.length === 2) {
    gapDir = resolve(argv[1]);
  } else if (argv.length !== 0) {
    console.error("usage: check-gap-pin.mjs [--gap DIR | --repin DIR]");
    return 2;
  }
  let problems;
  try {
    problems = checkPin(AEP_ROOT, gapDir);
  } catch (e) {
    console.error(`gap pin: ${e.message}`);
    return 2;
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL ${p}`);
    return 1;
  }
  const pin = parsePin(readFileSync(join(AEP_ROOT, PIN_PATH), "utf8"));
  console.log(`gap pin ok: ${pin.files.length} files match GAP ${pin.commit}${gapDir ? " and the GAP checkout" : ""}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
