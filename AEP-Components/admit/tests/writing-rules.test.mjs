import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  compileWritingWalls,
  lintWritingRules,
  punctuationWordSpaceClosed,
  writingRule,
  writingRuleClosed,
  writingRuleIds,
  writingRuleTable,
  writingRulesPath,
  writingWallId,
} from "../lib/writing-rules.mjs";

// Forbidden characters are built at runtime so this source is plain ASCII.
const cp = (n) => String.fromCodePoint(n);
const EM = cp(0x2014);
const EN = cp(0x2013);
const HBAR = cp(0x2015);
const BOX = cp(0x2500);
const MINUS = cp(0x2212);
const DOUBLE_HYPHEN = " " + "-".repeat(2) + " ";

const ALL_IDS = [
  "no_em_dashes",
  "no_en_dashes",
  "no_dash_substitutes",
  "no_box_drawing_dashes",
  "no_minus_as_dash",
  "no_double_hyphen",
  "no_oxford_comma",
  "punctuation_word_space",
];

const closedIds = (text) => lintWritingRules(text).map((v) => v.rule);

describe("rule table", () => {
  it("loads the shipped json table in order", () => {
    expect(writingRuleIds()).toEqual(ALL_IDS);
    const raw = JSON.parse(readFileSync(writingRulesPath(), "utf8"));
    expect(raw.schema).toBe("aep.writing-rules.v1");
    expect(writingRuleTable()).toEqual(raw.rules);
  });

  it("caches the table", () => {
    expect(writingRuleTable()).toBe(writingRuleTable());
  });

  it("looks up a rule and throws for an unknown one", () => {
    expect(writingRule("no_em_dashes").wall_id).toBe("writing:no_em_dashes");
    expect(() => writingRule("no_such_rule")).toThrow("unknown writing rule: no_such_rule");
    expect(() => writingRuleClosed("x", "no_such_rule")).toThrow();
  });

  it("every wall id is the writing prefix plus the rule id", () => {
    for (const rule of writingRuleTable()) expect(rule.wall_id).toBe(writingWallId(rule.id));
  });
});

describe("punctuationWordSpaceClosed", () => {
  it("closes when ? or ! touches the next word", () => {
    expect(punctuationWordSpaceClosed("Ready?Go")).toBe(true);
    expect(punctuationWordSpaceClosed("Stop!now")).toBe(true);
    expect(punctuationWordSpaceClosed("Why?1")).toBe(true);
  });

  it("allows a space, an end of text or punctuation after the sign", () => {
    expect(punctuationWordSpaceClosed("Ready? Go")).toBe(false);
    expect(punctuationWordSpaceClosed("Ready?")).toBe(false);
    expect(punctuationWordSpaceClosed("Ready?!")).toBe(false);
    expect(punctuationWordSpaceClosed(null)).toBe(false);
  });
});

describe("lintWritingRules allow", () => {
  it("allows clean prose", () => {
    expect(lintWritingRules("Plain prose with a hyphen-word, commas and a list of a, b and c.")).toEqual([]);
    expect(lintWritingRules("")).toEqual([]);
    expect(lintWritingRules(undefined)).toEqual([]);
  });

  it("allows a single hyphen and a double hyphen without spaces", () => {
    expect(closedIds("well-known and a--b")).toEqual([]);
  });
});

describe("lintWritingRules deny", () => {
  it("closes each dash rule on its code point", () => {
    expect(closedIds(`a ${EM} b`)).toEqual(["no_em_dashes"]);
    expect(closedIds(`1${EN}2`)).toEqual(["no_en_dashes"]);
    expect(closedIds(`a ${HBAR} b`)).toEqual(["no_dash_substitutes"]);
    expect(closedIds(`a ${cp(0x2e3a)} b`)).toEqual(["no_dash_substitutes"]);
    expect(closedIds(`a ${BOX} b`)).toEqual(["no_box_drawing_dashes"]);
    expect(closedIds(`a ${MINUS} b`)).toEqual(["no_minus_as_dash"]);
  });

  it("closes the double hyphen and Oxford comma patterns", () => {
    expect(closedIds(`one${DOUBLE_HYPHEN}two`)).toEqual(["no_double_hyphen"]);
    expect(closedIds("red, green, and blue")).toEqual(["no_oxford_comma"]);
    expect(closedIds("tea, coffee, or water")).toEqual(["no_oxford_comma"]);
  });

  it("closes the punctuation rule", () => {
    expect(closedIds("Done?Yes")).toEqual(["punctuation_word_space"]);
  });

  it("reports every closed rule in table order with message and wall id", () => {
    const out = lintWritingRules(`x ${EM} y${DOUBLE_HYPHEN}z, a, and b?c`);
    expect(out.map((v) => v.rule)).toEqual([
      "no_em_dashes",
      "no_double_hyphen",
      "no_oxford_comma",
      "punctuation_word_space",
    ]);
    expect(out[0]).toEqual({
      rule: "no_em_dashes",
      message: writingRule("no_em_dashes").reason,
      wall_id: "writing:no_em_dashes",
    });
  });
});

describe("compileWritingWalls", () => {
  it("returns one wall per rule, all open for clean text", () => {
    const walls = compileWritingWalls("clean text");
    expect(walls.map((w) => w.id)).toEqual(ALL_IDS.map(writingWallId));
    expect(walls.every((w) => w.closed === false)).toBe(true);
    expect(walls[0].reason).toBe(writingRule("no_em_dashes").reason);
  });

  it("closes exactly the walls that fire", () => {
    const walls = compileWritingWalls(`a ${EN} b, c, and d`);
    expect(walls.filter((w) => w.closed).map((w) => w.id)).toEqual([
      "writing:no_en_dashes",
      "writing:no_oxford_comma",
    ]);
  });

  it("coerces non string input", () => {
    expect(compileWritingWalls(42).some((w) => w.closed)).toBe(false);
  });
});
