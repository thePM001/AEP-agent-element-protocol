import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy, validatePolicy } from "../lib/policy/loader.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aep-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePolicy(name: string, yaml: string): string {
  const p = join(dir, name);
  writeFileSync(p, yaml, "utf-8");
  return p;
}

const MINIMAL = `
version: "2.9"
name: minimal
capabilities:
  - tool: "file:read"
limits: {}
session:
  max_actions: 50
`;

describe("loadPolicy", () => {
  it("parses a minimal YAML policy and fills schema defaults", () => {
    const p = loadPolicy(writePolicy("min.yaml", MINIMAL));
    expect(p.name).toBe("minimal");
    expect(p.version).toBe("2.9");
    expect(p.capabilities).toEqual([{ tool: "file:read", scope: {} }]);
    expect(p.gates).toEqual([]);
    expect(p.forbidden).toEqual([]);
    expect(p.evidence).toEqual({ enabled: true, dir: "./ledgers" });
    expect(p.session).toEqual({
      max_actions: 50,
      escalation: [],
      auto_bundle: false,
      bundle_on_terminate: false,
    });
    expect(p.trust).toBeUndefined();
    expect(p.scanners).toBeUndefined();
    expect(p.model_gateway).toBeUndefined();
  });

  it("fills nested object defaults when a block is given empty", () => {
    const p = loadPolicy(
      writePolicy(
        "nested.yaml",
        `${MINIMAL}
trust: {}
ring: {}
scanners: {}
model_gateway: {}
fleet: {}
remediation: {}
knowledge: {}
`,
      ),
    );
    expect(p.trust?.initial_score).toBe(500);
    expect(p.trust?.penalties).toEqual({
      policy_violation: 50,
      structural_violation: 30,
      rate_limit: 10,
      forbidden_match: 100,
      intent_drift: 75,
    });
    expect(p.trust?.rewards).toEqual({ successful_action: 5, successful_rollback: 10 });
    expect(p.ring?.default).toBe(2);
    expect(p.ring?.promotion.to_ring_0.require_approval).toBe(true);
    expect(p.ring?.promotion.to_ring_1.require_approval).toBe(false);
    expect(p.scanners?.enabled).toBe(true);
    expect(p.scanners?.pii).toEqual({ enabled: true, severity: "hard" });
    expect(p.scanners?.toxicity).toEqual({ enabled: true, severity: "soft", custom_words: [] });
    expect(p.scanners?.profiler.enabled).toBe(false);
    expect(p.scanners?.temporal.reference_date).toBeUndefined();
    expect(p.model_gateway).toEqual({
      enabled: false,
      scan_output: true,
      scan_input: true,
      optimise_prompts: true,
      max_retries: 2,
      cost_tracking: true,
      providers: {},
    });
    expect(p.fleet?.max_agents).toBe(10);
    expect(p.fleet?.require_parent_covenant_subset).toBe(true);
    expect(p.remediation).toEqual({ max_retries: 3, cooldown_ms: 1000 });
    expect(p.knowledge?.chunk_size).toBe(500);
  });

  it("keeps explicit values over defaults", () => {
    const p = loadPolicy(
      writePolicy(
        "explicit.yaml",
        `${MINIMAL}
gates:
  - action: deploy
    approval: webhook
    risk_level: critical
    webhook_url: https://hooks.example.com/x
forbidden:
  - pattern: "rm -rf"
    reason: destructive
    severity: soft
trust:
  penalties:
    rate_limit: 1
scanners:
  urls:
    allowlist: [example.com]
`,
      ),
    );
    expect(p.gates).toEqual([
      {
        action: "deploy",
        approval: "webhook",
        risk_level: "critical",
        webhook_url: "https://hooks.example.com/x",
        timeout_ms: 30000,
      },
    ]);
    expect(p.forbidden).toEqual([{ pattern: "rm -rf", reason: "destructive", severity: "soft" }]);
    expect(p.trust?.penalties.rate_limit).toBe(1);
    expect(p.trust?.penalties.policy_violation).toBe(50);
    expect(p.scanners?.urls).toEqual({ enabled: true, severity: "soft", allowlist: ["example.com"], blocklist: [] });
  });

  it("rejects a document missing required fields with the issue paths", () => {
    const path = writePolicy("bad.yaml", `version: "1"\ncapabilities: []\nlimits: {}\nsession: {}\n`);
    expect(() => loadPolicy(path)).toThrow(/Invalid policy:[\s\S]*name:[\s\S]*session\.max_actions/);
  });

  it("rejects bad enum values inside arrays", () => {
    const path = writePolicy(
      "enum.yaml",
      `${MINIMAL}
gates:
  - action: x
    approval: email
    risk_level: low
`,
    );
    expect(() => loadPolicy(path)).toThrow(/gates\.0\.approval/);
  });

  it("rejects out-of-range numbers", () => {
    const path = writePolicy("range.yaml", `${MINIMAL}\ntrust:\n  initial_score: 5000\n`);
    expect(() => loadPolicy(path)).toThrow(/trust\.initial_score/);
  });

  it("surfaces YAML syntax errors and missing files", () => {
    expect(() => loadPolicy(writePolicy("broken.yaml", "name: [unclosed\n"))).toThrow();
    expect(() => loadPolicy(join(dir, "absent.yaml"))).toThrow(/ENOENT/);
  });

  it("rejects an empty document", () => {
    expect(() => loadPolicy(writePolicy("empty.yaml", ""))).toThrow(/Invalid policy/);
  });
});

describe("validatePolicy", () => {
  it("accepts an in-memory object", () => {
    const p = validatePolicy({
      version: "1",
      name: "mem",
      capabilities: [{ tool: "shell:exec", scope: { binaries: ["git"] } }],
      limits: { max_cost_usd: 2 },
      session: { max_actions: 3, rate_limit: { max_per_minute: 10 } },
    });
    expect(p.capabilities[0]?.scope).toEqual({ binaries: ["git"] });
    expect(p.limits.max_cost_usd).toBe(2);
    expect(p.session.rate_limit?.max_per_minute).toBe(10);
  });

  it("rejects non-object input", () => {
    expect(() => validatePolicy("policy")).toThrow(/Invalid policy/);
    expect(() => validatePolicy(null)).toThrow(/Invalid policy/);
  });
});
