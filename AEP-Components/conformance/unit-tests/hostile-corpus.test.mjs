import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORPUS_PATH,
  accountRuns,
  cargoRuns,
  readRun,
  validateCorpus,
} from "../runner/hostile-corpus.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function shipped() {
  return JSON.parse(readFileSync(join(ROOT, CORPUS_PATH), "utf8"));
}

/** A small sound corpus with one case, one open and one elsewhere finding. */
function small() {
  return {
    suite: "s",
    version: "1",
    findings: ["KERNEL 01", "TSB 01", "CAWA 01"],
    required_classes: ["ledger-tampering"],
    cases: [
      {
        id: "HA-01",
        findings: ["KERNEL 01"],
        class: "ledger-tampering",
        attack: "a",
        expect: "e",
        package: "aep-ede",
        target: "--test=ede",
        test: "the_ledger_refuses_every_edit_cut_inside_reorder_and_unsealed_entry",
        file: "AEP-Components/ede/crate/tests/ede.rs",
      },
    ],
    open: [{ findings: ["TSB 01"], reason: "open" }],
    elsewhere: [{ findings: ["CAWA 01"], reason: "elsewhere" }],
  };
}

describe("CC-36 hostile agent corpus validation", () => {
  it("accepts the shipped corpus with the files of this tree", () => {
    expect(validateCorpus(shipped(), ROOT)).toEqual([]);
  });

  it("holds a draft environment case and a ledger tampering case", () => {
    const classes = new Set(shipped().cases.map((c) => c.class));
    expect(classes.has("draft-environment")).toBe(true);
    expect(classes.has("ledger-tampering")).toBe(true);
  });

  it("accepts a small sound corpus", () => {
    expect(validateCorpus(small(), ROOT)).toEqual([]);
  });

  it("refuses a finding that sits nowhere", () => {
    const c = small();
    c.findings.push("KERNEL 02");
    expect(validateCorpus(c, ROOT)).toEqual([
      "finding KERNEL 02 has no case and no open or elsewhere entry",
    ]);
  });

  it("refuses a finding that is both replayed and open", () => {
    const c = small();
    c.open[0].findings.push("KERNEL 01");
    expect(validateCorpus(c, ROOT)).toEqual(["finding KERNEL 01 sits in case HA-01 and in open"]);
  });

  it("refuses a stray finding id", () => {
    const c = small();
    c.elsewhere[0].findings.push("NOPE 09");
    expect(validateCorpus(c, ROOT)).toEqual([
      "elsewhere names NOPE 09, which the finding list does not hold",
    ]);
  });

  it("refuses a case whose test function does not exist", () => {
    const c = small();
    c.cases[0].test = "a_test_nobody_wrote";
    expect(validateCorpus(c, ROOT)).toEqual([
      "case HA-01 file AEP-Components/ede/crate/tests/ede.rs holds no test fn a_test_nobody_wrote",
    ]);
  });

  it("refuses a missing required class, a repeated test and a bad target", () => {
    const c = small();
    c.required_classes.push("draft-environment");
    c.cases.push({ ...c.cases[0], id: "HA-02", findings: [], target: "--all" });
    c.cases.push({ ...c.cases[0], id: "HA-03", findings: [] });
    const problems = validateCorpus(c, ROOT);
    expect(problems).toContain("case HA-02 has a bad target");
    expect(problems).toContain("case HA-03 repeats the test the_ledger_refuses_every_edit_cut_inside_reorder_and_unsealed_entry");
    expect(problems).toContain("no case plays the class draft-environment");
  });

  it("groups the cases into one cargo run per package and target", () => {
    const runs = cargoRuns(shipped().cases);
    const keys = runs.map((r) => `${r.package} ${r.target}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(runs.reduce((n, r) => n + r.tests.size, 0)).toBe(shipped().cases.length);
  });
});

describe("CC-36 hostile agent corpus run accounting", () => {
  const ok = (t) => `test ${t} ... ok`;

  it("passes when each named test reported ok once and nothing else ran", () => {
    const out = [ok("a::x"), ok("b"), "test result: ok. 2 passed; 0 failed; 0 ignored"].join("\n");
    expect(readRun(out, ["a::x", "b"])).toEqual({ passed: ["a::x", "b"], problems: [] });
  });

  it("fails a filter that matched nothing", () => {
    const out = "test result: ok. 0 passed; 0 failed; 0 ignored";
    expect(readRun(out, ["a"]).problems).toEqual([
      "a did not report ok exactly once",
      "the run passed 0 tests where the corpus names 1",
    ]);
  });

  it("fails a failed test and a run that passed more than the named tests", () => {
    const out = [
      ok("a"),
      "test b ... FAILED",
      "test result: FAILED. 1 passed; 1 failed; 0 ignored",
      ok("c"),
      "test result: ok. 1 passed; 0 failed; 0 ignored",
    ].join("\n");
    expect(readRun(out, ["a", "b"]).problems).toEqual([
      "b did not report ok exactly once",
      "1 tests failed",
    ]);
    expect(readRun(out, ["a"]).problems).toContain("the run passed 2 tests where the corpus names 1");
  });

  it("accounts every run that run.sh left and refuses a missing or failed run", () => {
    const c = small();
    const name = c.cases[0].test;
    const good = { out: `test ${name} ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored`, code: "0\n" };
    expect(accountRuns(c, () => good)).toEqual({ passed: [`HA-01 ${name}`], problems: [] });
    expect(accountRuns(c, () => ({ out: null, code: null })).problems).toEqual([
      "run 1 (aep-ede --test=ede) left no output",
    ]);
    expect(accountRuns(c, () => ({ ...good, code: "101" })).problems).toEqual([
      "run 1 (aep-ede --test=ede): cargo exited with 101",
    ]);
  });

  it("does not read a test whose name only starts with a named one", () => {
    const out = [ok("a_longer"), "test result: ok. 1 passed; 0 failed; 0 ignored"].join("\n");
    expect(readRun(out, ["a"]).problems).toContain("a did not report ok exactly once");
  });
});
