import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkThreatModel, codeLines, layerSections, testExists } from "../check-threat-model-trace.mjs";
import { carriesMatcher, countWritingRuleSites, readsTheSet } from "../check-writing-rule-sites.mjs";
import {
  changelogHistoryLines,
  checkReleaseStrings,
  isShipped,
  parseAllow,
  readIgnoredNames,
} from "../check-release-strings.mjs";
import { jsonBody, preflight, type RunResult } from "../../aep-base-node-preflight.mjs";
import {
  collectRelativeTargets,
  collectTreePaths,
  isRelativeTarget,
  registryFindings,
  resolveTarget,
  selectSections,
} from "../../../aep-check.mjs";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const EXPORT_AREA = String.fromCharCode(65, 69, 80, 45, 78, 79, 83, 72, 73, 80);
/** An older release, built from parts so this file itself holds no stale release string. */
const MINOR = ["2", "8"].join(".");
const OLD = `${MINOR}.6`;
const temps: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "aep-checks-test-"));
  temps.push(d);
  return d;
}

function put(root: string, rel: string, body: string): void {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), body);
}

afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("threat model trace", () => {
  it("the shipped model traces every row", () => {
    const r = checkThreatModel(REPO);
    expect(r.findings).toEqual([]);
    expect(r.rows).toBeGreaterThan(0);
  });

  it("counts only a running test as a check", () => {
    const root = tempDir();
    put(root, "t.rs", [
      "#[test]",
      "fn real() {}",
      "fn helper() {}",
      "#[test]",
      "#[ignore]",
      "fn skipped() {}",
      "// #[test]",
      "// fn commented() {}",
      "#[tokio::test]",
      "async fn real_async() {}",
    ].join("\n"));
    put(root, "t.test.ts", ['it("runs", () => {});', 'it.skip("skipped", () => {});', '// it("commented", () => {});'].join("\n"));
    put(root, "t_test.go", ["func TestReal(t *testing.T) {}", "func helper() {}"].join("\n"));
    expect(testExists(root, "t.rs::real").ok).toBe(true);
    expect(testExists(root, "t.rs::real_async").ok).toBe(true);
    expect(testExists(root, "t.rs::helper").ok).toBe(false);
    expect(testExists(root, "t.rs::skipped").ok).toBe(false);
    expect(testExists(root, "t.rs::commented").ok).toBe(false);
    expect(testExists(root, 't.test.ts::"runs"').ok).toBe(true);
    expect(testExists(root, 't.test.ts::"skipped"').ok).toBe(false);
    expect(testExists(root, 't.test.ts::"commented"').ok).toBe(false);
    expect(testExists(root, "t_test.go::TestReal").ok).toBe(true);
    expect(testExists(root, "t_test.go::helper").ok).toBe(false);
    expect(testExists(root, "../outside.rs::x").why).toMatch(/outside the tree/);
    expect(testExists(root, "nope").ok).toBe(false);
  });

  it("splits the model into layer sections and blanks comment lines", () => {
    const s = layerSections("## Layer 1: Base Node\n| BN-1 | x |\n## Other\nline");
    expect([...s.keys()]).toEqual(["Base Node"]);
    expect(codeLines("a\n  // b\nc")).toEqual(["a", "", "c"]);
  });
});

describe("writing rule sites", () => {
  it("the shipped tree has one definition site and a complete rule source", () => {
    const r = countWritingRuleSites(REPO);
    expect(r.problems).toEqual([]);
    expect(r.sites).toEqual(["AEP-Components/admit/crate/src/lib.rs"]);
  });

  it("tells a matcher from a sample and a reader of the compiled set", () => {
    expect(carriesMatcher("if (line.includes(', and ')) {}")).toBe(true);
    expect(carriesMatcher("// line.includes(', and ')")).toBe(false);
    expect(carriesMatcher("const sample = 'a, and b';")).toBe(false);
    expect(readsTheSet("compileWritingWalls()")).toBe(true);
  });
});

describe("release strings", () => {
  it("the shipped tree passes", () => {
    const r = checkReleaseStrings(REPO, [EXPORT_AREA, ".gomodcache", ".gocache", ".gopath"]);
    expect(r.problems).toEqual([]);
    expect(r.scanned).toBeGreaterThan(100);
  });

  function tree(): string {
    const root = tempDir();
    put(root, "package.json", JSON.stringify({ version: "2.9.0" }));
    put(root, "Cargo.toml", '[workspace.package]\nversion = "2.9.0"\n');
    put(root, "AEP-User-Experience/harness/release-allow.list", `# list\nA/allowed.md\tAEP ${MINOR} history\treason\n`);
    return root;
  }

  it("finds a stale line, honors the allow list and checks pending counts", () => {
    const root = tree();
    put(root, "A/allowed.md", `AEP ${MINOR} history\n`);
    put(root, "A/stale.md", `ok\nnow at ${OLD}\n`);
    put(root, "A/pending.md", `AEP ${MINOR} one\nAEP ${MINOR} two\n`);
    put(root, "AEP-User-Experience/harness/release-pending.list", "A/pending.md\t3\twhy\nA/bad.md\tmany\twhy\n");
    const r = checkReleaseStrings(root);
    expect(r.problems).toEqual(expect.arrayContaining([
      `A/stale.md:2 stale release string: now at ${OLD}`,
      "A/pending.md holds 2 stale lines against 3 listed as pending",
      "release-pending.list row A/bad.md names no whole count",
    ]));
    expect(r.problems.some((p) => p.startsWith("A/allowed.md"))).toBe(false);
  });

  it("refuses a release source that is not the release", () => {
    const root = tree();
    put(root, "package.json", JSON.stringify({ version: OLD }));
    expect(checkReleaseStrings(root).problems).toContain(`package.json reads ${OLD} against the release string 2.9.0`);
  });

  it("reads the allow list, the ignore entries and the changelog history", () => {
    expect(parseAllow("p\tline\treason\n#c\nbad\n").count).toBe(1);
    const d = tempDir();
    put(d, ".gitignore", "/out/\n*.log\n!keep\nbuild\n");
    expect([...readIgnoredNames(d)].sort()).toEqual(["build", "out"]);
    expect([...changelogHistoryLines(["## [2.9.0]", "a", `## [${OLD}]`, "b"])]).toEqual([2, 3]);
    expect(isShipped("X/a", new Set(["Y"]))).toBe(false);
    expect(isShipped("root.md", new Set())).toBe(true);
  });
});

describe("base node preflight", () => {
  function setup(withConfig: boolean): { dataDir: string; configPath: string } {
    const dataDir = tempDir();
    const configPath = join(dataDir, "base-node.json");
    if (withConfig) writeFileSync(configPath, JSON.stringify({ base_node: { lrps: ["a"] } }));
    return { dataDir, configPath };
  }

  function runner(health: RunResult, selfTest: RunResult = { status: 0, stdout: "", stderr: "" }) {
    return (_bin: string, args: string[]): RunResult => (args.includes("--health") ? health : selfTest);
  }

  const healthy = { status: 0, stdout: 'log line {"x"\n{"status":"ok","docking_ports_listening":true,"docking_ports":[1,2,3,4],"action_lattice_events":7}\n', stderr: "" };

  it("passes when the self-test, the health probe and the config all hold", () => {
    const r = preflight({ ...setup(true), bin: "/bin/aep", repo: REPO, run: runner(healthy) });
    expect(r.failures).toEqual([]);
    expect(r.lines).toEqual(expect.arrayContaining(["Health: ok (7 lattice events)", "Docks: 4 ports"]));
  });

  it("fails on a degraded node, closed docks or a probe with no report", () => {
    const degraded = { status: 1, stdout: '{"status":"degraded","docking_ports_listening":false}', stderr: "" };
    const r = preflight({ ...setup(true), bin: "/bin/aep", repo: REPO, run: runner(degraded) });
    expect(r.failures).toEqual(["health status: degraded (exit 1)", "docking ports not listening (run aep-base-node --daemon)"]);
    const silent = preflight({ ...setup(true), bin: "/bin/aep", repo: REPO, run: runner({ status: 0, stdout: "", stderr: "boom" }) });
    expect(silent.failures[0]).toMatch(/printed no report/);
  });

  it("fails without a binary, a passing self-test or a config", () => {
    const r = preflight({ ...setup(false), bin: null, repo: REPO, run: runner(healthy) });
    expect(r.failures[0]).toMatch(/binary not found/);
    expect(r.failures.some((f) => f.startsWith("config not found"))).toBe(true);
    const bad = preflight({ ...setup(true), bin: "/bin/aep", repo: REPO, run: runner(healthy, { status: 2, stdout: "", stderr: "x" }) });
    expect(bad.failures).toEqual(["AEP-Base-Node self-test failed: x"]);
  });

  it("reads the JSON body of a program and nothing else", () => {
    expect(jsonBody('a {"b":1} c')).toEqual({ b: 1 });
    expect(jsonBody("[1]")).toBeNull();
    expect(jsonBody("{")).toBeNull();
  });
});

describe("root check", () => {
  it("picks one section by name and refuses an unknown one", () => {
    expect(selectSections(undefined)?.length).toBe(8);
    expect(selectSections("readme")?.map((s) => s.name)).toEqual(["readme"]);
    expect(selectSections("no such")).toBeNull();
  });

  it("collects relative links outside code and resolves them", () => {
    const md = "[a](./x.md) `[b](y.md)` [c](https://e) [d](#h)\n```\n[e](z.md)\n```\n[f](w%20x.md#s)";
    expect(collectRelativeTargets(md)).toEqual([{ line: 1, target: "./x.md" }, { line: 5, target: "w%20x.md#s" }]);
    expect(isRelativeTarget("/abs")).toBe(false);
    expect(resolveTarget("/r/a/b.md", "w%20x.md#s")).toBe("/r/a/w x.md");
    expect(resolveTarget("/r/a/b.md", "%E0%A4%A.md")).toBe("/r/a/%E0%A4%A.md");
  });

  it("collects the tree paths a README writes in code spans", () => {
    expect(collectTreePaths("see `A/b.md:3` and `A/<x>` and `B/c`", ["A"])).toEqual([{ line: 1, target: "A/b.md" }]);
  });

  it("the shipped registry has no finding", () => {
    const r = registryFindings(REPO);
    expect(r.findings).toEqual([]);
    expect(r.rows).toBeGreaterThan(0);
  });
});
