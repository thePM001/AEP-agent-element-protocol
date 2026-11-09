import { describe, it, expect } from "vitest";
import { RecoveryEngine } from "../lib/engine.js";
import type { Violation } from "../lib/types.js";

const soft: Violation = { rule: "no-urls", severity: "soft", source: "scanner", details: "URL found" };
const hard: Violation = { rule: "no-secrets", severity: "hard", source: "scanner", details: "key found" };

function recorder(outputs: string[]) {
  const prompts: string[] = [];
  let i = 0;
  const regenerate = (prompt: string): string => {
    prompts.push(prompt);
    const out = outputs[Math.min(i, outputs.length - 1)] ?? "";
    i++;
    return out;
  };
  return { prompts, regenerate };
}

describe("RecoveryEngine.buildCorrectionPrompt", () => {
  it("names the source, rule and details", () => {
    const prompt = new RecoveryEngine({ maxAttempts: 1, enabled: true }).buildCorrectionPrompt(soft);
    expect(prompt).toContain("Violation type: scanner");
    expect(prompt).toContain("Rule: no-urls");
    expect(prompt).toContain("Details: URL found");
    expect(prompt.split("\n")[0]).toBe("Your previous output was flagged for a soft violation.");
  });
});

describe("RecoveryEngine.attemptRecovery", () => {
  it("does nothing when recovery is disabled", () => {
    const { prompts, regenerate } = recorder(["clean"]);
    const result = new RecoveryEngine({ maxAttempts: 3, enabled: false }).attemptRecovery(soft, regenerate, () => null);
    expect(result).toEqual({ recovered: false, attempts: [] });
    expect(prompts).toEqual([]);
  });

  it("never retries a hard violation", () => {
    const { prompts, regenerate } = recorder(["clean"]);
    const result = new RecoveryEngine({ maxAttempts: 3, enabled: true }).attemptRecovery(hard, regenerate, () => null);
    expect(result).toEqual({ recovered: false, attempts: [] });
    expect(prompts).toEqual([]);
  });

  it("recovers on the first clean regeneration", () => {
    const { prompts, regenerate } = recorder(["clean output"]);
    const result = new RecoveryEngine({ maxAttempts: 3, enabled: true }).attemptRecovery(soft, regenerate, () => null);
    expect(result.recovered).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ attemptNumber: 1, violation: soft, newOutput: "clean output", result: "recovered" });
    expect(Object.values(result)).toContain("clean output");
    expect(prompts).toHaveLength(1);
  });

  it("retries with the latest violation until the output is clean", () => {
    const second: Violation = { rule: "tone", severity: "soft", source: "policy", details: "too pushy" };
    const { prompts, regenerate } = recorder(["still bad", "good"]);
    const validate = (out: string): Violation | null => (out === "good" ? null : second);
    const result = new RecoveryEngine({ maxAttempts: 3, enabled: true }).attemptRecovery(soft, regenerate, validate);

    expect(result.recovered).toBe(true);
    expect(result.attempts.map((a) => [a.attemptNumber, a.result, a.violation.rule])).toEqual([
      [1, "failed", "no-urls"],
      [2, "recovered", "tone"],
    ]);
    expect(prompts[1]).toContain("Rule: tone");
    expect(Object.values(result)).toContain("good");
  });

  it("gives up after maxAttempts and returns no output", () => {
    const { prompts, regenerate } = recorder(["bad"]);
    const result = new RecoveryEngine({ maxAttempts: 2, enabled: true }).attemptRecovery(soft, regenerate, () => soft);
    expect(result.recovered).toBe(false);
    expect(result.attempts.map((a) => a.result)).toEqual(["failed", "failed"]);
    expect(Object.keys(result).sort()).toEqual(["attempts", "recovered"]);
    expect(prompts).toHaveLength(2);
  });

  it("makes no attempt when maxAttempts is zero", () => {
    const { prompts, regenerate } = recorder(["clean"]);
    const result = new RecoveryEngine({ maxAttempts: 0, enabled: true }).attemptRecovery(soft, regenerate, () => null);
    expect(result).toEqual({ recovered: false, attempts: [] });
    expect(prompts).toEqual([]);
  });
});

describe("RecoveryEngine.getConfig", () => {
  it("returns a copy", () => {
    const engine = new RecoveryEngine({ maxAttempts: 2, enabled: true });
    const cfg = engine.getConfig();
    cfg.maxAttempts = 99;
    expect(engine.getConfig()).toEqual({ maxAttempts: 2, enabled: true });
  });
});
