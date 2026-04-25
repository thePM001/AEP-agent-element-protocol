import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { PromptOptimizer } from "../../src/optimization/optimizer.js";
import { PromptVersionManager } from "../../src/optimization/versioning.js";
import type { Policy } from "../../src/policy/types.js";
import type { CovenantSpec } from "../../src/covenant/types.js";
import type { EvalReport } from "../../src/eval/types.js";

const TEST_DIR = join(
  import.meta.dirname ?? __dirname,
  "../../.test-optimization"
);

function makePolicy(): Policy {
  return {
    version: "2.5",
    name: "optimisation-test",
    capabilities: [
      { tool: "file:read", scope: { paths: ["src/**"] } },
      { tool: "file:write", scope: { paths: ["src/**"] } },
    ],
    limits: {},
    forbidden: [
      { pattern: "\\.env", reason: "Environment files contain secrets", severity: "hard" },
      { pattern: "password", reason: "Credential exposure", severity: "hard" },
    ],
    session: { max_actions: 100 },
    evidence: { enabled: true, dir: TEST_DIR },
    trust: { initial_score: 500 },
    ring: { default: 2 },
    scanners: {
      enabled: true,
      pii: { enabled: true, severity: "hard" },
      injection: { enabled: true, severity: "hard" },
      secrets: { enabled: true, severity: "hard" },
      jailbreak: { enabled: true, severity: "hard" },
      toxicity: { enabled: true, severity: "soft" },
      urls: { enabled: false, severity: "soft", allowlist: [], blocklist: [] },
    },
  } as Policy;
}

function makeCovenant(): CovenantSpec {
  return {
    name: "test-covenant",
    rules: [
      { type: "permit", action: "file:read", conditions: [] },
      {
        type: "forbid",
        action: "file:delete",
        conditions: [],
      },
      {
        type: "require",
        action: "file:write",
        conditions: [
          { field: "trustTier", operator: ">=", value: "standard" },
        ],
      },
    ],
  };
}

describe("PromptOptimizer", () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("injectGovernanceContext", () => {
    it("governance context injected: contains permitted and forbidden", () => {
      const optimizer = new PromptOptimizer(makePolicy(), makeCovenant());
      const result = optimizer.injectGovernanceContext("Do some work.");

      expect(result).toContain("AEP governance");
      expect(result).toContain("Permitted actions");
      expect(result).toContain("file:read");
      expect(result).toContain("Forbidden patterns");
      expect(result).toContain(".env");
      expect(result).toContain("password");
    });

    it("governance context includes scanner categories", () => {
      const optimizer = new PromptOptimizer(makePolicy());
      const result = optimizer.injectGovernanceContext("Hello");

      expect(result).toContain("pii");
      expect(result).toContain("injection");
      expect(result).toContain("secrets");
      expect(result).toContain("jailbreak");
      expect(result).toContain("scanners enabled");
    });

    it("governance context includes covenant forbid and require rules", () => {
      const optimizer = new PromptOptimizer(makePolicy(), makeCovenant());
      const result = optimizer.injectGovernanceContext("Work");

      expect(result).toContain("Forbidden actions (covenant)");
      expect(result).toContain("file:delete");
      expect(result).toContain("Required conditions");
      expect(result).toContain("trustTier");
    });

    it("governance context includes trust tier and ring", () => {
      const optimizer = new PromptOptimizer(makePolicy());
      const result = optimizer.injectGovernanceContext("Work");

      expect(result).toContain("Trust tier: standard");
      expect(result).toContain("Ring: 2");
    });

    it("inject does not modify original prompt content", () => {
      const optimizer = new PromptOptimizer(makePolicy());
      const original = "Write a function to sort arrays.";
      const result = optimizer.injectGovernanceContext(original);

      // Original prompt should be preserved at the end
      expect(result).toContain(original);
      expect(result.endsWith(original)).toBe(true);
    });

    it("includes output validation notice", () => {
      const optimizer = new PromptOptimizer(makePolicy());
      const result = optimizer.injectGovernanceContext("Test");

      expect(result).toContain("Output will be validated before delivery");
    });
  });

  describe("optimiseFromEval", () => {
    it("eval-based optimisation adds violation-specific instructions", () => {
      const optimizer = new PromptOptimizer(makePolicy());
      const report: EvalReport = {
        datasetName: "test",
        total: 20,
        passed: 15,
        failed: 5,
        falsePositives: 2,
        falseNegatives: 3,
        violations: [
          { rule: "pii:email found", count: 5, severity: "hard", category: "pii" },
          { rule: "secrets:api_key found", count: 3, severity: "hard", category: "secrets" },
        ],
        suggestedRules: [],
      };

      const result = optimizer.optimiseFromEval("Generate a report.", report);

      expect(result).toContain("email addresses");
      expect(result).toContain("API keys");
      expect(result).toContain("Generate a report.");
    });

    it("returns unmodified prompt when no violations", () => {
      const optimizer = new PromptOptimizer(makePolicy());
      const report: EvalReport = {
        datasetName: "clean",
        total: 10,
        passed: 10,
        failed: 0,
        falsePositives: 0,
        falseNegatives: 0,
        violations: [],
        suggestedRules: [],
      };

      const original = "Clean prompt.";
      const result = optimizer.optimiseFromEval(original, report);
      expect(result).toBe(original);
    });
  });
});

describe("PromptVersionManager", () => {
  let manager: PromptVersionManager;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    manager = new PromptVersionManager(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("save and load work", () => {
    const content = "You are a helpful assistant.";
    manager.save("system-prompt", "1.0.0", content);

    const loaded = manager.load("system-prompt", "1.0.0");
    expect(loaded).toBe(content);
  });

  it("load without version returns latest", () => {
    manager.save("evolving-prompt", "1.0.0", "Version one.");
    manager.save("evolving-prompt", "1.1.0", "Version two.");

    const loaded = manager.load("evolving-prompt");
    expect(loaded).toBe("Version two.");
  });

  it("list returns all versions", () => {
    manager.save("multi-version", "1.0.0", "First");
    manager.save("multi-version", "1.1.0", "Second");
    manager.save("multi-version", "2.0.0", "Third");

    const versions = manager.list("multi-version");
    expect(versions).toHaveLength(3);
    expect(versions.map(v => v.version)).toContain("1.0.0");
    expect(versions.map(v => v.version)).toContain("1.1.0");
    expect(versions.map(v => v.version)).toContain("2.0.0");

    // Each version should have a hash
    for (const v of versions) {
      expect(v.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(v.savedAt).toBeDefined();
    }
  });

  it("diff shows changes between versions", () => {
    manager.save("diff-test", "1.0.0", "Line one\nLine two\nLine three");
    manager.save("diff-test", "2.0.0", "Line one\nLine modified\nLine three\nLine four");

    const diff = manager.diff("diff-test", "1.0.0", "2.0.0");
    expect(diff).toContain("--- diff-test/1.0.0");
    expect(diff).toContain("+++ diff-test/2.0.0");
    expect(diff).toContain("- Line two");
    expect(diff).toContain("+ Line modified");
    expect(diff).toContain("+ Line four");
  });

  it("save overwrites existing version", () => {
    manager.save("overwrite-test", "1.0.0", "Original");
    manager.save("overwrite-test", "1.0.0", "Updated");

    const loaded = manager.load("overwrite-test", "1.0.0");
    expect(loaded).toBe("Updated");

    // Should still be one version in the index
    const versions = manager.list("overwrite-test");
    expect(versions).toHaveLength(1);
  });

  it("version hash is correct sha256", () => {
    const content = "Deterministic content for hashing.";
    manager.save("hash-test", "1.0.0", content);

    const versions = manager.list("hash-test");
    const expectedHash = createHash("sha256").update(content).digest("hex");
    expect(versions[0].hash).toBe(expectedHash);
  });

  it("list returns empty for non-existent prompt", () => {
    const versions = manager.list("does-not-exist");
    expect(versions).toHaveLength(0);
  });

  it("load throws for non-existent prompt", () => {
    expect(() => manager.load("missing")).toThrow('Prompt "missing" not found');
  });
});
