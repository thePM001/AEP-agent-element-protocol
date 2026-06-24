#!/usr/bin/env node
/**
 * Move tests/, plans/, docs/ under AEP-NOSHIP/ (not shipped in runtime distro).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const NOSHIP = "AEP-NOSHIP";
const SKIP = new Set(["node_modules", ".git", "target"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js|json|sh|toml|md|yml|yaml|rs|Dockerfile|gitignore)$/.test(name)) out.push(p);
  }
  return out;
}

function bulkReplace(files, pairs, skipPath) {
  let n = 0;
  for (const file of files) {
    if (file.includes(skipPath)) continue;
    let text = readFileSync(file, "utf8");
    const orig = text;
    for (const [from, to] of pairs) {
      if (typeof from === "string") text = text.split(from).join(to);
      else text = text.replace(from, to);
    }
    if (text !== orig) {
      writeFileSync(file, text);
      n++;
    }
  }
  return n;
}

function moveDir(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(src, dest);
  console.log(`  ${src.replace(REPO + "/", "")} -> ${dest.replace(REPO + "/", "")}`);
}

console.log("=== Phase 1: Create AEP-NOSHIP and move folders ===");
mkdirSync(join(REPO, NOSHIP), { recursive: true });
for (const dir of ["tests", "plans", "docs"]) {
  const src = join(REPO, dir);
  const dest = join(REPO, NOSHIP, dir);
  if (existsSync(src)) moveDir(src, dest);
}

writeFileSync(
  join(REPO, NOSHIP, "README.md"),
  `# AEP-NOSHIP

Not shipped in runtime distributions. Internal engineering assets only.

| Path | Contents |
|------|----------|
| \`tests/\` | Unit and integration tests, conformance vitest suites |
| \`plans/\` | Implementation and upgrade planning documents |
| \`docs/\` | Protocol reference, migration guides, compliance docs |

Runtime installers (Docker, CCA) exclude this folder.
`,
);

console.log("\n=== Phase 2: Fix test import depths ===");
const testsRoot = join(REPO, NOSHIP, "tests");
function fixTestImports(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      fixTestImports(p);
      continue;
    }
    if (!/\.(mjs|ts)$/.test(name)) continue;
    let text = readFileSync(p, "utf8");
    const orig = text;
    const rel = relative(testsRoot, dirname(p));
    const depth = rel === "" ? 1 : rel.split(/[/\\]/).length + 1;
    const prefix = "../".repeat(depth + 1);
    text = text.replace(/from "(\.\.\/)+(AEP-|AEP-SDKs)/g, (m, dots, start) => {
      const levels = (m.match(/\.\.\//g) || []).length;
      const needed = depth + 1;
      if (levels >= needed) return m;
      return `from "${prefix}${start}`;
    });
    text = text.replace(/from '(\.\.\/)+(AEP-|AEP-SDKs)/g, (m) => m);
    if (text !== orig) writeFileSync(p, text);
  }
}
fixTestImports(testsRoot);

console.log("\n=== Phase 3: Bulk path rewrites (repo-root tests/plans/docs) ===");
const files = walk(REPO).filter((f) => !f.includes(`${NOSHIP}/plans/`) && !f.includes(`${NOSHIP}/docs/`) || f.endsWith(".md"));
const allFiles = walk(REPO);
const pairs = [
  ['join(REPO, "tests")', `join(REPO, "${NOSHIP}/tests")`],
  ['join(repoRoot, "tests")', `join(repoRoot, "${NOSHIP}/tests")`],
  ['join(process.cwd(), "tests")', `join(process.cwd(), "${NOSHIP}/tests")`],
  ["`tests/", `\`${NOSHIP}/tests/`],
  ['"tests/', `"${NOSHIP}/tests/`],
  ["'tests/", `'${NOSHIP}/tests/`],
  ["../../../tests/", `../../../${NOSHIP}/tests/`],
  ["../../tests/", `../../${NOSHIP}/tests/`],
  ["../tests/", `../${NOSHIP}/tests/`],
  ["`plans/", `\`${NOSHIP}/plans/`],
  ['"plans/', `"${NOSHIP}/plans/`],
  ["'plans/", `'${NOSHIP}/plans/`],
  ["`docs/DOCKING", `\`${NOSHIP}/docs/DOCKING`],
  ["`docs/SUBPROTOCOLS", `\`${NOSHIP}/docs/SUBPROTOCOLS`],
  ["`docs/NLA-PORT", `\`${NOSHIP}/docs/NLA-PORT`],
  ["`docs/CODEX", `\`${NOSHIP}/docs/CODEX`],
  ["`docs/COMPLIANCE", `\`${NOSHIP}/docs/COMPLIANCE`],
  ["`docs/EXTERNAL", `\`${NOSHIP}/docs/EXTERNAL`],
  ["`docs/MIGRATION", `\`${NOSHIP}/docs/MIGRATION`],
  ["`docs/LATTICE", `\`${NOSHIP}/docs/LATTICE`],
  ["`docs/OWASP", `\`${NOSHIP}/docs/OWASP`],
  ["`docs/POLICY", `\`${NOSHIP}/docs/POLICY`],
  ["`docs/PROTOCOL", `\`${NOSHIP}/docs/PROTOCOL`],
  ["`docs/RESOLVER", `\`${NOSHIP}/docs/RESOLVER`],
  ["(docs/", `(${NOSHIP}/docs/`],
  ["[docs/", `[${NOSHIP}/docs/`],
  ["(docs/", `(${NOSHIP}/docs/`],
  ["../docs/", `../${NOSHIP}/docs/`],
  ["../../docs/", `../../${NOSHIP}/docs/`],
  ["../../../docs/", `../../../${NOSHIP}/docs/`],
  ["- `docs/", `- \`${NOSHIP}/docs/`],
  ["| `docs/", `| \`${NOSHIP}/docs/`],
  ["See `docs/", `See \`${NOSHIP}/docs/`],
  ["see docs/", `see ${NOSHIP}/docs/`],
  ["Full guide: `docs/", `Full guide: \`${NOSHIP}/docs/`],
  ["Docs: `docs/", `Docs: \`${NOSHIP}/docs/`],
  ["# Docs: docs/", `# Docs: ${NOSHIP}/docs/`],
  ["per docs/", `per ${NOSHIP}/docs/`],
  ["See [docs/", `See [${NOSHIP}/docs/`],
  ["| [docs/", `| [${NOSHIP}/docs/`],
  ["(docs/NLA", `(${NOSHIP}/docs/NLA`],
  ["(docs/DOCKING", `(${NOSHIP}/docs/DOCKING`],
  ["(docs/CODEX", `(${NOSHIP}/docs/CODEX`],
  ["(docs/EXTERNAL", `(${NOSHIP}/docs/EXTERNAL`],
  ["(docs/SUBPROTOCOLS", `(${NOSHIP}/docs/SUBPROTOCOLS`],
  ["../docs/SUBPROTOCOLS", `../${NOSHIP}/docs/SUBPROTOCOLS`],
  ["../docs/COMPLIANCE", `../${NOSHIP}/docs/COMPLIANCE`],
  ["../../docs/COMPLIANCE", `../../${NOSHIP}/docs/COMPLIANCE`],
  ["- `tests/`", `- \`${NOSHIP}/tests/\``],
  ["`tests/` -", `\`${NOSHIP}/tests/\` -`],
  ["plans\n", `${NOSHIP}/plans\n`],
  ["tests\n", `${NOSHIP}/tests\n`],
];
let n = bulkReplace(allFiles, pairs, "reorganize-aep-noship.mjs");

console.log(`  patched ${n} files`);

console.log("\n=== Phase 4: Key config files ===");
const vitest = join(REPO, "vitest.config.ts");
if (existsSync(vitest)) {
  writeFileSync(
    vitest,
    `import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@aep/core": path.resolve(repoRoot, "AEP-SDKs/typescript/aep-protocol/sdk/sdk-aep-core.ts"),
    },
  },
  test: {
    include: ["${NOSHIP}/tests/**/*.test.ts", "${NOSHIP}/tests/**/*.test.mjs"],
    globals: true,
    testTimeout: 10000,
  },
});
`,
  );
}

const confVitest = join(REPO, "AEP-Components/conformance/harness/vitest.config.ts");
if (existsSync(confVitest)) {
  let t = readFileSync(confVitest, "utf8");
  t = t.replace(/"tests\//g, `"${NOSHIP}/tests/`);
  writeFileSync(confVitest, t);
}

const dockerignore = join(REPO, ".dockerignore");
if (existsSync(dockerignore)) {
  let t = readFileSync(dockerignore, "utf8");
  t = t.replace(/^plans$/m, NOSHIP);
  t = t.replace(/^tests$/m, `${NOSHIP}`);
  if (!t.includes(`${NOSHIP}/docs`)) {
    t = t.replace(/^AEP-Research-Paper$/m, `${NOSHIP}\nAEP-Research-Paper`);
  }
  writeFileSync(dockerignore, t);
}

console.log("\nDone.");