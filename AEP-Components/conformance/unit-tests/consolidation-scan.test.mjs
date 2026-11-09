import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consolidationRows,
  formatConsolidationReport,
  scanFiles,
  shipped,
  walk,
} from "../runner/consolidation-scan.mjs";

const INTERNAL = "AEP-" + "NO" + "SHIP";
// The scan reads this test file too, so every text it counts is assembled here at
// run time and never appears whole in the source.
const PUB = "pub " + "const ";
const PULSE = PUB + "PULSE" + "_MS: u64";
const ALLOW_BUILD = "allow: " + "closed.is_empty()";
const SCAN_TABLE = "aep.scanners." + "scan-rule-table.v1";
const DEAD_CCA = "AEP-Components/" + "cca";
const DEAD_CAW = "AEP-Components/" + "caw-framework";
const UNLABELLED = "without host label";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function put(rel, body) {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

function rowOf(rows, concern) {
  const row = rows.find((r) => r.concern === concern);
  if (!row) throw new Error(`no row ${concern}`);
  return row;
}

/** A tiny tree where every concern matches the plan. */
function greenTree() {
  put("AEP-Components/admit/lib.rs", `${PUB}RULE_EM: &str = "no_em_dashes";\n${PULSE} = 10;\n`);
  put("AEP-Components/admit/result.rs", `fn r() -> R { R { ${ALLOW_BUILD} } }\n`);
  put("AEP-Components/derived/result.rs", `// derived view\nfn r() -> R { R { ${ALLOW_BUILD} } }\n`);
  put("AEP-Components/scanners/rules.json", `{"schema": "${SCAN_TABLE}"}\n`);
  put("AEP-CAW/internal/sandbox.go", "func apply() { seccompLoad() }\n");
  put("AEP-Components/README.md", "One live graph owns the state.\n");
  put("AEP-Components/intent-ledger/README.md", "The one runtime ledger.\n");
  put("AEP-Policy-System/host.policy.yaml", "# Host layer policy. Not an Admit layer authoring form\n");
  put("AEP-Policy-System/host.rego", "# Host lattice engine policy. Not an Admit layer authoring form\n");
}

describe("walk and scanFiles", () => {
  it("lists code files with slash relative paths and skips build folders", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    put("a/b.rs", "x");
    put("a/c.txt", "x");
    put("node_modules/d.mjs", "x");
    put("target/e.rs", "x");
    put("f.md", "x");
    expect(walk(dir).length).toBe(3);
    expect(scanFiles(dir).map((f) => f.rel).sort()).toEqual(["a/b.rs", "f.md"]);
  });

  it("returns an empty list for a missing directory", () => {
    expect(walk(join(tmpdir(), "aep-no-such-dir-for-scan"))).toEqual([]);
  });
});

describe("shipped", () => {
  it("excludes the scan itself and the internal records area", () => {
    expect(shipped({ rel: "AEP-Components/conformance/runner/consolidation-scan.mjs" })).toBe(false);
    expect(shipped({ rel: `${INTERNAL}/x.md` })).toBe(false);
    expect(shipped({ rel: "AEP-Components/x.md" })).toBe(true);
  });
});

describe("consolidationRows", () => {
  it("passes every concern on a tree that matches the plan", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    greenTree();
    const rows = consolidationRows(dir);
    const failing = rows.filter((r) => r.count !== r.expected).map((r) => r.concern);
    expect(failing).toEqual([]);
    expect(rowOf(rows, "writing rule family definition sites").proof).toEqual(["AEP-Components/admit/lib.rs"]);
    expect(rowOf(rows, "live admit result build sites").proof).toEqual([
      "AEP-Components/admit/result.rs",
      "derived surfaces: AEP-Components/derived/result.rs",
    ]);
    expect(rowOf(rows, "enforcement implementations").proof).toEqual(["AEP-CAW"]);
    expect(rowOf(rows, "graph state owners").proof[0]).toBe("AEP-Components/README.md");
    expect(rowOf(rows, "runtime ledger names").proof[0]).toBe("AEP-Components/intent-ledger/README.md");
    expect(rowOf(rows, "authoring forms that reach the Admit layer").proof).toEqual([
      "GAP (json records under AEP-Policy-System/reference/)",
      "host policy YAML files: 1",
      "host rego files: 1",
    ]);
    expect(rows.length).toBe(10);
  });

  it("counts duplicate definition sites and ignores internal records", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    greenTree();
    put("AEP-Components/other/w.mjs", `export const WRITING_RULE_EN ${"="} "no_en_dashes";\n`);
    put("AEP-Components/other/p.rs", `${PULSE} = 5;\n`);
    put(`${INTERNAL}/old.rs`, `${PULSE} = 1;\n`);
    const rows = consolidationRows(dir);
    expect(rowOf(rows, "writing rule family definition sites").count).toBe(2);
    expect(rowOf(rows, "pulse constant definition sites").proof).toEqual([
      "AEP-Components/admit/lib.rs",
      "AEP-Components/other/p.rs",
    ]);
  });

  it("flags host policy forms without the host label, extra enforcement and dead paths", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    greenTree();
    put("AEP-Policy-System/loose.policy.yaml", "rules: []\n");
    put("AEP-Policy-System/loose.rego", "package x\n");
    put("AEP-Base-Node/src/jail.rs", "fn j() { landlock(); }\n");
    put("AEP-Base-Node/src/jail_test.go", "func t() { ptrace(1) }\n");
    put("docs/old.md", `see ${DEAD_CCA} for details\n`);
    put(`${INTERNAL}/old.md`, `see ${DEAD_CAW}\n`);
    const rows = consolidationRows(dir);
    expect(rowOf(rows, "authoring forms that reach the Admit layer").proof.slice(0, 3)).toEqual([
      "GAP (json records under AEP-Policy-System/reference/)",
      `policy YAML ${UNLABELLED} (1)`,
      `rego ${UNLABELLED} (1)`,
    ]);
    expect(rowOf(rows, "enforcement implementations").proof).toEqual(["AEP-Base-Node", "AEP-CAW"]);
    expect(rowOf(rows, "dead path references, cca components path").proof).toEqual(["docs/old.md"]);
    expect(rowOf(rows, "dead path references, caw framework components path").count).toBe(0);
  });

  it("reports zero owners on an empty tree", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    const rows = consolidationRows(dir);
    expect(rowOf(rows, "graph state owners").count).toBe(0);
    expect(rowOf(rows, "runtime ledger names").proof[0]).toMatch(/^derived surfaces: /);
  });
});

describe("formatConsolidationReport", () => {
  const rows = [
    { concern: "short", count: 1, expected: 1, proof: ["a.rs"] },
    { concern: "a longer concern", count: 2, expected: 1, proof: [] },
  ];

  it("prints an aligned table, the proof and a failure summary", () => {
    const report = formatConsolidationReport(rows, "/r");
    expect(report.ok).toBe(false);
    expect(report.lines).toEqual([
      "AEP 2.9 consolidation scan",
      "Root: /r",
      "",
      "concern           count  expect  state",
      "short                 1       1  PASS",
      "a longer concern      2       1  FAIL",
      "",
      "proof",
      "- short",
      "    a.rs",
      "- a longer concern",
      "    (no hit)",
      "",
      "FAIL 1 concern(s) do not match the plan",
    ]);
  });

  it("ends with a pass line when every count matches", () => {
    const report = formatConsolidationReport([rows[0]], "/r");
    expect(report.ok).toBe(true);
    expect(report.lines[report.lines.length - 1]).toBe("PASS every count matches the plan");
  });
});
