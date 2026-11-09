import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { parseCovenant } from "../lib/parser.js";
import { evaluateCovenant, verifyCovenantSignature, covenantCanonicalPayload } from "../lib/evaluator.js";
import type { CovenantSpec } from "../lib/types.js";

const parsed = parseCovenant(`covenant Agent {
  permit file:read;
  permit file:write (path matches "^/workspace/");
  forbid file:delete;
  forbid net:fetch (host in ["evil.test"]) [soft];
  forbid command:run (risk == "high");
  permit command:run;
}`);
// Wildcard patterns are supported by the evaluator for programmatic specs.
const spec: CovenantSpec = {
  ...parsed,
  rules: [...parsed.rules, { type: "permit", action: "aep:*", conditions: [] }],
};

describe("evaluateCovenant decisions", () => {
  it("permits an unconditional permit", () => {
    const r = evaluateCovenant(spec, { action: "file:read", input: {} });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("Permitted by covenant: file:read");
    expect(r.matchedRule?.action).toBe("file:read");
  });

  it("permits a conditional permit only when conditions match", () => {
    expect(evaluateCovenant(spec, { action: "file:write", input: { path: "/workspace/a.txt" } }).allowed).toBe(true);
    const denied = evaluateCovenant(spec, { action: "file:write", input: { path: "/etc/passwd" } });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe("No permit conditions matched for action: file:write");
  });

  it("hard forbid denies", () => {
    const r = evaluateCovenant(spec, { action: "file:delete", input: {} });
    expect(r).toMatchObject({ allowed: false, reason: "Forbidden by covenant: file:delete" });
  });

  it("soft forbid allows with a warning when conditions match", () => {
    const r = evaluateCovenant(spec, { action: "net:fetch", input: { host: "evil.test" } });
    expect(r.allowed).toBe(true);
    expect(r.softWarning).toMatch(/soft/);
    const other = evaluateCovenant(spec, { action: "net:fetch", input: { host: "good.test" } });
    expect(other.allowed).toBe(false);
    expect(other.softWarning).toBeUndefined();
    expect(other.reason).toMatch(/Default deny/);
  });

  it("forbid wins over a permit for the same action", () => {
    expect(evaluateCovenant(spec, { action: "command:run", input: { risk: "high" } }).allowed).toBe(false);
    expect(evaluateCovenant(spec, { action: "command:run", input: { risk: "low" } }).allowed).toBe(true);
  });

  it("namespace wildcards need a non-empty suffix", () => {
    expect(evaluateCovenant(spec, { action: "aep:create_element", input: {} }).allowed).toBe(true);
    expect(evaluateCovenant(spec, { action: "aep:", input: {} }).allowed).toBe(false);
    expect(evaluateCovenant(spec, { action: "aepx:thing", input: {} }).allowed).toBe(false);
  });

  it("default denies unknown actions", () => {
    const r = evaluateCovenant(spec, { action: "db:drop", input: {} });
    expect(r).toEqual({ allowed: false, reason: 'Default deny: no covenant rule matches action "db:drop"' });
  });

  it("star permits everything", () => {
    const all: CovenantSpec = { name: "All", rules: [{ type: "permit", action: "*", conditions: [] }] };
    expect(evaluateCovenant(all, { action: "anything:at_all", input: {} }).allowed).toBe(true);
  });
});

describe("evaluateCovenant require rules and operators", () => {
  const req = parseCovenant(`covenant Req {
    require trust_tier >= "standard";
    permit x;
  }`);

  it("compares trust tiers by order", () => {
    expect(evaluateCovenant(req, { action: "x", input: {}, trustTier: "trusted", trust_tier: "trusted" }).allowed).toBe(true);
    expect(evaluateCovenant(req, { action: "x", input: { trust_tier: "standard" } }).allowed).toBe(true);
    const low = evaluateCovenant(req, { action: "x", input: { trust_tier: "provisional" } });
    expect(low.allowed).toBe(false);
    expect(low.reason).toBe('Requirement not met: trust_tier >= "standard" (actual: "provisional")');
  });

  it("fails closed on a missing value", () => {
    expect(evaluateCovenant(req, { action: "x", input: {} }).allowed).toBe(false);
  });

  it("compares numbers and fails closed on NaN", () => {
    const num = parseCovenant(`covenant N {
      permit a (n > "5");
      permit b (n < "5");
      permit c (n >= "5");
      permit d (n <= "5");
      permit e (n != "5");
    }`);
    const ok = (action: string, n: unknown): boolean => evaluateCovenant(num, { action, input: { n } }).allowed;
    expect([ok("a", 6), ok("a", 5), ok("a", "abc")]).toEqual([true, false, false]);
    expect([ok("b", 4), ok("b", 5), ok("b", "abc")]).toEqual([true, false, false]);
    expect([ok("c", 5), ok("c", 4), ok("c", "abc")]).toEqual([true, false, false]);
    expect([ok("d", 5), ok("d", 6), ok("d", "abc")]).toEqual([true, false, false]);
    expect([ok("e", 4), ok("e", 5)]).toEqual([true, false]);
  });

  it("treats array values in == and != as membership", () => {
    const arr: CovenantSpec = {
      name: "Arr",
      rules: [
        { type: "permit", action: "a", conditions: [{ field: "k", operator: "==", value: ["x", "y"] }] },
        { type: "permit", action: "b", conditions: [{ field: "k", operator: "!=", value: ["x", "y"] }] },
        { type: "permit", action: "c", conditions: [{ field: "k", operator: "in", value: "x" }] },
      ],
    };
    expect(evaluateCovenant(arr, { action: "a", input: { k: "y" } }).allowed).toBe(true);
    expect(evaluateCovenant(arr, { action: "a", input: { k: "x,y" } }).allowed).toBe(false);
    expect(evaluateCovenant(arr, { action: "b", input: { k: "z" } }).allowed).toBe(true);
    expect(evaluateCovenant(arr, { action: "b", input: { k: "x" } }).allowed).toBe(false);
    // "in" with a non-array value never matches
    expect(evaluateCovenant(arr, { action: "c", input: { k: "x" } }).allowed).toBe(false);
  });

  it("fails closed on an invalid regex", () => {
    const bad: CovenantSpec = {
      name: "Bad",
      rules: [{ type: "permit", action: "a", conditions: [{ field: "p", operator: "matches", value: "([" }] }],
    };
    expect(evaluateCovenant(bad, { action: "a", input: { p: "([" } }).allowed).toBe(false);
  });
});

describe("covenant signatures", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const base: CovenantSpec = parseCovenant("covenant Signed {\n permit a;\n}");
  const signature = sign(null, covenantCanonicalPayload(base), privateKey).toString("base64");

  it("canonical payload covers name and rules only", () => {
    expect(JSON.parse(covenantCanonicalPayload({ ...base, requireSignature: true }).toString())).toEqual({
      name: "Signed",
      rules: base.rules,
    });
  });

  it("accepts a valid signature", () => {
    const signed = { ...base, signature, signingPublicKey: pem, requireSignature: true };
    expect(verifyCovenantSignature(signed)).toBe(true);
    expect(evaluateCovenant(signed, { action: "a", input: {} }).allowed).toBe(true);
  });

  it("denies when a signature is required but missing", () => {
    const r = evaluateCovenant({ ...base, requireSignature: true }, { action: "a", input: {} });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/signature required but missing/);
  });

  it("denies when rules were changed after signing", () => {
    const tampered: CovenantSpec = {
      ...base,
      rules: [...base.rules, { type: "permit", action: "b", conditions: [] }],
      signature,
      signingPublicKey: pem,
      requireSignature: true,
    };
    const r = evaluateCovenant(tampered, { action: "b", input: {} });
    expect(r).toEqual({ allowed: false, reason: "Covenant signature verification failed" });
  });

  it("verifies a present signature even when not required", () => {
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    const r = evaluateCovenant({ ...base, signature, signingPublicKey: other }, { action: "a", input: {} });
    expect(r).toEqual({ allowed: false, reason: "Covenant signature present but invalid" });
  });

  it("returns false for garbage keys or empty signatures", () => {
    expect(verifyCovenantSignature({ ...base, signature, signingPublicKey: "not a pem" })).toBe(false);
    expect(verifyCovenantSignature({ ...base, signature: "", signingPublicKey: pem })).toBe(false);
    expect(verifyCovenantSignature({ ...base, signature: "====", signingPublicKey: pem })).toBe(false);
  });
});
