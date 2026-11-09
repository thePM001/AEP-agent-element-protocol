import { describe, it, expect } from "vitest";
import {
  transpileCedarToGap,
  transpileRegoToGap,
  transpileGapToCedar,
  transpileGapToRego,
} from "../lib/policy/transpilers/index.js";

type GapJson = {
  address: { domain: string; id: string };
  pattern: {
    guard: string;
    constraints: string[];
    invariants: Array<{ expr: string; lang: string; severity: string; description: string }>;
  };
  action: { type: string; steps: string[] };
  weight: number;
  composition: { type: string };
  metadata: { source: string; version: string };
};

function parseGapJson(text: string): GapJson {
  return JSON.parse(text) as GapJson;
}

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error("thrown value is not an Error", { cause: e });
  }
  throw new Error("expected a throw");
}

const CEDAR = [
  'permit (principal == User::"alice", action == Action::"read", resource in Folder::"docs") when { context.mfa == true };',
  'forbid (principal, action == Action::"delete", resource) unless { principal.admin };',
].join("\n");

const REGO = `package aep.demo

deny[msg] {
  input.bad == true
  msg := sprintf("bad input %v", [input.x])
}

allow {
  input.user == "admin"
}
`;

describe("transpileCedarToGap", () => {
  it("maps each statement to constraints, an invariant and a pipeline step", () => {
    const gap = parseGapJson(transpileCedarToGap(CEDAR));
    expect(gap.address).toEqual({ domain: "cedar.imported", id: "policy" });
    expect(gap.metadata).toEqual({ source: "cedar", version: "1.0.0" });
    expect(gap.action).toEqual({ type: "pipeline", steps: ["allow", "deny"] });
    expect(gap.composition).toEqual({ type: "atomic" });
    expect(gap.pattern.guard).toBe("true");
    expect(gap.pattern.constraints).toEqual([
      'cedar:action:Action::"read"',
      'cedar:principal:User::"alice"',
      'cedar:resource:Folder::"docs"',
      "cedar:when:context.mfa == true",
      'cedar:action:Action::"delete"',
      "cedar:unless:principal.admin",
    ]);
    expect(gap.pattern.invariants.map((i) => [i.expr, i.severity, i.lang])).toEqual([
      ["cedar_effect_permit_1", "soft", "gapdsl"],
      ["cedar_effect_forbid_2", "hard", "gapdsl"],
    ]);
    expect(gap.pattern.invariants[1]?.description).toBe('forbid (principal, action == Action::"delete", resource) unless { principal.admin }');
  });

  it("is case-insensitive on the effect keyword and handles nested braces", () => {
    const gap = parseGapJson(transpileCedarToGap('FORBID(principal, action, resource) when { context.tags.contains({k: "v"}) };'));
    expect(gap.action.steps).toEqual(["deny"]);
    expect(gap.pattern.constraints).toEqual(['cedar:when:context.tags.contains({k: "v"})']);
  });

  it("truncates long descriptions", () => {
    const longWhen = "x == 1 && ".repeat(40) + "true";
    const gap = parseGapJson(transpileCedarToGap(`permit (principal, action, resource) when { ${longWhen} };`));
    expect(gap.pattern.invariants[0]?.description).toHaveLength(240);
  });

  it("refuses empty or statement-free input", () => {
    expect(() => transpileCedarToGap("   ")).toThrow("Cedar source is empty; refusing pass-through");
    expect(() => transpileCedarToGap("// just a comment")).toThrow("Cedar source has no permit or forbid statement");
  });
});

describe("transpileRegoToGap", () => {
  it("maps deny and allow rules with package and messages", () => {
    const gap = parseGapJson(transpileRegoToGap(REGO));
    expect(gap.address.domain).toBe("aep.demo");
    expect(gap.metadata.source).toBe("rego");
    expect(gap.action.steps).toEqual(["deny", "allow"]);
    expect(gap.pattern.constraints).toEqual([
      "rego:package:aep.demo",
      "rego:deny:1",
      "rego:msg:bad input %v",
      "rego:allow:2",
    ]);
    expect(gap.pattern.invariants.map((i) => [i.expr, i.severity])).toEqual([
      ["rego_deny_1", "hard"],
      ["rego_allow_2", "soft"],
    ]);
    expect(gap.pattern.invariants[1]?.description).toBe('input.user == "admin"');
  });

  it("reads plain string messages and defaults the domain without a package", () => {
    const gap = parseGapJson(transpileRegoToGap('deny[msg] {\n  input.x\n  msg := "plain reason"\n}'));
    expect(gap.address.domain).toBe("rego.imported");
    expect(gap.pattern.constraints).toEqual(["rego:package:data", "rego:deny:1", "rego:msg:plain reason"]);
  });

  it("refuses empty input, input without rules, and input with no package or rule words", () => {
    expect(() => transpileRegoToGap("")).toThrow("Rego source is empty; refusing pass-through");
    expect(() => transpileRegoToGap("x := 1")).toThrow("Rego source has no package or deny/allow rule");
    expect(() => transpileRegoToGap("package a.b\n\nx := 1")).toThrow("Rego source has no deny or allow rule");
  });
});

describe("transpileGapToCedar", () => {
  it("emits forbid for hard invariants and permit for soft ones", () => {
    const gap = JSON.stringify({
      address: { domain: "acme.files" },
      pattern: {
        invariants: [
          { expr: "no_delete", severity: "hard", description: "never\ndelete" },
          { expr: 'say "hi"', severity: "soft" },
        ],
      },
    });
    const cedar = transpileGapToCedar(gap);
    expect(cedar).toBe(
      [
        "forbid (",
        "  principal,",
        '  action == Action::"no_delete",',
        '  resource == Resource::"acme.files"',
        ") when {",
        '  context.invariant == "no_delete"',
        "  // never delete",
        "};",
        "",
        "permit (",
        "  principal,",
        '  action == Action::"say \\"hi\\"",',
        '  resource == Resource::"acme.files"',
        ") when {",
        '  context.invariant == "say \\"hi\\""',
        "};",
        "",
      ].join("\n"),
    );
  });

  it("emits one forbid over all constraints when there are no invariants", () => {
    const cedar = transpileGapToCedar(JSON.stringify({ pattern: { constraints: ["a", "line\nbreak", 5] } }));
    expect(cedar).toContain('  context.constraint == "a" && context.constraint == "line\\nbreak"');
    expect(cedar.startsWith("forbid (")).toBe(true);
    expect(cedar).not.toContain("5");
  });

  it("reads the line format with dash constraints", () => {
    const cedar = transpileGapToCedar("domain: 'shop'\nexpr: price_positive\n- qty > 0");
    expect(cedar).toContain('resource == Resource::"shop"');
    expect(cedar).toContain('context.invariant == "price_positive"');
  });

  it("refuses empty, unparseable and item-free documents", () => {
    expect(() => transpileGapToCedar("")).toThrow("GAP source is empty; refusing pass-through");
    const bad = errorOf(() => transpileGapToCedar("{ not json"));
    expect(bad.message).toBe("GAP JSON is not parseable");
    expect(bad.cause).toBeInstanceOf(SyntaxError);
    expect(() => transpileGapToCedar('{"address": {"domain": "x"}}')).toThrow("GAP JSON has no pattern invariants or constraints");
    expect(() => transpileGapToCedar("hello world")).toThrow("GAP source has no address pattern items");
  });
});

describe("transpileGapToRego", () => {
  it("emits a package and one deny rule per invariant and constraint", () => {
    const rego = transpileGapToRego(
      JSON.stringify({
        address: { domain: "acme-files" },
        pattern: {
          invariants: [{ expr: "size < 10", description: 'quota "hard" at 100%' }, { expr: "" }],
          constraints: ["owner == me"],
        },
      }),
    );
    expect(rego).toBe(
      [
        "package acme_files",
        "",
        "deny[msg] {",
        '  not input.satisfied["size_10"]',
        '  msg := sprintf("quota \\"hard\\" at 100%%", [])',
        "}",
        "",
        "deny[msg] {",
        '  not input.satisfied["item_2"]',
        '  msg := sprintf("", [])',
        "}",
        "",
        "deny[msg] {",
        '  not input.constraints["owner_me"]',
        '  msg := sprintf("constraint failed: owner == me", [])',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("prefixes numeric package names and falls back for an empty domain", () => {
    expect(transpileGapToRego("domain: 9lives\nconstraint: a").startsWith("package gap_9lives\n")).toBe(true);
    expect(transpileGapToRego("domain:\nexpr: a").startsWith("package gap.imported\n")).toBe(true);
    expect(transpileGapToRego("expr: x").startsWith("package gap.imported\n")).toBe(true);
  });

  it("caps rule identifiers at 72 characters", () => {
    const rego = transpileGapToRego(`expr: ${"a".repeat(100)}`);
    expect(rego).toContain(`input.satisfied["${"a".repeat(72)}"]`);
  });

  it("refuses empty, unparseable and item-free documents", () => {
    expect(() => transpileGapToRego(" \n ")).toThrow("GAP source is empty; refusing pass-through");
    const bad = errorOf(() => transpileGapToRego("{oops"));
    expect(bad.message).toBe("GAP JSON is not parseable");
    expect(bad.cause).toBeInstanceOf(SyntaxError);
    expect(() => transpileGapToRego('{"pattern": {"invariants": [null, 3]}}')).toThrow("GAP JSON has no pattern invariants or constraints");
    expect(() => transpileGapToRego("- dash lines are cedar-only")).toThrow("GAP source has no address pattern items");
  });
});

describe("transpiler round trips", () => {
  it("Cedar to GAP to Cedar keeps every statement and its effect", () => {
    const back = transpileGapToCedar(transpileCedarToGap(CEDAR));
    expect(back.match(/^permit \(/gm)).toHaveLength(1);
    expect(back.match(/^forbid \(/gm)).toHaveLength(1);
    expect(back).toContain('action == Action::"cedar_effect_permit_1"');
    expect(back).toContain('action == Action::"cedar_effect_forbid_2"');
    expect(back).toContain('resource == Resource::"cedar.imported"');
    expect(back).toContain('  // permit (principal == User::"alice"');
  });

  it("Rego to GAP to Rego keeps the package and denies every rule and constraint", () => {
    const back = transpileGapToRego(transpileRegoToGap(REGO));
    expect(back.startsWith("package aep.demo\n")).toBe(true);
    expect(back.match(/^deny\[msg\] \{$/gm)).toHaveLength(6);
    expect(back).toContain('not input.satisfied["rego_deny_1"]');
    expect(back).toContain('not input.satisfied["rego_allow_2"]');
    expect(back).toContain('msg := sprintf("constraint failed: rego:msg:bad input %%v", [])');
    expect(back).toContain('msg := sprintf("input.bad == true\\n  msg := sprintf(\\"bad input %%v\\", [input.x])", [])');
    expect(back).not.toMatch(/sprintf\("[^"\n]*\n/);
  });

  it("crosses Cedar to Rego and Rego to Cedar through GAP", () => {
    const rego = transpileGapToRego(transpileCedarToGap(CEDAR));
    expect(rego.startsWith("package cedar.imported\n")).toBe(true);
    expect(rego).toContain('not input.satisfied["cedar_effect_forbid_2"]');
    expect(rego).toContain('constraint failed: cedar:principal:User::\\"alice\\"');

    const cedar = transpileGapToCedar(transpileRegoToGap(REGO));
    expect(cedar).toContain('resource == Resource::"aep.demo"');
    expect(cedar.match(/^forbid \(/gm)).toHaveLength(1);
    expect(cedar.match(/^permit \(/gm)).toHaveLength(1);
  });
});
