import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentGateway } from "../../src/gateway.js";
import { EvalRunner } from "../../src/eval/runner.js";
import { RuleGenerator } from "../../src/eval/rule-generator.js";
import type { EvalDataset, EvalReport } from "../../src/eval/types.js";

const TEST_DIR = join(
  import.meta.dirname ?? __dirname,
  "../../.test-eval-ledgers"
);

const POLICY_DIR = join(
  import.meta.dirname ?? __dirname,
  "../../.test-eval-policies"
);

function writePolicyFile(): string {
  const policyPath = join(POLICY_DIR, "test.policy.yaml");
  writeFileSync(policyPath, `version: "2.5"
name: "eval-test"
capabilities:
  - tool: "file:read"
    scope:
      paths: ["src/**"]
  - tool: "file:write"
    scope:
      paths: ["src/**"]
  - tool: "aep:create_element"
    scope:
      element_prefixes: ["CP", "PN"]
limits: {}
forbidden:
  - pattern: "\\\\.env"
    reason: "secrets"
  - pattern: "password|secret"
    reason: "credentials"
session:
  max_actions: 200
evidence:
  enabled: true
  dir: "${TEST_DIR}"
scanners:
  enabled: true
  pii:
    enabled: true
    severity: hard
  injection:
    enabled: true
    severity: hard
  secrets:
    enabled: true
    severity: hard
  jailbreak:
    enabled: true
    severity: hard
  toxicity:
    enabled: false
    severity: soft
  urls:
    enabled: false
    severity: soft
    allowlist: []
    blocklist: []
`, "utf-8");
  return policyPath;
}

function makeDataset(): EvalDataset {
  return {
    name: "test-dataset",
    version: "1.0.0",
    entries: [
      {
        id: "e1",
        input: "file:read src/index.ts",
        expectedOutcome: "pass",
        category: "file",
      },
      {
        id: "e2",
        input: "file:read .env",
        expectedOutcome: "fail",
        category: "file",
      },
      {
        id: "e3",
        input: "file:write src/app.ts",
        expectedOutcome: "pass",
        category: "file",
      },
      {
        id: "e4",
        input: "aep:create_element CP-00010",
        expectedOutcome: "pass",
        category: "aep",
      },
      {
        id: "e5",
        input: "file:delete src/old.ts",
        expectedOutcome: "fail",
        category: "file",
      },
    ],
  };
}

describe("EvalRunner", () => {
  let gateway: AgentGateway;
  let policyPath: string;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    if (!existsSync(POLICY_DIR)) mkdirSync(POLICY_DIR, { recursive: true });
    gateway = new AgentGateway({ ledgerDir: TEST_DIR });
    policyPath = writePolicyFile();
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    if (existsSync(POLICY_DIR)) rmSync(POLICY_DIR, { recursive: true, force: true });
  });

  it("executes dataset entries against policy", () => {
    const runner = new EvalRunner(gateway);
    const dataset = makeDataset();
    const report = runner.run(dataset, policyPath);

    expect(report.datasetName).toBe("test-dataset");
    expect(report.total).toBe(5);
  });

  it("pass entries that are allowed are counted as passed", () => {
    const runner = new EvalRunner(gateway);
    const dataset: EvalDataset = {
      name: "pass-test",
      version: "1.0.0",
      entries: [
        { id: "p1", input: "file:read src/index.ts", expectedOutcome: "pass", category: "file" },
      ],
    };

    const report = runner.run(dataset, policyPath);
    expect(report.passed).toBeGreaterThanOrEqual(1);
  });

  it("fail entries that are denied are counted as passed", () => {
    const runner = new EvalRunner(gateway);
    const dataset: EvalDataset = {
      name: "deny-test",
      version: "1.0.0",
      entries: [
        { id: "d1", input: "file:read .env", expectedOutcome: "fail", category: "file" },
      ],
    };

    const report = runner.run(dataset, policyPath);
    // A "fail" entry that actually gets denied is a correct result (counted as passed)
    expect(report.passed).toBeGreaterThanOrEqual(1);
  });

  it("pass entries that are denied are counted as false positive", () => {
    const runner = new EvalRunner(gateway);
    const dataset: EvalDataset = {
      name: "false-positive-test",
      version: "1.0.0",
      entries: [
        // This action should be denied (no capability for file:delete), but expected pass
        { id: "fp1", input: "file:delete src/old.ts", expectedOutcome: "pass", category: "file" },
      ],
    };

    const report = runner.run(dataset, policyPath);
    expect(report.falsePositives).toBeGreaterThanOrEqual(1);
  });

  it("fail entries that are allowed are counted as false negative", () => {
    const runner = new EvalRunner(gateway);
    const dataset: EvalDataset = {
      name: "false-negative-test",
      version: "1.0.0",
      entries: [
        // This action would be allowed (file:read in src/), but expected fail
        { id: "fn1", input: "file:read src/safe.ts", expectedOutcome: "fail", category: "file" },
      ],
    };

    const report = runner.run(dataset, policyPath);
    expect(report.falseNegatives).toBeGreaterThanOrEqual(1);
  });

  it("report summarises violations by category and count", () => {
    const runner = new EvalRunner(gateway);
    const dataset = makeDataset();
    const report = runner.run(dataset, policyPath);

    // Report should have violations array
    expect(Array.isArray(report.violations)).toBe(true);
    for (const v of report.violations) {
      expect(v.rule).toBeDefined();
      expect(v.count).toBeGreaterThanOrEqual(1);
      expect(v.category).toBeDefined();
    }
  });
});

describe("RuleGenerator", () => {
  it("produces valid covenant syntax", () => {
    const generator = new RuleGenerator();
    const report: EvalReport = {
      datasetName: "test",
      total: 10,
      passed: 5,
      failed: 5,
      falsePositives: 2,
      falseNegatives: 3,
      violations: [
        { rule: 'prefix "XX" blocked', count: 4, severity: "hard", category: "aep" },
      ],
      suggestedRules: [
        {
          type: "covenant",
          rule: 'forbid aep:create_element (prefix == "XX") [hard];',
          confidence: 0.4,
          basedOn: '4 false negatives with prefix "XX"',
        },
      ],
    };

    const rules = generator.fromReport(report);
    expect(rules.covenantRules.length).toBeGreaterThanOrEqual(1);
    expect(rules.covenantRules[0]).toContain("forbid");
  });

  it("produces valid scanner regex", () => {
    const generator = new RuleGenerator();
    const report: EvalReport = {
      datasetName: "test",
      total: 10,
      passed: 5,
      failed: 5,
      falsePositives: 2,
      falseNegatives: 3,
      violations: [],
      suggestedRules: [
        {
          type: "scanner",
          rule: "password|secret",
          confidence: 0.5,
          basedOn: "3 violations in content",
        },
      ],
    };

    const rules = generator.fromReport(report);
    expect(rules.scannerPatterns.length).toBeGreaterThanOrEqual(1);
    // Verify it compiles as valid regex
    expect(() => new RegExp(rules.scannerPatterns[0])).not.toThrow();
  });

  it("suggested rules are written to file", () => {
    const tmpDir = join(TEST_DIR, "suggestions-test");
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

    const generator = new RuleGenerator();
    const report: EvalReport = {
      datasetName: "write-test",
      total: 5,
      passed: 3,
      failed: 2,
      falsePositives: 1,
      falseNegatives: 1,
      violations: [],
      suggestedRules: [
        { type: "covenant", rule: "forbid file:delete [hard];", confidence: 0.5, basedOn: "test" },
      ],
    };

    const filePath = generator.writeSuggestions(report, tmpDir);
    expect(existsSync(filePath)).toBe(true);

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.datasetName).toBe("write-test");
    expect(content.suggestedRules).toHaveLength(1);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// Clean up module-level
afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  if (existsSync(POLICY_DIR)) rmSync(POLICY_DIR, { recursive: true, force: true });
});
