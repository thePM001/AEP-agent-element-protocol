import { parseCovenant } from "../../src/covenant/parser.js";
import { evaluateCovenant } from "../../src/covenant/evaluator.js";
import { compileCovenant } from "../../src/covenant/compiler.js";

describe("Covenant Parser", () => {
  it("parses permit rules", () => {
    const spec = parseCovenant(`covenant Test {\n  permit file:read;\n}`);
    expect(spec.name).toBe("Test");
    expect(spec.rules).toHaveLength(1);
    expect(spec.rules[0].type).toBe("permit");
    expect(spec.rules[0].action).toBe("file:read");
  });

  it("parses forbid rules", () => {
    const spec = parseCovenant(`covenant Test {\n  forbid file:delete;\n}`);
    expect(spec.rules).toHaveLength(1);
    expect(spec.rules[0].type).toBe("forbid");
    expect(spec.rules[0].action).toBe("file:delete");
  });

  it("parses require rules", () => {
    const spec = parseCovenant(`covenant Test {\n  require trustTier >= "standard";\n}`);
    expect(spec.rules).toHaveLength(1);
    expect(spec.rules[0].type).toBe("require");
    expect(spec.rules[0].action).toBe("trustTier");
    expect(spec.rules[0].conditions).toHaveLength(1);
    expect(spec.rules[0].conditions[0].operator).toBe(">=");
    expect(spec.rules[0].conditions[0].value).toBe("standard");
  });

  it("parses multiple rules", () => {
    const spec = parseCovenant([
      "covenant Multi {",
      "  permit file:read;",
      "  forbid file:delete;",
      "  permit file:write;",
      "}",
    ].join("\n"));
    expect(spec.rules).toHaveLength(3);
    expect(spec.rules[0].type).toBe("permit");
    expect(spec.rules[1].type).toBe("forbid");
    expect(spec.rules[2].type).toBe("permit");
  });

  it("ignores blank lines and comments", () => {
    const spec = parseCovenant([
      "covenant Clean {",
      "  // this is a comment",
      "  permit file:read;",
      "",
      "  forbid file:delete;",
      "}",
    ].join("\n"));
    expect(spec.rules).toHaveLength(2);
  });

  it("parses conditions with in operator", () => {
    const spec = parseCovenant([
      "covenant Scoped {",
      '  permit file:write (path in ["src/", "tests/"]);',
      "}",
    ].join("\n"));
    expect(spec.rules[0].conditions).toHaveLength(1);
    expect(spec.rules[0].conditions[0].operator).toBe("in");
    expect(spec.rules[0].conditions[0].field).toBe("path");
    expect(spec.rules[0].conditions[0].value).toEqual(["src/", "tests/"]);
  });

  it("parses conditions with matches operator", () => {
    const spec = parseCovenant([
      "covenant Safety {",
      '  forbid command:run (command matches "rm.*-rf");',
      "}",
    ].join("\n"));
    expect(spec.rules[0].conditions).toHaveLength(1);
    expect(spec.rules[0].conditions[0].operator).toBe("matches");
    expect(spec.rules[0].conditions[0].field).toBe("command");
    expect(spec.rules[0].conditions[0].value).toBe("rm.*-rf");
  });

  it("throws on missing covenant block", () => {
    expect(() => parseCovenant("permit file:read;")).toThrow("No covenant name");
  });

  it("throws on invalid rule syntax", () => {
    expect(() => parseCovenant("covenant Bad {\n  invalid line\n}")).toThrow("Invalid covenant rule");
  });
});

describe("Covenant Evaluator", () => {
  it("allows permitted actions", () => {
    const spec = parseCovenant("covenant E1 {\n  permit file:read;\n}");
    const result = evaluateCovenant(spec, { action: "file:read", input: {} });
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("Permitted");
  });

  it("denies forbidden actions", () => {
    const spec = parseCovenant("covenant E2 {\n  forbid file:delete;\n}");
    const result = evaluateCovenant(spec, { action: "file:delete", input: {} });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Forbidden");
  });

  it("forbid overrides permit", () => {
    const spec = parseCovenant([
      "covenant E3 {",
      "  permit file:delete;",
      "  forbid file:delete;",
      "}",
    ].join("\n"));
    const result = evaluateCovenant(spec, { action: "file:delete", input: {} });
    expect(result.allowed).toBe(false);
  });

  it("default deny for unmatched actions", () => {
    const spec = parseCovenant("covenant E4 {\n  permit file:read;\n}");
    const result = evaluateCovenant(spec, { action: "file:write", input: {} });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no covenant rule");
  });

  it("require rules deny when precondition fails", () => {
    const spec = parseCovenant('covenant E5 {\n  require trustTier >= "trusted";\n  permit file:read;\n}');
    // trustTier "standard" is below "trusted"
    const result = evaluateCovenant(spec, { action: "file:read", input: {}, trustTier: "standard" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Requirement not met");
  });

  it("require rules pass when precondition met", () => {
    const spec = parseCovenant('covenant E6 {\n  require trustTier >= "standard";\n  permit file:read;\n}');
    const result = evaluateCovenant(spec, { action: "file:read", input: {}, trustTier: "trusted" });
    expect(result.allowed).toBe(true);
  });

  it("conditional forbid matches on input field", () => {
    const spec = parseCovenant([
      "covenant E7 {",
      '  forbid command:run (command matches "rm.*-rf");',
      "  permit command:run;",
      "}",
    ].join("\n"));
    const deny = evaluateCovenant(spec, { action: "command:run", input: { command: "rm -rf /" } });
    expect(deny.allowed).toBe(false);

    const allow = evaluateCovenant(spec, { action: "command:run", input: { command: "ls -la" } });
    expect(allow.allowed).toBe(true);
  });
});

describe("Covenant Compiler", () => {
  it("compiles covenant into indexed maps", () => {
    const spec = parseCovenant([
      "covenant C1 {",
      "  permit file:read;",
      "  forbid file:delete;",
      "  permit file:write;",
      "}",
    ].join("\n"));
    const compiled = compileCovenant(spec);
    expect(compiled.name).toBe("C1");
    expect(compiled.permitRules.has("file:read")).toBe(true);
    expect(compiled.permitRules.has("file:write")).toBe(true);
    expect(compiled.forbidRules.has("file:delete")).toBe(true);
    expect(compiled.requireRules).toHaveLength(0);
  });

  it("compiled form separates require rules", () => {
    const spec = parseCovenant([
      "covenant C2 {",
      '  require trustTier >= "standard";',
      "  permit file:read;",
      "  forbid file:delete;",
      "}",
    ].join("\n"));
    const compiled = compileCovenant(spec);
    expect(compiled.name).toBe("C2");
    expect(compiled.requireRules).toHaveLength(1);
    expect(compiled.permitRules.size).toBe(1);
    expect(compiled.forbidRules.size).toBe(1);
  });
});
