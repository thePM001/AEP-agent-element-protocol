import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadPolicy, validatePolicy } from "../../src/policy/loader.js";

const POLICIES_DIR = resolve(
  import.meta.dirname ?? __dirname,
  "../../policies"
);

describe("Policy Loader", () => {
  it("loads and validates coding-agent policy", () => {
    const policy = loadPolicy(resolve(POLICIES_DIR, "coding-agent.policy.yaml"));
    expect(policy.name).toBe("coding-agent");
    expect(policy.version).toBe("2.5");
    expect(policy.capabilities.length).toBeGreaterThan(0);
    expect(policy.session.max_actions).toBe(100);
  });

  it("loads and validates aep-builder policy", () => {
    const policy = loadPolicy(resolve(POLICIES_DIR, "aep-builder.policy.yaml"));
    expect(policy.name).toBe("aep-builder");
    expect(policy.capabilities.length).toBeGreaterThan(0);
  });

  it("loads and validates readonly-auditor policy", () => {
    const policy = loadPolicy(
      resolve(POLICIES_DIR, "readonly-auditor.policy.yaml")
    );
    expect(policy.name).toBe("readonly-auditor");
    expect(policy.session.max_actions).toBe(50);
    expect(policy.forbidden.length).toBeGreaterThan(0);
  });

  it("loads and validates strict-production policy", () => {
    const policy = loadPolicy(
      resolve(POLICIES_DIR, "strict-production.policy.yaml")
    );
    expect(policy.name).toBe("strict-production");
    expect(policy.session.max_actions).toBe(20);
    expect(policy.gates.length).toBeGreaterThan(0);
  });

  it("rejects invalid policy with missing required fields", () => {
    expect(() => validatePolicy({})).toThrow("Invalid policy");
  });

  it("rejects policy with wrong types", () => {
    expect(() =>
      validatePolicy({
        version: 123,
        name: "bad",
        capabilities: "not-array",
        limits: {},
        session: { max_actions: "not-number" },
      })
    ).toThrow("Invalid policy");
  });

  it("validates a minimal valid policy object", () => {
    const policy = validatePolicy({
      version: "2.1",
      name: "minimal",
      capabilities: [],
      limits: {},
      session: { max_actions: 10 },
    });
    expect(policy.name).toBe("minimal");
    expect(policy.forbidden).toEqual([]);
    expect(policy.gates).toEqual([]);
  });

  it("parses all policy fields correctly", () => {
    const policy = validatePolicy({
      version: "2.1",
      name: "full",
      capabilities: [
        { tool: "file:read", scope: { paths: ["src/**"] } },
      ],
      limits: {
        max_runtime_ms: 60000,
        max_files_changed: 10,
        max_aep_mutations: 50,
        max_cost_usd: 5.0,
      },
      gates: [
        { action: "file:delete", approval: "human", risk_level: "high" },
      ],
      forbidden: [{ pattern: "\\.env", reason: "secrets" }],
      session: {
        max_actions: 100,
        max_denials: 20,
        rate_limit: { max_per_minute: 30 },
        escalation: [
          { after_actions: 50, require: "human_checkin" },
          { after_minutes: 10, require: "pause" },
          { after_denials: 5, require: "terminate" },
        ],
      },
      evidence: { enabled: true, dir: "./audit" },
      remediation: { max_retries: 5, cooldown_ms: 2000 },
    });

    expect(policy.capabilities).toHaveLength(1);
    expect(policy.limits.max_runtime_ms).toBe(60000);
    expect(policy.limits.max_aep_mutations).toBe(50);
    expect(policy.gates).toHaveLength(1);
    expect(policy.forbidden).toHaveLength(1);
    expect(policy.session.escalation).toHaveLength(3);
    expect(policy.evidence.dir).toBe("./audit");
    expect(policy.remediation?.max_retries).toBe(5);
  });
});
