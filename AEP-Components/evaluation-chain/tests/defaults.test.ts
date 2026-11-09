import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_STEP_ACTIVATION_PROFILE, ALWAYS_MODE_STEPS, ACTIVE_MODE_STEPS } from "../lib/defaults.js";
import { StepActivationMode } from "../lib/types.js";

// Step names as declared in the Rust crate (STEP_NAMES), read as text.
function rustStepNames(): string[] {
  const src = readFileSync(fileURLToPath(new URL("../crate/src/lib.rs", import.meta.url)), "utf-8");
  const block = src.match(/pub const STEP_NAMES: \[&str; CHAIN_STEP_COUNT\] = \[([\s\S]*?)\];/);
  expect(block).not.toBeNull();
  return [...(block?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1] ?? "");
}

describe("DEFAULT_STEP_ACTIVATION_PROFILE", () => {
  const steps = DEFAULT_STEP_ACTIVATION_PROFILE.steps;

  it("has 15 steps numbered 0..14 in order", () => {
    expect(steps.map((s) => s.step)).toEqual(Array.from({ length: 15 }, (_, i) => i));
  });

  it("matches the Rust crate step names", () => {
    expect(steps.map((s) => s.name)).toEqual(rustStepNames());
  });

  it("step 2 is gap_capability and always runs", () => {
    expect(steps[2]).toEqual({ step: 2, name: "gap_capability", mode: StepActivationMode.ALWAYS });
  });

  it("gives every ACTIVE step a precondition and no ALWAYS step one", () => {
    for (const s of steps) {
      if (s.mode === StepActivationMode.ACTIVE) {
        expect(typeof s.precondition, s.name).toBe("string");
        expect(s.precondition?.length ?? 0).toBeGreaterThan(0);
      } else {
        expect(s.mode).toBe(StepActivationMode.ALWAYS);
        expect("precondition" in s, s.name).toBe(false);
      }
    }
  });

  it("does not force preconditions by default", () => {
    expect(DEFAULT_STEP_ACTIVATION_PROFILE.force_all_preconditions).toBe(false);
  });

  it("mode step lists agree with the profile and partition all steps", () => {
    const always = steps.filter((s) => s.mode === StepActivationMode.ALWAYS).map((s) => s.step);
    const active = steps.filter((s) => s.mode === StepActivationMode.ACTIVE).map((s) => s.step);
    expect(ALWAYS_MODE_STEPS).toEqual(always);
    expect(ACTIVE_MODE_STEPS).toEqual(active);
    expect([...ALWAYS_MODE_STEPS, ...ACTIVE_MODE_STEPS].sort((a, b) => a - b)).toEqual(steps.map((s) => s.step));
  });

  it("uses the wire strings always and active for modes", () => {
    expect(StepActivationMode.ALWAYS).toBe("always");
    expect(StepActivationMode.ACTIVE).toBe("active");
  });
});
