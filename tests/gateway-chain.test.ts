// Tests for AEP 2.5 Gateway 15-Step Evaluation Chain
// Covers: evaluate(), scanContent(), knowledge retrieval validation

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { AgentGateway } from "../src/gateway.js";
import type { Policy, AgentAction } from "../src/policy/types.js";

const TEST_LEDGER_DIR = resolve(".test-ledger-" + process.pid);

const BASE_POLICY: Policy = {
  version: "2.5",
  name: "test-policy",
  capabilities: [
    { tool: "file:read", scope: { paths: ["src/**"] } },
    { tool: "file:write", scope: { paths: ["src/**"] } },
    { tool: "command:run", scope: { binaries: ["npm", "node"] } },
    { tool: "knowledge:query" },
    { tool: "knowledge:retrieve" },
  ],
  limits: {
    max_runtime_ms: 60000,
    max_files_changed: 10,
    max_aep_mutations: 20,
  },
  gates: [],
  forbidden: [
    { pattern: "\\.env", reason: "Environment files" },
    { pattern: "rm -rf", reason: "Destructive operation" },
  ],
  session: {
    max_actions: 50,
    max_denials: 10,
    rate_limit: { max_per_minute: 30 },
    escalation: [],
  },
  trust: {
    initial_score: 500,
    decay_rate: 5,
    penalties: {
      policy_violation: 50,
      structural_violation: 30,
      rate_limit: 10,
      forbidden_match: 100,
      intent_drift: 75,
    },
    rewards: {
      successful_action: 5,
      successful_rollback: 10,
    },
  },
  ring: { default: 2 },
  intent: {
    tracking: true,
    drift_threshold: 0.5,
    warmup_actions: 10,
    on_drift: "warn",
  },
  system: {
    max_actions_per_minute: 200,
    max_concurrent_sessions: 10,
  },
  scanners: {
    enabled: true,
    pii: { enabled: true, severity: "hard" },
    injection: { enabled: true, severity: "hard" },
    secrets: { enabled: true, severity: "hard" },
    jailbreak: { enabled: true, severity: "hard" },
    toxicity: { enabled: true, severity: "soft" },
    urls: { enabled: true, severity: "soft" },
  },
  knowledge: {
    enabled: true,
    bases: [],
    chunk_size: 500,
    max_retrieval_chunks: 10,
    anti_context_rot: true,
    double_scan: true,
  },
};

describe("Gateway 15-Step Evaluation Chain", () => {
  let gateway: AgentGateway;

  beforeEach(() => {
    if (!existsSync(TEST_LEDGER_DIR)) {
      mkdirSync(TEST_LEDGER_DIR, { recursive: true });
    }
    gateway = new AgentGateway({ ledgerDir: TEST_LEDGER_DIR });
  });

  afterEach(() => {
    if (existsSync(TEST_LEDGER_DIR)) {
      rmSync(TEST_LEDGER_DIR, { recursive: true, force: true });
    }
  });

  it("allows a valid file:read action", () => {
    const session = gateway.createSessionFromPolicy(BASE_POLICY);
    const action: AgentAction = {
      tool: "file:read",
      input: { path: "src/index.ts" },
    };

    const verdict = gateway.evaluate(session.id, action);
    expect(verdict.decision).toBe("allow");
  });

  it("denies a forbidden pattern match", () => {
    const session = gateway.createSessionFromPolicy(BASE_POLICY);
    const action: AgentAction = {
      tool: "command:run",
      input: { command: "rm -rf /tmp" },
    };

    const verdict = gateway.evaluate(session.id, action);
    expect(verdict.decision).toBe("deny");
    expect(verdict.reasons.some((r) => r.toLowerCase().includes("forbidden"))).toBe(true);
  });

  it("denies actions outside capability scope", () => {
    const session = gateway.createSessionFromPolicy(BASE_POLICY);
    const action: AgentAction = {
      tool: "file:delete",
      input: { path: "src/index.ts" },
    };

    const verdict = gateway.evaluate(session.id, action);
    // file:delete is not in capabilities, should be denied
    expect(verdict.decision).not.toBe("allow");
  });

  it("enforces session action limits", () => {
    const limitPolicy: Policy = {
      ...BASE_POLICY,
      session: { max_actions: 3, max_denials: 10, rate_limit: { max_per_minute: 100 }, escalation: [] },
    };
    const session = gateway.createSessionFromPolicy(limitPolicy);

    const action: AgentAction = {
      tool: "file:read",
      input: { path: "src/index.ts" },
    };

    // Allow first actions
    gateway.evaluate(session.id, action);
    gateway.evaluate(session.id, action);
    gateway.evaluate(session.id, action);

    // Fourth should be denied (session exhausted)
    const verdict = gateway.evaluate(session.id, action);
    expect(verdict.decision).toBe("deny");
  });

  it("Step 13: denies knowledge retrieval without query", () => {
    const session = gateway.createSessionFromPolicy(BASE_POLICY);
    const action: AgentAction = {
      tool: "knowledge:retrieve",
      input: { query: "" },
    };

    const verdict = gateway.evaluate(session.id, action);
    expect(verdict.decision).toBe("deny");
    expect(verdict.reasons.some((r) => r.toLowerCase().includes("query"))).toBe(true);
  });

  it("Step 13: allows knowledge retrieval with valid query", () => {
    const session = gateway.createSessionFromPolicy(BASE_POLICY);
    const action: AgentAction = {
      tool: "knowledge:retrieve",
      input: { query: "how does trust scoring work" },
    };

    const verdict = gateway.evaluate(session.id, action);
    expect(verdict.decision).toBe("allow");
  });

  it("Step 14: scanContent rejects hard scanner matches", () => {
    const session = gateway.createSessionFromPolicy(BASE_POLICY);
    // Content with a secret (AWS key pattern)
    const result = gateway.scanContent(
      session.id,
      "The key is AKIAIOSFODNN7EXAMPLE and must be rotated."
    );
    expect(result.passed).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("Step 14: scanContent passes clean content", () => {
    const session = gateway.createSessionFromPolicy(BASE_POLICY);
    const result = gateway.scanContent(
      session.id,
      "This is a normal response about governance and policy evaluation."
    );
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("creates session with knowledge manager when knowledge is enabled", () => {
    const session = gateway.createSessionFromPolicy(BASE_POLICY);
    expect(session.id).toBeTruthy();

    // Verify knowledge retrieval actions pass through the chain
    const action: AgentAction = {
      tool: "knowledge:retrieve",
      input: { query: "test query" },
    };
    const verdict = gateway.evaluate(session.id, action);
    expect(verdict.decision).toBe("allow");
  });

  it("skips knowledge validation when knowledge is disabled", () => {
    const noKnowledgePolicy: Policy = {
      ...BASE_POLICY,
      knowledge: { enabled: false },
    };
    const session = gateway.createSessionFromPolicy(noKnowledgePolicy);

    // Without knowledge manager, Step 13 is skipped entirely.
    // An empty query will still be allowed since the knowledge check is not active.
    const action: AgentAction = {
      tool: "knowledge:retrieve",
      input: { query: "" },
    };
    const verdict = gateway.evaluate(session.id, action);
    // Should be allowed since Step 13 is not active
    expect(verdict.decision).toBe("allow");
  });
});

describe("Gateway Session Lifecycle", () => {
  let gateway: AgentGateway;

  beforeEach(() => {
    if (!existsSync(TEST_LEDGER_DIR)) {
      mkdirSync(TEST_LEDGER_DIR, { recursive: true });
    }
    gateway = new AgentGateway({ ledgerDir: TEST_LEDGER_DIR });
  });

  afterEach(() => {
    if (existsSync(TEST_LEDGER_DIR)) {
      rmSync(TEST_LEDGER_DIR, { recursive: true, force: true });
    }
  });

  it("creates sessions with unique IDs", () => {
    const s1 = gateway.createSessionFromPolicy(BASE_POLICY);
    const s2 = gateway.createSessionFromPolicy(BASE_POLICY);
    expect(s1.id).not.toBe(s2.id);
  });

  it("enforces max concurrent sessions", () => {
    const oneSessionPolicy: Policy = {
      ...BASE_POLICY,
      system: { max_actions_per_minute: 200, max_concurrent_sessions: 1 },
    };

    gateway.createSessionFromPolicy(oneSessionPolicy);
    // Second session should throw
    expect(() => gateway.createSessionFromPolicy(oneSessionPolicy)).toThrow(
      /concurrent/i
    );
  });

  it("getSession returns session for valid ID", () => {
    const session = gateway.createSessionFromPolicy(BASE_POLICY);
    const retrieved = gateway.getSession(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(session.id);
  });

  it("getSession returns null for invalid ID", () => {
    const retrieved = gateway.getSession("nonexistent-session");
    expect(retrieved).toBeNull();
  });
});
