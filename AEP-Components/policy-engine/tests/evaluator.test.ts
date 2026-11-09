import { afterEach, describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { PolicyEvaluator, labPolicyEvaluatorEnabled } from "../lib/policy/evaluator.js";
import { validatePolicy } from "../lib/policy/loader.js";
import type { AgentAction, Policy } from "../lib/policy/types.js";
import { Session } from "../../session/lib/session.js";
import { IntentDriftDetector } from "../../intent/lib/detector.js";
import type { DriftScore } from "../../intent/lib/detector.js";
import { ScannerPipeline } from "../../scanners/lib/pipeline.js";
import type { Finding, Scanner } from "../../scanners/lib/types.js";

const savedEnv = new Map<string, string | undefined>();

/** Sets an environment variable for one test; restoreEnv puts the old value back. */
function setEnv(name: string, value: string): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  process.env[name] = value;
}

function restoreEnv(): void {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
}

afterEach(() => {
  restoreEnv();
});

function policy(extra: Record<string, unknown> = {}): Policy {
  return validatePolicy({
    version: "1",
    name: "eval-test",
    capabilities: [{ tool: "*" }],
    limits: {},
    session: { max_actions: 100 },
    scanners: { enabled: false },
    ...extra,
  });
}

function active(p: Policy): Session {
  const s = new Session(p);
  s.activate();
  return s;
}

function act(tool: string, input: Record<string, unknown> = {}, extra: Partial<AgentAction> = {}): AgentAction {
  return { tool, input, timestamp: new Date(), ...extra };
}

function decide(p: Policy, a: AgentAction, s: Session = active(p)): string {
  return new PolicyEvaluator(p).evaluate(a, s).decision;
}

class FixedDrift extends IntentDriftDetector {
  constructor(private readonly result: DriftScore) {
    super();
  }
  override recordAction(): DriftScore {
    return this.result;
  }
}

class WordScanner implements Scanner {
  readonly name = "word";
  constructor(private readonly word: string, private readonly severity: "hard" | "soft") {}
  scan(content: string): Finding[] {
    const i = content.indexOf(this.word);
    return i < 0 ? [] : [{ scanner: "word", category: "w", severity: this.severity, match: this.word, position: i }];
  }
}

describe("PolicyEvaluator session state", () => {
  it("allows a permitted action and records it on the session", () => {
    const p = policy();
    const s = active(p);
    const v = new PolicyEvaluator(p).evaluate(act("file:read"), s);
    expect(v.decision).toBe("allow");
    expect(v.reasons).toEqual(["Action permitted by policy."]);
    expect(v.matchedCapability).toEqual({ tool: "*", scope: {} });
    expect(v.actionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.stats.actionsAllowed).toBe(1);
    expect(s.stats.actionsEvaluated).toBe(1);
  });

  it("denies before activation, while paused and after termination", () => {
    const p = policy();
    const ev = new PolicyEvaluator(p);
    const s = new Session(p);
    expect(ev.evaluate(act("x"), s).reasons[0]).toMatch(/not activated/);
    s.activate();
    s.pause();
    expect(ev.evaluate(act("x"), s).reasons[0]).toMatch(/paused/);
    s.terminate("done");
    expect(ev.evaluate(act("x"), s).reasons[0]).toBe("Session is terminated.");
    expect(s.stats.actionsDenied).toBe(3);
  });

  it("denies once the action limit is reached", () => {
    const p = policy({ session: { max_actions: 2 } });
    const ev = new PolicyEvaluator(p);
    const s = active(p);
    expect(ev.evaluate(act("a"), s).decision).toBe("allow");
    expect(ev.evaluate(act("a"), s).decision).toBe("allow");
    const v = ev.evaluate(act("a"), s);
    expect(v.decision).toBe("deny");
    expect(v.reasons[0]).toBe("Action limit exceeded: 2 >= 2.");
  });

  it("denies lab-only action_path unless the lab flag is on", () => {
    setEnv("AEP_LAB_POLICY_EVALUATOR", "");
    const p = policy();
    expect(labPolicyEvaluatorEnabled()).toBe(false);
    const v = new PolicyEvaluator(p).evaluate(act("x", { action_path: "a/b" }), active(p));
    expect(v.decision).toBe("deny");
    expect(v.reasons[0]).toMatch(/lab-only/);
    setEnv("AEP_LAB_POLICY_EVALUATOR", "on");
    expect(labPolicyEvaluatorEnabled()).toBe(true);
    expect(decide(p, act("x", { action_path: "a/b" }))).toBe("allow");
  });

  it("detects mutation of the policy after construction", () => {
    const p = policy();
    const ev = new PolicyEvaluator(p);
    expect(ev.getPolicyHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(p)).toBe(true);
    p.capabilities.push({ tool: "evil", scope: {} });
    const v = ev.evaluate(act("x"), active(p));
    expect(v.decision).toBe("deny");
    expect(v.reasons[0]).toMatch(/integrity violation/);
  });
});

describe("PolicyEvaluator capabilities and scopes", () => {
  it("matches exact, wildcard and prefix tools and denies the rest", () => {
    const p = policy({ capabilities: [{ tool: "file:read" }, { tool: "net:*" }] });
    expect(decide(p, act("file:read"))).toBe("allow");
    expect(decide(p, act("net:fetch"))).toBe("allow");
    const v = new PolicyEvaluator(p).evaluate(act("file:write"), active(p));
    expect(v.decision).toBe("deny");
    expect(v.reasons[0]).toBe('No capability allows tool "file:write" with the provided scope.');
  });

  it("checks path scopes with boundaries and globs, failing closed", () => {
    const p = policy({ capabilities: [{ tool: "file:write", scope: { paths: ["src/**", "docs/*", "*.json", "README.md", "lib/*.ts"] } }] });
    const ok = (path: unknown) => decide(p, act("file:write", { path }));
    expect(ok("src/a/b.ts")).toBe("allow");
    expect(ok("src")).toBe("allow");
    expect(ok("srcx/a.ts")).toBe("deny");
    expect(ok("docs/intro.md")).toBe("allow");
    expect(ok("docs/deep/intro.md")).toBe("deny");
    expect(ok("package.json")).toBe("allow");
    expect(ok("lib/x.ts")).toBe("allow");
    expect(ok("lib/sub/x.ts")).toBe("deny");
    expect(ok("README.md")).toBe("allow");
    expect(ok("README.md/inner")).toBe("allow");
    expect(ok("src/../etc/passwd")).toBe("deny");
    expect(ok("")).toBe("deny");
    expect(decide(p, act("file:write", {}))).toBe("deny");
  });

  it("checks binaries, element prefixes, z bands and excluded ids", () => {
    const bin = policy({ capabilities: [{ tool: "shell", scope: { binaries: ["git", "ls"] } }] });
    expect(decide(bin, act("shell", { command: "git status" }))).toBe("allow");
    expect(decide(bin, act("shell", { command: "rm -rf /" }))).toBe("deny");
    expect(decide(bin, act("shell", {}))).toBe("deny");

    const anyBin = policy({ capabilities: [{ tool: "shell", scope: { binaries: ["*"] } }] });
    expect(decide(anyBin, act("shell", { command: "anything" }))).toBe("allow");

    const el = policy({
      capabilities: [{ tool: "aep:mutate", scope: { element_prefixes: ["CP", "PN"], z_bands: ["10-19"], exclude_ids: ["CP-00001"] } }],
    });
    expect(decide(el, act("aep:mutate", { id: "CP-00002", z: 15 }))).toBe("allow");
    expect(decide(el, act("aep:mutate", { id: "XX-00002", z: 15 }))).toBe("deny");
    expect(decide(el, act("aep:mutate", { id: "CP-00002", z: 25 }))).toBe("deny");
    expect(decide(el, act("aep:mutate", { id: "CP-00002", z: "high" }))).toBe("deny");
    expect(decide(el, act("aep:mutate", { id: "CP-00002" }))).toBe("deny");
    expect(decide(el, act("aep:mutate", { z: 15 }))).toBe("deny");
    expect(decide(el, act("aep:mutate", { id: "CP-00001", z: 15 }))).toBe("deny");
  });

  it("tries later capabilities when an earlier one has a non-matching scope", () => {
    const p = policy({
      capabilities: [
        { tool: "file:write", scope: { paths: ["src/**"] } },
        { tool: "file:write", scope: { paths: ["tests/**"] } },
      ],
    });
    const v = new PolicyEvaluator(p).evaluate(act("file:write", { path: "tests/a.ts" }), active(p));
    expect(v.decision).toBe("allow");
    expect(v.matchedCapability?.scope).toEqual({ paths: ["tests/**"] });
  });
});

describe("PolicyEvaluator forbidden patterns", () => {
  it("denies on a regex match in the tool or the input", () => {
    const p = policy({ forbidden: [{ pattern: "rm\\s+-rf", reason: "destructive" }] });
    const v = new PolicyEvaluator(p).evaluate(act("shell", { command: "rm  -rf /" }), active(p));
    expect(v.decision).toBe("deny");
    expect(v.reasons).toEqual(['Forbidden pattern matched: "rm\\s+-rf"', "destructive"]);
    expect(v.matchedForbidden?.severity).toBe("hard");
    expect(decide(policy({ forbidden: [{ pattern: "^drop_" }] }), act("drop_table"))).toBe("deny");
  });

  it("uses literal matching for invalid or unsafe patterns", () => {
    const invalid = policy({ forbidden: [{ pattern: "([" }] });
    expect(decide(invalid, act("x", { q: "a([b" }))).toBe("deny");
    expect(decide(invalid, act("x", { q: "ab" }))).toBe("allow");

    const nested = policy({ forbidden: [{ pattern: "(a+)+b" }] });
    expect(decide(nested, act("x", { q: "aaaab" }))).toBe("allow");
    expect(decide(nested, act("x", { q: "(a+)+b" }))).toBe("deny");

    const long = "z".repeat(130);
    expect(decide(policy({ forbidden: [{ pattern: long }] }), act("x", { q: long }))).toBe("deny");
  });
});

describe("PolicyEvaluator gates and limits", () => {
  it("gates an action listed in policy gates", () => {
    const p = policy({ gates: [{ action: "deploy:*", approval: "webhook", risk_level: "critical" }] });
    const s = active(p);
    const v = new PolicyEvaluator(p).evaluate(act("deploy:prod"), s);
    expect(v.decision).toBe("gate");
    expect(v.reasons[0]).toBe('Action "deploy:prod" requires webhook approval (risk: critical).');
    expect(v.matchedGate?.timeout_ms).toBe(30000);
    expect(s.stats.actionsGated).toBe(1);
  });

  it("gates a capability whose scope asks for a gate", () => {
    const p = policy({ capabilities: [{ tool: "db:write", scope: { require_gate: ["true"] } }] });
    const v = new PolicyEvaluator(p).evaluate(act("db:write"), active(p));
    expect(v.decision).toBe("gate");
    expect(v.matchedGate).toEqual({ action: "db:write", approval: "human", risk_level: "high", timeout_ms: 30000 });
  });

  it("denies past the runtime limit and the denial limit", () => {
    const p = policy({ limits: { max_runtime_ms: 1000 } });
    const s = active(p);
    s.stats.elapsedMs = 1500;
    const v = new PolicyEvaluator(p).evaluate(act("x"), s);
    expect(v.reasons[0]).toBe("Runtime limit exceeded: 1500ms >= 1000ms.");

    const d = policy({ session: { max_actions: 100, max_denials: 2 } });
    const sd = active(d);
    sd.recordAction("deny");
    sd.recordAction("deny");
    expect(new PolicyEvaluator(d).evaluate(act("x"), sd).reasons[0]).toBe("Denial limit exceeded: 2 >= 2.");
  });

  it("enforces the per-session rate limit", () => {
    const p = policy({ session: { max_actions: 100, rate_limit: { max_per_minute: 2 } } });
    const ev = new PolicyEvaluator(p);
    const s = active(p);
    expect(ev.evaluate(act("x"), s).decision).toBe("allow");
    expect(ev.evaluate(act("x"), s).decision).toBe("allow");
    expect(ev.evaluate(act("x"), s).reasons[0]).toBe("Rate limit exceeded: 2/2 actions per minute.");
  });

  it("enforces a shared system-wide rate counter and resets an old window", () => {
    const p = policy();
    const counter = { count: 0, windowStart: Date.now() };
    const ev = new PolicyEvaluator(p, { systemRateCounter: counter, systemRateLimit: 1 });
    const s = active(p);
    expect(ev.evaluate(act("x"), s).decision).toBe("allow");
    expect(ev.evaluate(act("x"), s).reasons[0]).toBe("System-wide rate limit exceeded: 1/1 actions per minute.");
    const stale = { count: 5, windowStart: Date.now() - 120_000 };
    ev.setSystemRateCounter(stale);
    expect(ev.evaluate(act("x"), s).decision).toBe("allow");
    expect(stale.count).toBe(1);
  });

  it("takes the system rate limit from the policy when not given", () => {
    const p = policy({ system: { max_actions_per_minute: 1 } });
    const ev = new PolicyEvaluator(p, { systemRateCounter: { count: 1, windowStart: Date.now() } });
    expect(ev.evaluate(act("x"), active(p)).decision).toBe("deny");
  });
});

describe("PolicyEvaluator escalation", () => {
  it("pauses, then terminates by action count", () => {
    const pause = policy({ session: { max_actions: 100, escalation: [{ after_actions: 1, require: "pause" }] } });
    const s = active(pause);
    const ev = new PolicyEvaluator(pause);
    expect(ev.evaluate(act("x"), s).decision).toBe("allow");
    const v = ev.evaluate(act("x"), s);
    expect(v.decision).toBe("gate");
    expect(v.reasons[0]).toBe("Escalation: pause after 1 actions.");

    const term = policy({ session: { max_actions: 100, escalation: [{ after_actions: 1, require: "terminate" }] } });
    const st = active(term);
    st.recordAction("allow");
    expect(new PolicyEvaluator(term).evaluate(act("x"), st).reasons[0]).toBe("Escalation: terminate after 1 actions.");
  });

  it("escalates by elapsed minutes and by denials", () => {
    const mins = policy({ session: { max_actions: 100, escalation: [{ after_minutes: 1, require: "human_checkin" }] } });
    const s = active(mins);
    s.stats.elapsedMs = 61_000;
    const v = new PolicyEvaluator(mins).evaluate(act("x"), s);
    expect(v.decision).toBe("gate");
    expect(v.reasons[0]).toBe("Escalation: human_checkin after 1 minutes.");

    const den = policy({ session: { max_actions: 100, escalation: [{ after_denials: 2, require: "terminate" }] } });
    const sd = active(den);
    sd.recordAction("deny");
    sd.recordAction("deny");
    expect(new PolicyEvaluator(den).evaluate(act("x"), sd).reasons[0]).toBe("Escalation: terminate after 2 denials.");
  });
});

describe("PolicyEvaluator covenant and intent drift", () => {
  it("denies an action forbidden by the covenant", () => {
    const p = policy();
    const ev = new PolicyEvaluator(p, {
      covenant: {
        name: "c",
        rules: [
          { type: "forbid", action: "file:delete", conditions: [] },
          { type: "permit", action: "file:*", conditions: [] },
        ],
      },
    });
    const s = active(p);
    const v = ev.evaluate(act("file:delete"), s);
    expect(v.decision).toBe("deny");
    expect(v.reasons[0]).toBe("Covenant: Forbidden by covenant: file:delete");
    expect(ev.evaluate(act("file:read"), s).decision).toBe("allow");
    const unmatched = ev.evaluate(act("net:get"), s);
    expect(unmatched.reasons[0]).toBe('Covenant: Default deny: no covenant rule matches action "net:get"');
  });

  it("applies the configured drift response", () => {
    const drift: DriftScore = { score: 0.9, factors: ["new tool"], isWarmup: false };
    const mk = (on_drift: string) => {
      const p = policy({ intent: { on_drift, drift_threshold: 0.5 } });
      const s = active(p);
      const v = new PolicyEvaluator(p, { intentDetector: new FixedDrift(drift) }).evaluate(act("x"), s);
      return { v, s };
    };
    expect(mk("deny").v.decision).toBe("deny");
    expect(mk("deny").v.reasons[0]).toBe("Intent drift detected (score: 0.90): new tool");
    expect(mk("gate").v.decision).toBe("gate");
    expect(mk("warn").v.decision).toBe("allow");
    const killed = mk("kill");
    expect(killed.v.decision).toBe("deny");
    expect(killed.s.state).toBe("terminated");
  });

  it("ignores drift during warmup or below threshold", () => {
    const p = policy({ intent: { on_drift: "deny", drift_threshold: 0.5 } });
    const ev = new PolicyEvaluator(p);
    ev.setIntentDetector(new FixedDrift({ score: 0.9, factors: [], isWarmup: true }));
    expect(ev.evaluate(act("x"), active(p)).decision).toBe("allow");
    ev.setIntentDetector(new FixedDrift({ score: 0.2, factors: [], isWarmup: false }));
    expect(ev.evaluate(act("x"), active(p)).decision).toBe("allow");
  });
});

describe("PolicyEvaluator identity", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const signed = (tool: string, input: Record<string, unknown>, agentId: string): AgentAction => {
    const payload = Buffer.from(JSON.stringify({ tool, input, agentId }));
    return act(tool, input, { agentId, publicKey: pem, signature: sign(null, payload, privateKey).toString("base64") });
  };

  it("allows a correctly signed action and denies tampered or unsigned ones", () => {
    const p = policy({ identity: { require_agent_identity: true } });
    expect(decide(p, signed("file:read", { path: "a" }, "agent-1"))).toBe("allow");

    const tampered = signed("file:read", { path: "a" }, "agent-1");
    tampered.input = { path: "b" };
    const v = new PolicyEvaluator(p).evaluate(tampered, active(p));
    expect(v.reasons[0]).toBe("Agent identity signature verification failed.");

    const unsigned = new PolicyEvaluator(p).evaluate(act("file:read"), active(p));
    expect(unsigned.reasons[0]).toMatch(/publicKey and signature must be present/);
  });

  it("denies keys outside the trusted list", () => {
    const p = policy({ identity: { require_agent_identity: true, trusted_public_keys: ["other-key"] } });
    const v = new PolicyEvaluator(p).evaluate(signed("x", {}, "a"), active(p));
    expect(v.reasons[0]).toBe("Agent publicKey is not in policy.identity.trusted_public_keys.");
    const trusted = policy({ identity: { require_agent_identity: true, trusted_public_keys: [pem.trim()] } });
    expect(decide(trusted, signed("x", {}, "a"))).toBe("allow");
  });
});

describe("PolicyEvaluator scanners", () => {
  it("denies on a hard finding and on any failed scan", () => {
    const p = policy({ scanners: { enabled: true } });
    const hard = new PolicyEvaluator(p, { scanner: new ScannerPipeline([new WordScanner("payload", "hard")]) });
    const v = hard.evaluate(act("x", { q: "payload" }), active(p));
    expect(v.decision).toBe("deny");
    expect(v.reasons[0]).toBe("Action blocked by scanners: word:w");
    expect(hard.evaluate(act("x", { q: "clean" }), active(p)).decision).toBe("allow");

    const soft = new PolicyEvaluator(p, { scanner: new ScannerPipeline([new WordScanner("meh", "soft")]) });
    expect(soft.evaluate(act("x", { q: "meh" }), active(p)).reasons[0]).toBe("Action blocked by scanners: findings present");
  });

  it("fails closed when scanners are enabled but the pipeline is withheld", () => {
    const p = policy({ scanners: { enabled: true } });
    const v = new PolicyEvaluator(p, { scanner: null }).evaluate(act("x"), active(p));
    expect(v.reasons[0]).toMatch(/fail-closed/);
  });

  it("builds the default pipeline from the policy scanner block", () => {
    const p = policy({ scanners: { temporal: { reference_date: "2026-01-01" } } });
    const ev = new PolicyEvaluator(p);
    expect(ev.evaluate(act("file:read", { path: "src/index.ts" }), active(p)).decision).toBe("allow");
    const key = "AK" + "IA" + "Q".repeat(16);
    expect(ev.evaluate(act("file:write", { body: `aws_access_key_id=${key}` }), active(p)).decision).toBe("deny");
  });
});
