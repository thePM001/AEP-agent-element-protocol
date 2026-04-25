import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { RecoveryEngine } from "../../src/recovery/engine.js";
import type { Violation, RecoveryConfig } from "../../src/recovery/types.js";
import { AgentGateway } from "../../src/gateway.js";
import type { Policy } from "../../src/policy/types.js";

describe("RecoveryEngine", () => {
  describe("buildCorrectionPrompt", () => {
    it("includes violation details in correction prompt", () => {
      const engine = new RecoveryEngine({ enabled: true, maxAttempts: 2 });
      const violation: Violation = {
        rule: "toxicity:threat",
        severity: "soft",
        source: "scanner",
        details: 'Scanner "toxicity" found: threatening language',
      };

      const prompt = engine.buildCorrectionPrompt(violation);
      expect(prompt).toContain("soft violation");
      expect(prompt).toContain("scanner");
      expect(prompt).toContain("toxicity:threat");
      expect(prompt).toContain("threatening language");
      expect(prompt).toContain("Regenerate");
    });
  });

  describe("attemptRecovery", () => {
    it("returns immediately for hard violations without attempting recovery", () => {
      const engine = new RecoveryEngine({ enabled: true, maxAttempts: 2 });
      const violation: Violation = {
        rule: "injection:sql",
        severity: "hard",
        source: "scanner",
        details: "SQL injection detected",
      };

      const result = engine.attemptRecovery(
        violation,
        () => "clean output",
        () => null
      );

      expect(result.recovered).toBe(false);
      expect(result.attempts).toHaveLength(0);
    });

    it("returns immediately when engine is disabled", () => {
      const engine = new RecoveryEngine({ enabled: false, maxAttempts: 2 });
      const violation: Violation = {
        rule: "toxicity:custom_word",
        severity: "soft",
        source: "scanner",
        details: "Bad word found",
      };

      const result = engine.attemptRecovery(
        violation,
        () => "clean output",
        () => null
      );

      expect(result.recovered).toBe(false);
      expect(result.attempts).toHaveLength(0);
    });

    it("recovers on first attempt when regeneration produces clean output", () => {
      const engine = new RecoveryEngine({ enabled: true, maxAttempts: 2 });
      const violation: Violation = {
        rule: "toxicity:custom_word",
        severity: "soft",
        source: "scanner",
        details: "Bad word detected",
      };

      const result = engine.attemptRecovery(
        violation,
        (_prompt) => "clean and safe output",
        (_output) => null // No violation in new output
      );

      expect(result.recovered).toBe(true);
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].result).toBe("recovered");
      expect(result.finalOutput).toBe("clean and safe output");
    });

    it("recovers on second attempt when first regeneration still fails", () => {
      const engine = new RecoveryEngine({ enabled: true, maxAttempts: 2 });
      const violation: Violation = {
        rule: "url:detected",
        severity: "soft",
        source: "scanner",
        details: "URL found in output",
      };

      let callCount = 0;
      const result = engine.attemptRecovery(
        violation,
        (_prompt) => {
          callCount++;
          return callCount === 1 ? "still has http://example.com" : "no links here";
        },
        (output) => {
          if (output.includes("http://")) {
            return {
              rule: "url:detected",
              severity: "soft",
              source: "scanner",
              details: "URL still present",
            };
          }
          return null;
        }
      );

      expect(result.recovered).toBe(true);
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0].result).toBe("failed");
      expect(result.attempts[1].result).toBe("recovered");
      expect(result.finalOutput).toBe("no links here");
    });

    it("exhausts all attempts and returns failed when recovery never succeeds", () => {
      const engine = new RecoveryEngine({ enabled: true, maxAttempts: 2 });
      const violation: Violation = {
        rule: "toxicity:custom_word",
        severity: "soft",
        source: "scanner",
        details: "Bad word found",
      };

      const result = engine.attemptRecovery(
        violation,
        (_prompt) => "still bad content",
        (_output) => ({
          rule: "toxicity:custom_word",
          severity: "soft" as const,
          source: "scanner" as const,
          details: "Still bad",
        })
      );

      expect(result.recovered).toBe(false);
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0].result).toBe("failed");
      expect(result.attempts[1].result).toBe("failed");
      expect(result.finalOutput).toBeUndefined();
    });

    it("respects maxAttempts configuration", () => {
      const engine = new RecoveryEngine({ enabled: true, maxAttempts: 5 });
      const violation: Violation = {
        rule: "toxicity:custom_word",
        severity: "soft",
        source: "scanner",
        details: "Bad word found",
      };

      const result = engine.attemptRecovery(
        violation,
        () => "still bad",
        () => ({
          rule: "toxicity:custom_word",
          severity: "soft" as const,
          source: "scanner" as const,
          details: "Still bad",
        })
      );

      expect(result.attempts).toHaveLength(5);
    });

    it("re-adjudicates through full validation on each attempt", () => {
      const engine = new RecoveryEngine({ enabled: true, maxAttempts: 3 });
      const violation: Violation = {
        rule: "toxicity:custom_word",
        severity: "soft",
        source: "scanner",
        details: "Bad word found",
      };

      let validateCalls = 0;
      const result = engine.attemptRecovery(
        violation,
        () => "output",
        (_output) => {
          validateCalls++;
          if (validateCalls < 3) {
            return {
              rule: "toxicity:custom_word",
              severity: "soft" as const,
              source: "scanner" as const,
              details: "Still bad",
            };
          }
          return null; // Clean on third attempt
        }
      );

      expect(validateCalls).toBe(3);
      expect(result.recovered).toBe(true);
    });
  });

  describe("getConfig", () => {
    it("returns a copy of the configuration", () => {
      const config: RecoveryConfig = { enabled: true, maxAttempts: 3 };
      const engine = new RecoveryEngine(config);
      const retrieved = engine.getConfig();
      expect(retrieved).toEqual(config);
      expect(retrieved).not.toBe(config);
    });
  });
});

describe("Recovery integration with Gateway", () => {
  const TEST_DIR = join(
    import.meta.dirname ?? __dirname,
    "../../.test-recovery-ledgers"
  );

  function makePolicy(overrides?: Partial<Policy>): Policy {
    return {
      version: "2.5",
      name: "recovery-test",
      capabilities: [{ tool: "file:read", scope: { paths: ["src/**"] } }],
      limits: {},
      session: { max_actions: 100 },
      evidence: { enabled: true, dir: TEST_DIR },
      trust: { initial_score: 500 },
      recovery: { enabled: true, max_attempts: 2 },
      scanners: {
        enabled: true,
        pii: { enabled: true, severity: "hard" },
        injection: { enabled: true, severity: "hard" },
        secrets: { enabled: true, severity: "hard" },
        jailbreak: { enabled: true, severity: "hard" },
        toxicity: { enabled: true, severity: "soft", custom_words: ["badword"] },
        urls: { enabled: true, severity: "soft", allowlist: [], blocklist: [] },
      },
      ...overrides,
    } as Policy;
  }

  let gateway: AgentGateway;
  let sessionId: string;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    gateway = new AgentGateway({ ledgerDir: TEST_DIR });
    const session = gateway.createSessionFromPolicy(makePolicy());
    sessionId = session.id;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("soft violation triggers recovery attempt and recovers", () => {
    let callCount = 0;
    const result = gateway.scanContent(
      sessionId,
      "here is a badword in output",
      (_prompt) => {
        callCount++;
        return "here is clean output";
      }
    );

    expect(result.passed).toBe(true);
    expect(callCount).toBe(1);
    expect(result.recoveredOutput).toBe("here is clean output");
  });

  it("hard violation rejects immediately without recovery", () => {
    let regenerateCalled = false;
    const result = gateway.scanContent(
      sessionId,
      "here is user@example.com in output",
      () => {
        regenerateCalled = true;
        return "clean";
      }
    );

    expect(result.passed).toBe(false);
    expect(regenerateCalled).toBe(false);
    expect(result.findings.some((f) => f.scanner === "pii")).toBe(true);
  });

  it("recovery exhausted escalates to hard reject", () => {
    const result = gateway.scanContent(
      sessionId,
      "here is a badword in output",
      () => "still has badword here"
    );

    expect(result.passed).toBe(false);
  });

  it("trust score decreases by 10 on successful recovery", () => {
    const trustBefore = gateway.getTrustManager(sessionId)!.getScore();

    gateway.scanContent(
      sessionId,
      "here is a badword in output",
      () => "clean output"
    );

    const trustAfter = gateway.getTrustManager(sessionId)!.getScore();
    // -50 (default penalize) + 40 (offset) = -10 net
    expect(trustBefore - trustAfter).toBe(10);
  });

  it("trust score decreases by 50 on exhausted recovery", () => {
    const trustBefore = gateway.getTrustManager(sessionId)!.getScore();

    gateway.scanContent(
      sessionId,
      "here is a badword in output",
      () => "still has badword"
    );

    const trustAfter = gateway.getTrustManager(sessionId)!.getScore();
    // -50 for policy_violation
    expect(trustBefore - trustAfter).toBe(50);
  });

  it("ledger logs recovery:attempt, recovery:success and recovery:exhausted", () => {
    // Successful recovery
    gateway.scanContent(
      sessionId,
      "here is a badword",
      () => "clean text"
    );

    const ledger = gateway.getLedger(sessionId)!;
    const entries = ledger.entries();
    const types = entries.map((e) => e.type);

    expect(types).toContain("scanner:finding");
    expect(types).toContain("recovery:attempt");
    expect(types).toContain("recovery:success");
  });

  it("ledger logs recovery:exhausted when all attempts fail", () => {
    gateway.scanContent(
      sessionId,
      "here is a badword",
      () => "still badword"
    );

    const ledger = gateway.getLedger(sessionId)!;
    const entries = ledger.entries();
    const types = entries.map((e) => e.type);

    expect(types).toContain("recovery:exhausted");
  });

  it("attemptRecovery works for covenant violations", () => {
    const gw = new AgentGateway({ ledgerDir: TEST_DIR });
    const s = gw.createSessionFromPolicy(
      makePolicy({
        recovery: { enabled: true, max_attempts: 2 },
      })
    );

    const violation = {
      rule: "covenant:forbid:file:delete",
      severity: "soft" as const,
      source: "covenant" as const,
      details: "Covenant forbids file:delete",
    };

    const result = gw.attemptRecovery(
      s.id,
      violation,
      () => "clean output with no forbidden action",
      (output) => {
        if (output.includes("file:delete")) {
          return violation;
        }
        return null;
      }
    );

    expect(result.recovered).toBe(true);
  });
});
