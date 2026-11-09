import { describe, it, expect } from "vitest";
import { parseCovenant } from "../lib/parser.js";
import { compileCovenant } from "../lib/compiler.js";

const SOURCE = `
// Example covenant
covenant DataAgent {
  permit file:read;
  permit file:write (path matches "^/workspace/");
  forbid file:delete [hard];
  forbid net:fetch (host in ["evil.test", "bad.test"]) [soft];
  permit aep:create_element;
  require trust_tier >= "standard";
  forbid command:run (risk == "high");
}
`;

describe("parseCovenant", () => {
  it("parses name, rules, conditions and severities", () => {
    const spec = parseCovenant(SOURCE);
    expect(spec.name).toBe("DataAgent");
    expect(spec.rules).toEqual([
      { type: "permit", action: "file:read", conditions: [] },
      {
        type: "permit",
        action: "file:write",
        conditions: [{ field: "path", operator: "matches", value: "^/workspace/" }],
      },
      { type: "forbid", action: "file:delete", conditions: [], severity: "hard" },
      {
        type: "forbid",
        action: "net:fetch",
        conditions: [{ field: "host", operator: "in", value: ["evil.test", "bad.test"] }],
        severity: "soft",
      },
      { type: "permit", action: "aep:create_element", conditions: [] },
      {
        type: "require",
        action: "trust_tier",
        conditions: [{ field: "trust_tier", operator: ">=", value: "standard" }],
      },
      {
        type: "forbid",
        action: "command:run",
        conditions: [{ field: "risk", operator: "==", value: "high" }],
      },
    ]);
  });

  it("parses every comparison operator", () => {
    for (const op of ["==", "!=", ">", "<", ">=", "<="]) {
      const spec = parseCovenant(`covenant C {\n permit x (n ${op} "5");\n}`);
      expect(spec.rules[0]?.conditions[0]).toEqual({ field: "n", operator: op, value: "5" });
    }
  });

  it("does not leave severity undefined on rules without one", () => {
    const spec = parseCovenant("covenant C {\n permit a;\n}");
    expect("severity" in (spec.rules[0] ?? {})).toBe(false);
  });

  it("ignores lines outside the covenant block", () => {
    const spec = parseCovenant("garbage before\ncovenant C {\npermit a;\n}\nanything after");
    expect(spec.rules).toHaveLength(1);
  });

  it("rejects source without a covenant declaration", () => {
    expect(() => parseCovenant("permit a;")).toThrow(/No covenant name found/);
    expect(() => parseCovenant("")).toThrow(/No covenant name found/);
  });

  it("rejects multiple covenants in one source", () => {
    expect(() => parseCovenant("covenant A {\n}\ncovenant B {\n}")).toThrow(/Multiple covenants/);
  });

  it("rejects malformed rules", () => {
    expect(() => parseCovenant("covenant C {\n allow x;\n}")).toThrow(/Invalid covenant rule/);
    expect(() => parseCovenant("covenant C {\n permit x\n}")).toThrow(/Invalid covenant rule/);
  });

  it("rejects malformed require conditions", () => {
    expect(() => parseCovenant('covenant C {\n require trust_tier ~ "x";\n}')).toThrow(/Invalid require condition/);
    expect(() => parseCovenant("covenant C {\n require trust_tier >= standard;\n}")).toThrow(/Invalid require condition/);
  });

  it("rejects malformed action expressions and conditions", () => {
    expect(() => parseCovenant("covenant C {\n permit bad action;\n}")).toThrow(/Invalid action expression/);
    expect(() => parseCovenant("covenant C {\n permit x (n ~ 5);\n}")).toThrow(/Invalid condition/);
    // Wildcard actions are evaluator-only (programmatic specs); the DSL does not accept them
    expect(() => parseCovenant("covenant C {\n permit aep:*;\n}")).toThrow(/Invalid action expression/);
  });
});

describe("compileCovenant", () => {
  it("groups rules by type and action, preserving order", () => {
    const spec = parseCovenant(`covenant C {
      permit file:read;
      permit file:read (path matches "^/a");
      forbid file:delete;
      forbid file:delete (path == "/etc") [soft];
      require ring <= "2";
      require trust_tier >= "standard";
    }`);
    const compiled = compileCovenant(spec);
    expect(compiled.name).toBe("C");
    expect(compiled.requireRules.map((r) => r.action)).toEqual(["ring", "trust_tier"]);
    expect([...compiled.permitRules.keys()]).toEqual(["file:read"]);
    expect(compiled.permitRules.get("file:read")).toHaveLength(2);
    expect(compiled.forbidRules.get("file:delete")?.map((r) => r.severity ?? "none")).toEqual(["none", "soft"]);
    expect(compiled.forbidRules.has("file:read")).toBe(false);
  });

  it("compiles an empty covenant to empty groups", () => {
    const compiled = compileCovenant({ name: "Empty", rules: [] });
    expect(compiled).toEqual({ name: "Empty", requireRules: [], forbidRules: new Map(), permitRules: new Map() });
  });
});
