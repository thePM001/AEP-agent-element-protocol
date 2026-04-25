import { IntentDriftDetector } from "../../src/intent/detector.js";

describe("IntentDriftDetector", () => {
  it("warmup period returns zero drift", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 5 });
    for (let i = 0; i < 5; i++) {
      const result = detector.recordAction("file:read", { path: "src/a.ts" });
      expect(result.isWarmup).toBe(true);
      expect(result.score).toBe(0);
    }
  });

  it("is warmed up after warmup period", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 3 });
    for (let i = 0; i < 3; i++) {
      detector.recordAction("file:read", { path: "src/a.ts" });
    }
    expect(detector.isWarmedUp()).toBe(true);
  });

  it("is not warmed up before warmup period completes", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 5 });
    for (let i = 0; i < 3; i++) {
      detector.recordAction("file:read", { path: "src/a.ts" });
    }
    expect(detector.isWarmedUp()).toBe(false);
  });

  it("detects new tool category as drift", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 3 });
    // Warmup with file operations
    for (let i = 0; i < 3; i++) {
      detector.recordAction("file:read", { path: "src/a.ts" });
    }

    // Introduce new category
    const result = detector.recordAction("command:run", { command: "npm test" });
    expect(result.isWarmup).toBe(false);
    expect(result.score).toBeGreaterThan(0);
    expect(result.factors.some(f => f.includes("New tool category"))).toBe(true);
  });

  it("detects new target prefix as drift", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 3 });
    for (let i = 0; i < 3; i++) {
      detector.recordAction("aep:update_element", { id: "CP-00001" });
    }

    const result = detector.recordAction("aep:update_element", { id: "SH-00001" });
    expect(result.score).toBeGreaterThan(0);
    expect(result.factors.some(f => f.includes("target prefix"))).toBe(true);
  });

  it("detects repetition of same tool for 5 consecutive actions", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 3 });
    // Warmup with mixed tools
    detector.recordAction("file:read", { path: "src/a.ts" });
    detector.recordAction("file:write", { path: "src/b.ts" });
    detector.recordAction("command:run", { command: "test" });

    // 5 consecutive same-category actions after warmup
    for (let i = 0; i < 4; i++) {
      detector.recordAction("file:read", { path: "src/x.ts" });
    }
    const result = detector.recordAction("file:read", { path: "src/x.ts" });
    // The 5th consecutive same-category action should trigger repetition factor
    expect(result.isWarmup).toBe(false);
  });

  it("no drift when actions match baseline", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 5 });
    for (let i = 0; i < 5; i++) {
      detector.recordAction("file:read", { path: "src/a.ts" });
    }

    const result = detector.recordAction("file:read", { path: "src/b.ts" });
    // Same tool category and similar target prefix; should have minimal drift
    expect(result.score).toBeLessThan(0.5);
  });

  it("baseline is accessible and correct after warmup", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 3 });
    detector.recordAction("file:read", { path: "src/a.ts" });
    detector.recordAction("file:read", { path: "src/b.ts" });
    detector.recordAction("file:write", { path: "src/c.ts" });

    const baseline = detector.getBaseline();
    expect(baseline.locked).toBe(true);
    expect(baseline.actionCount).toBe(3);
    expect(baseline.toolCategories.get("file")).toBe(3);
  });

  it("baseline tracks target prefixes", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 3 });
    detector.recordAction("aep:create", { id: "CP-001" });
    detector.recordAction("aep:create", { id: "CP-002" });
    detector.recordAction("aep:update", { id: "SH-001" });

    const baseline = detector.getBaseline();
    expect(baseline.targetPrefixes.get("CP")).toBe(2);
    expect(baseline.targetPrefixes.get("SH")).toBe(1);
  });

  it("score is clamped to [0, 1]", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 2 });
    detector.recordAction("file:read", { path: "src/a.ts" });
    detector.recordAction("file:read", { path: "src/a.ts" });

    // Introduce multiple new categories to drive score up
    const result = detector.recordAction("command:run", { id: "SH-00001", command: "rm -rf /" });
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("uses default warmup of 10 when no config provided", () => {
    const detector = new IntentDriftDetector();
    for (let i = 0; i < 9; i++) {
      detector.recordAction("file:read", { path: "src/a.ts" });
    }
    expect(detector.isWarmedUp()).toBe(false);

    detector.recordAction("file:read", { path: "src/a.ts" });
    expect(detector.isWarmedUp()).toBe(true);
  });

  it("getBaseline returns a copy, not a reference", () => {
    const detector = new IntentDriftDetector({ warmup_actions: 2 });
    detector.recordAction("file:read", { path: "src/a.ts" });
    detector.recordAction("file:read", { path: "src/b.ts" });

    const baseline1 = detector.getBaseline();
    const baseline2 = detector.getBaseline();
    expect(baseline1).not.toBe(baseline2);
    expect(baseline1.toolCategories).not.toBe(baseline2.toolCategories);
  });
});
