// Live dynAEP Admit collect-all walls. compileWritingWalls and the writing_text
// wall line are not called here because they ask the Base Node kernel binary.

import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  WRITING_RULE_NO_EM_DASHES,
  WRITING_RULE_PUNCTUATION_WORD_SPACE,
  admitCollectAll,
  admitWallClose,
  admitWallOpen,
  closedSetKey,
  formatAdmitResult,
  labLatticeFilterEnabled,
  labPolicyEvaluatorEnabled,
  parseWallLine,
  resolveWritingKernel,
  writingRuleTable,
  writingViolationsFromWalls,
  writingWallId,
} from "../lib/admit.mjs";

const ENV_KEYS = ["AEP_LAB_LATTICE_FILTER", "AEP_LAB_POLICY_EVALUATOR"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("lab switches", () => {
  it("are off unless set to an on value", () => {
    delete process.env.AEP_LAB_LATTICE_FILTER;
    delete process.env.AEP_LAB_POLICY_EVALUATOR;
    expect(labLatticeFilterEnabled()).toBe(false);
    expect(labPolicyEvaluatorEnabled()).toBe(false);
    for (const v of ["1", "true", " ON ", "True"]) {
      process.env.AEP_LAB_LATTICE_FILTER = v;
      process.env.AEP_LAB_POLICY_EVALUATOR = v;
      expect(labLatticeFilterEnabled()).toBe(true);
      expect(labPolicyEvaluatorEnabled()).toBe(true);
    }
    for (const v of ["0", "yes", "off", ""]) {
      process.env.AEP_LAB_LATTICE_FILTER = v;
      expect(labLatticeFilterEnabled()).toBe(false);
    }
  });
});

describe("walls", () => {
  it("builds open and closed walls with string fields", () => {
    expect(admitWallOpen(7)).toEqual({ id: "7", closed: false, reason: "" });
    expect(admitWallClose("dag", "missing parent")).toEqual({ id: "dag", closed: true, reason: "missing parent" });
    expect(admitWallClose("dag")).toEqual({ id: "dag", closed: true, reason: "" });
  });
});

describe("admitCollectAll", () => {
  it("allows when every wall is open or there are no walls", () => {
    expect(admitCollectAll([admitWallOpen("a"), admitWallOpen("b")])).toEqual({ allow: true, closed: [] });
    expect(admitCollectAll([])).toEqual({ allow: true, closed: [] });
    expect(admitCollectAll(undefined)).toEqual({ allow: true, closed: [] });
  });

  it("denies and collects every closed wall, not only the first", () => {
    const res = admitCollectAll([
      admitWallClose("scanner", "needle"),
      admitWallOpen("rate"),
      admitWallClose("dag", "unknown action"),
    ]);
    expect(res.allow).toBe(false);
    expect(res.closed).toEqual([
      { id: "dag", closed: true, reason: "unknown action" },
      { id: "scanner", closed: true, reason: "needle" },
    ]);
  });

  it("sorts by id then reason and removes exact duplicates", () => {
    const res = admitCollectAll([
      admitWallClose("b", "y"),
      admitWallClose("b", "x"),
      admitWallClose("a", "z"),
      admitWallClose("b", "x"),
      null,
    ]);
    expect(res.closed.map((w) => `${w.id}:${w.reason}`)).toEqual(["a:z", "b:x", "b:y"]);
  });

  it("is independent of wall order", () => {
    const walls = [admitWallClose("x", "1"), admitWallClose("y", "2"), admitWallOpen("z")];
    const a = admitCollectAll(walls);
    const b = admitCollectAll([...walls].reverse());
    expect(closedSetKey(a)).toBe(closedSetKey(b));
  });

  it("normalises loose wall objects", () => {
    const res = admitCollectAll([{ id: 5, closed: 1 }]);
    expect(res.closed).toEqual([{ id: "5", closed: true, reason: "" }]);
  });
});

describe("closedSetKey", () => {
  it("joins sorted id and reason pairs", () => {
    const key = closedSetKey({ closed: [{ id: "b", reason: "2" }, { id: "a", reason: "1" }] });
    expect(key).toBe("a\u001f1\nb\u001f2");
    expect(closedSetKey(null)).toBe("");
  });
});

describe("writing wall helpers", () => {
  it("prefixes writing wall ids", () => {
    expect(writingWallId(WRITING_RULE_NO_EM_DASHES)).toBe("writing:no_em_dashes");
    expect(WRITING_RULE_PUNCTUATION_WORD_SPACE).toBe("punctuation_word_space");
  });

  it("reads the writing rule family from writing.gap", () => {
    const ids = writingRuleTable();
    expect(ids).toContain("no_em_dashes");
    expect(ids).toContain("punctuation_word_space");
    expect(ids).toContain("attach_double_colon");
    expect(ids.every((id) => /^(no_|punctuation|space_before|attach_)/.test(id))).toBe(true);
  });

  it("maps closed writing walls to violations and ignores other walls", () => {
    const out = writingViolationsFromWalls([
      admitWallClose("writing:no_oxford_comma", "Oxford comma"),
      admitWallOpen("writing:no_em_dashes"),
      admitWallClose("dag", "x"),
    ]);
    expect(out).toEqual([{ rule: "no_oxford_comma", message: "Oxford comma" }]);
    expect(writingViolationsFromWalls(undefined)).toEqual([]);
  });

  it("resolves the kernel from the env first", () => {
    expect(resolveWritingKernel({ AEP_LATTICE_LOG_BIN: "/opt/aep/bin/kernel" })).toBe("/opt/aep/bin/kernel");
  });

  it("resolves the kernel to a built binary or the PATH name", () => {
    const bin = resolveWritingKernel({});
    const built = ["release", "debug"].some((p) => bin.endsWith(join("target", p, "aep-lattice-log")));
    expect(built || bin === "aep-lattice-log").toBe(true);
  });
});

describe("parseWallLine", () => {
  it("skips blank, comment and directive lines", () => {
    for (const line of ["", "   ", "# note", "@meta x", undefined]) expect(parseWallLine(line)).toEqual([]);
  });

  it("parses tab separated key value walls", () => {
    expect(parseWallLine("id=dag.parents\tclosed=true\treason=missing parent")).toEqual([
      { id: "dag.parents", closed: true, reason: "missing parent" },
    ]);
    expect(parseWallLine("id=rate\tclosed=false")).toEqual([{ id: "rate", closed: false, reason: "" }]);
  });

  it("accepts every closed spelling", () => {
    for (const v of ["true", "1", "yes", "closed", "TRUE"]) {
      expect(parseWallLine(`id=w\tclosed=${v}`)[0].closed).toBe(true);
    }
    for (const v of ["false", "0", "no", "open", ""]) {
      expect(parseWallLine(`id=w\tclosed=${v}`)[0].closed).toBe(false);
    }
  });

  it("drops a line without id and ignores parts without equals and unknown keys", () => {
    expect(parseWallLine("closed=true\treason=x")).toEqual([]);
    expect(parseWallLine("junk\tid=w\tcolor=red\treason=a=b\tclosed=1")).toEqual([
      { id: "w", closed: true, reason: "a=b" },
    ]);
  });

  it("feeds collect-all end to end", () => {
    const text = "# walls\nid=b\tclosed=1\treason=two\nid=a\tclosed=0\n\nid=c\tclosed=yes\treason=three\n";
    const res = admitCollectAll(text.split(/\r?\n/).flatMap(parseWallLine));
    expect(formatAdmitResult(res)).toBe("allow=false\nclosed=b|two\nclosed=c|three\n");
  });
});

describe("formatAdmitResult", () => {
  it("prints allow only for an open crossing", () => {
    expect(formatAdmitResult({ allow: true, closed: [] })).toBe("allow=true\n");
  });
});
