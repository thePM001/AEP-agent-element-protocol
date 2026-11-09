import { describe, it, expect } from "vitest";
import { IntentDriftDetector } from "../lib/detector.js";

function warm(detector: IntentDriftDetector, actions: Array<[string, Record<string, unknown>]>): void {
  for (const [tool, input] of actions) {
    const score = detector.recordAction(tool, input);
    expect(score).toEqual({ score: 0, factors: [], isWarmup: true });
  }
}

describe("IntentDriftDetector warmup", () => {
  it("reports warmup scores and locks the baseline after the warmup count", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 3 });
    expect(detector.isWarmedUp()).toBe(false);
    warm(detector, [
      ["fs:read", { id: "doc-1" }],
      ["fs:write", { path: "src/a.ts" }],
    ]);
    expect(detector.isWarmedUp()).toBe(false);
    warm(detector, [["fs:read", { id: "doc-2" }]]);
    expect(detector.isWarmedUp()).toBe(true);

    const baseline = detector.getBaseline();
    expect(baseline.actionCount).toBe(3);
    expect(baseline.locked).toBe(true);
    expect([...baseline.toolCategories]).toEqual([["fs", 3]]);
    expect([...baseline.targetPrefixes].sort()).toEqual([
      ["doc", 2],
      ["src", 1],
    ]);
  });

  it("defaults to a warmup of ten actions", () => {
    const detector = new IntentDriftDetector();
    for (let i = 0; i < 9; i++) detector.recordAction("fs:read", {});
    expect(detector.isWarmedUp()).toBe(false);
    detector.recordAction("fs:read", {});
    expect(detector.isWarmedUp()).toBe(true);
    expect(detector.recordAction("fs:read", {}).isWarmup).toBe(false);
  });

  it("getBaseline returns copies of the maps", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 1 });
    detector.recordAction("fs:read", { id: "doc-1" });
    detector.getBaseline().toolCategories.set("net", 5);
    expect(detector.getBaseline().toolCategories.has("net")).toBe(false);
  });
});

describe("IntentDriftDetector drift", () => {
  it("scores zero for in-baseline behaviour", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 3 });
    warm(detector, [
      ["fs:read", { id: "doc-1" }],
      ["fs:read", { id: "doc-2" }],
      ["fs:read", { id: "doc-3" }],
    ]);
    expect(detector.recordAction("fs:read", { id: "doc-4" })).toEqual({ score: 0, factors: [], isWarmup: false });
  });

  it("adds weight for a new tool category and a new target prefix", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 3 });
    warm(detector, [
      ["fs:read", { id: "doc-1" }],
      ["fs:read", { id: "doc-2" }],
      ["fs:read", { id: "doc-3" }],
    ]);
    const drift = detector.recordAction("net:fetch", { target: "billing-api" });
    expect(drift.isWarmup).toBe(false);
    expect(drift.score).toBeCloseTo(0.5);
    expect(drift.factors).toEqual([
      'New tool category: "net" not in baseline',
      'New target prefix: "billing" not in baseline',
    ]);
  });

  it("detects frequency anomalies and repetition", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 10 });
    for (let i = 0; i < 9; i++) detector.recordAction("fs:read", {});
    detector.recordAction("net:fetch", {});
    let drift = detector.recordAction("net:fetch", {});
    for (let i = 0; i < 5; i++) drift = detector.recordAction("net:fetch", {});

    expect(drift.score).toBeCloseTo(0.35);
    expect(drift.factors).toHaveLength(2);
    expect(drift.factors[0]).toMatch(/^Frequency anomaly: "net" at 70% vs baseline 10%$/);
    expect(drift.factors[1]).toBe('Repetition detected: same tool "net" for 5 consecutive actions');
  });

  it("combines every factor for a repeated new tool on a new target", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 2 });
    warm(detector, [
      ["fs:read", { id: "doc-1" }],
      ["fs:read", { id: "doc-2" }],
    ]);
    let drift = detector.recordAction("shell:run", { id: "prod-1" });
    for (let i = 0; i < 4; i++) drift = detector.recordAction("shell:run", { id: "prod-1" });
    // new category 0.3 + new target 0.2 + frequency 0.15 + repetition 0.2
    expect(drift.score).toBeCloseTo(0.85);
    expect(drift.factors).toHaveLength(4);
  });

  it("derives target prefixes from id, elementId, target or path", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 4 });
    detector.recordAction("ui:click", { elementId: "btn-ok" });
    detector.recordAction("fs:read", { path: "docs/readme.txt" });
    detector.recordAction("fs:read", { path: "/abs/file" });
    detector.recordAction("fs:read", { id: "nodash", path: "lib/x.ts" });
    expect([...detector.getBaseline().targetPrefixes.keys()].sort()).toEqual(["btn", "docs", "lib"]);
  });
});
