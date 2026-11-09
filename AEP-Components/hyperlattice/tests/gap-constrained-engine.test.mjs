/**
 * Hyperlattice GAP engine URL resolution, local policy load and remote validate.
 * Every fetch is a fake assigned to globalThis.fetch and restored after each test; no network is used.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CCA_GAP_POLICY_FILES,
  GAP_ENGINE_UNSET_REASON,
  ccaWritingConstraintsFromGap,
  formatCcaGapPoliciesForPrompt,
  gapEngineConfigured,
  gapEngineHealth,
  loadCcaGapPolicies,
  resolveGapEngineUrl,
  validateCcaGapPolicies,
  validateGapDocument,
} from "../lib/gap-constrained-engine.mjs";
import { COMPOSER_CCA_GAP_POLICIES_DIR } from "../lib/paths.mjs";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "gap-constrained-engine.mjs"),
  "utf8",
);

const LOOPBACK = "http://localhost:8407";

const WRITING_CHAT_GAP = `address:
  domain: dev.aep.cca
  id: cca-writing-chat.v1
pattern:
  constraints:
    - no_em_dashes
    - no_oxford_comma
action:
  type: template
  content: Reply in plain governed prose.
---
kind: aep.caw.profile
name: chat
`;

const PROTOCOL_GAP = `address:
  domain: dev.aep.cca
  id: cca-composer-protocol.v1
action:
  type: template
  content: Follow the composer protocol.
`;

const NO_ADDRESS_GAP = `pattern:
  constraints: []
action:
  type: template
  content: no address here
`;

let root;
const realFetch = globalThis.fetch;

function useFetch(fn) {
  globalThis.fetch = fn;
}

function writePolicy(file, body) {
  const dir = join(root, COMPOSER_CCA_GAP_POLICIES_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), body);
}

function forbidFetch() {
  const counter = { called: 0 };
  useFetch(async () => {
    counter.called += 1;
    throw new Error("fetch must not run");
  });
  return counter;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aep-"));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(root, { recursive: true, force: true });
});

describe("resolveGapEngineUrl", () => {
  it("uses AEP_GAP_ENGINE_URL when set and strips a trailing slash", () => {
    const url = resolveGapEngineUrl({ AEP_GAP_ENGINE_URL: "http://localhost:9999/" });
    assert.equal(url, "http://localhost:9999");
    assert.equal(gapEngineConfigured({ AEP_GAP_ENGINE_URL: "http://localhost:9999/" }), true);
  });

  it("ignores UCB_GAP_ENGINE_URL when AEP_GAP_ENGINE_URL is unset", () => {
    const url = resolveGapEngineUrl({
      UCB_GAP_ENGINE_URL: LOOPBACK,
    });
    assert.equal(url, null);
    assert.equal(gapEngineConfigured({ UCB_GAP_ENGINE_URL: "http://10.0.0.9:8407" }), false);
  });

  it("does not invent a docker gateway or 8407 URL", () => {
    const url = resolveGapEngineUrl({
      DOCKER_HOST_GATEWAY: "172.23.0.1",
    });
    assert.equal(url, null);
    assert.equal(gapEngineConfigured({}), false);
  });

  it("treats blank AEP_GAP_ENGINE_URL as unset", () => {
    assert.equal(resolveGapEngineUrl({ AEP_GAP_ENGINE_URL: "   " }), null);
    assert.equal(resolveGapEngineUrl({ AEP_GAP_ENGINE_URL: "" }), null);
  });

  it("prefers AEP_GAP_ENGINE_URL and still ignores UCB_GAP_ENGINE_URL", () => {
    const url = resolveGapEngineUrl({
      AEP_GAP_ENGINE_URL: "http://10.0.0.8:9",
      UCB_GAP_ENGINE_URL: LOOPBACK,
    });
    assert.equal(url, "http://10.0.0.8:9");
  });

  it("treats a non string value or a non object env as unset", () => {
    expect(resolveGapEngineUrl({ AEP_GAP_ENGINE_URL: 42 })).toBeNull();
    expect(resolveGapEngineUrl(null)).toBeNull();
    expect(resolveGapEngineUrl("AEP_GAP_ENGINE_URL")).toBeNull();
  });

  it("trims surrounding whitespace before stripping the slash", () => {
    expect(resolveGapEngineUrl({ AEP_GAP_ENGINE_URL: "  https://gap.example/  " })).toBe(
      "https://gap.example",
    );
  });
});

describe("product source does not keep the UCB fallback", () => {
  it("has no UCB_GAP_ENGINE_URL branch and no 8407 default", () => {
    assert.equal(SRC.includes("UCB_GAP_ENGINE_URL"), false);
    assert.equal(SRC.includes("8407"), false);
    assert.equal(SRC.includes("DOCKER_HOST_GATEWAY"), false);
    assert.equal(SRC.includes(".dockerenv"), false);
  });
});

describe("gapEngineHealth and validateGapDocument", () => {
  it("skips fetch when AEP_GAP_ENGINE_URL is unset", async () => {
    const counter = forbidFetch();
    const health = await gapEngineHealth({});
    assert.equal(health.skipped, true);
    assert.equal(health.configured, false);
    assert.equal(health.ok, false);
    assert.equal(health.reason, GAP_ENGINE_UNSET_REASON);
    const validated = await validateGapDocument({ id: "x" }, {});
    assert.equal(validated.skipped, true);
    assert.equal(validated.configured, false);
    assert.equal(counter.called, 0);
  });

  it("does not fetch when only UCB_GAP_ENGINE_URL is set", async () => {
    const counter = forbidFetch();
    const health = await gapEngineHealth({ UCB_GAP_ENGINE_URL: LOOPBACK });
    assert.equal(health.skipped, true);
    assert.equal(counter.called, 0);
  });

  it("calls AEP_GAP_ENGINE_URL health when configured", async () => {
    const seen = [];
    useFetch(async (url) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ status: "ok" }) };
    });
    const health = await gapEngineHealth({
      AEP_GAP_ENGINE_URL: "http://10.0.0.8:9",
      UCB_GAP_ENGINE_URL: LOOPBACK,
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0], "http://10.0.0.8:9/api/v1/health");
    assert.equal(health.configured, true);
    assert.equal(health.skipped, false);
    assert.equal(health.engine, "http://10.0.0.8:9");
    expect(health.status).toBe("ok");
  });

  it("throws with the status when health answers non ok", async () => {
    useFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(gapEngineHealth({ AEP_GAP_ENGINE_URL: "http://10.0.0.8:9" })).rejects.toThrow(
      "GAP engine health failed (503)",
    );
  });

  it("posts the document to the validate endpoint and returns the body", async () => {
    const calls = [];
    useFetch(async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ ok: true, issues: [] }) };
    });
    const body = await validateGapDocument({ address: { id: "a" } }, { AEP_GAP_ENGINE_URL: "http://gap/" });
    expect(body).toEqual({ ok: true, issues: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://gap/api/v1/validate");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body)).toEqual({ document: { address: { id: "a" } } });
  });

  it("throws the engine error message when validate answers non ok", async () => {
    useFetch(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: "schema mismatch at pattern" }),
    }));
    await expect(validateGapDocument({}, { AEP_GAP_ENGINE_URL: "http://gap" })).rejects.toThrow(
      "schema mismatch at pattern",
    );
  });

  it("falls back to the status in the validate error when the body has no error", async () => {
    useFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(validateGapDocument({}, { AEP_GAP_ENGINE_URL: "http://gap" })).rejects.toThrow(
      "GAP validate failed (500)",
    );
  });
});

describe("validateCcaGapPolicies", () => {
  it("refuses remote validate without AEP_GAP_ENGINE_URL and does not fetch", async () => {
    const counter = forbidFetch();
    const result = await validateCcaGapPolicies(join(root, "no-policies"), {});
    assert.equal(result.skipped, true);
    assert.equal(result.ok, false);
    assert.equal(result.engine, null);
    assert.equal(result.reason, GAP_ENGINE_UNSET_REASON);
    assert.equal(counter.called, 0);
  });

  it("lists each local policy as skipped when the engine is unset", async () => {
    forbidFetch();
    writePolicy("cca-writing-chat.gap", WRITING_CHAT_GAP);
    const result = await validateCcaGapPolicies(root, {});
    expect(result.policies).toEqual([
      { file: "cca-writing-chat.gap", ok: false, skipped: true, error: GAP_ENGINE_UNSET_REASON },
    ]);
  });

  it("validates every policy against the engine and reports per file", async () => {
    writePolicy("cca-writing-chat.gap", WRITING_CHAT_GAP);
    writePolicy("cca-composer-protocol.gap", PROTOCOL_GAP);
    writePolicy("cca-hyperlattice.gap", NO_ADDRESS_GAP);
    const posted = [];
    useFetch(async (_url, init) => {
      const doc = JSON.parse(init.body).document;
      posted.push(doc.address.id);
      if (doc.address.id === "cca-composer-protocol.v1") {
        return { ok: false, status: 422, json: async () => ({ error: "bad protocol" }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    const result = await validateCcaGapPolicies(root, { AEP_GAP_ENGINE_URL: "http://gap" });
    expect(posted).toEqual(["cca-writing-chat.v1", "cca-composer-protocol.v1"]);
    expect(result.configured).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.engine).toBe("http://gap");
    expect(result.ok).toBe(false);
    expect(result.policies).toEqual([
      {
        file: "cca-writing-chat.gap",
        address: { domain: "dev.aep.cca", id: "cca-writing-chat.v1" },
        ok: true,
      },
      { file: "cca-composer-protocol.gap", ok: false, error: "bad protocol" },
      { file: "cca-hyperlattice.gap", ok: false, error: "missing instruction document" },
    ]);
  });

  it("is ok when every policy validates", async () => {
    writePolicy("cca-writing-chat.gap", WRITING_CHAT_GAP);
    useFetch(async () => ({ ok: true, status: 200, json: async () => ({ valid: true }) }));
    const result = await validateCcaGapPolicies(root, { AEP_GAP_ENGINE_URL: "http://gap" });
    expect(result.ok).toBe(true);
    expect(result.policies[0].valid).toBe(true);
  });
});

describe("loadCcaGapPolicies", () => {
  it("does not stamp a remote UCB engine URL onto local policies", () => {
    writePolicy("cca-writing-chat.gap", WRITING_CHAT_GAP);
    const policies = loadCcaGapPolicies(root, {
      UCB_GAP_ENGINE_URL: LOOPBACK,
    });
    assert.ok(policies.length >= 1);
    for (const policy of policies) {
      assert.equal(policy.engine, null);
      assert.equal(policy.synthesized_by, "local_gap_parse");
    }
  });

  it("returns nothing when the policy directory is absent", () => {
    expect(loadCcaGapPolicies(root, {})).toEqual([]);
  });

  it("parses address, instruction and runtime documents in the fixed file order", () => {
    writePolicy("cca-hyperlattice.gap", NO_ADDRESS_GAP);
    writePolicy("cca-writing-chat.gap", WRITING_CHAT_GAP);
    const policies = loadCcaGapPolicies(root, {});
    expect(policies.map((p) => p.file)).toEqual(["cca-writing-chat.gap", "cca-hyperlattice.gap"]);
    const writing = policies[0];
    expect(writing.path).toBe(`${COMPOSER_CCA_GAP_POLICIES_DIR}/cca-writing-chat.gap`);
    expect(writing.address).toEqual({ domain: "dev.aep.cca", id: "cca-writing-chat.v1" });
    expect(writing.instruction.pattern.constraints).toEqual(["no_em_dashes", "no_oxford_comma"]);
    expect(writing.runtime).toEqual([{ kind: "aep.caw.profile", name: "chat" }]);
    expect(policies[1].address).toBeNull();
    expect(policies[1].instruction).toBeNull();
  });

  it("stamps the engine and gapc_validated when the engine is configured", () => {
    writePolicy("cca-writing-chat.gap", WRITING_CHAT_GAP);
    const [policy] = loadCcaGapPolicies(root, { AEP_GAP_ENGINE_URL: "http://gap/" });
    expect(policy.engine).toBe("http://gap");
    expect(policy.synthesized_by).toBe("gapc_validated");
  });

  it("only reads the three named CCA policy files", () => {
    writePolicy("other.gap", PROTOCOL_GAP);
    expect(loadCcaGapPolicies(root, {})).toEqual([]);
    expect(CCA_GAP_POLICY_FILES).toEqual([
      "cca-writing-chat.gap",
      "cca-composer-protocol.gap",
      "cca-hyperlattice.gap",
    ]);
  });
});

describe("ccaWritingConstraintsFromGap and formatCcaGapPoliciesForPrompt", () => {
  it("reads constraints from the writing chat policy only", () => {
    writePolicy("cca-writing-chat.gap", WRITING_CHAT_GAP);
    writePolicy("cca-composer-protocol.gap", PROTOCOL_GAP);
    const policies = loadCcaGapPolicies(root, {});
    expect(ccaWritingConstraintsFromGap(policies)).toEqual(["no_em_dashes", "no_oxford_comma"]);
    expect(ccaWritingConstraintsFromGap(policies.slice(1))).toEqual([]);
    expect(ccaWritingConstraintsFromGap()).toEqual([]);
    expect(
      ccaWritingConstraintsFromGap([{ file: "cca-writing-chat.gap", instruction: { pattern: "text" } }]),
    ).toEqual([]);
  });

  it("formats one line per policy with address, content and constraints", () => {
    writePolicy("cca-writing-chat.gap", WRITING_CHAT_GAP);
    writePolicy("cca-hyperlattice.gap", NO_ADDRESS_GAP);
    const text = formatCcaGapPoliciesForPrompt(loadCcaGapPolicies(root, {}));
    expect(text.split("\n")).toEqual([
      "CCA GAP policies (AEP writing engine, schema-validated, no external LLM):",
      "- dev.aep.cca/cca-writing-chat.v1: Reply in plain governed prose.",
      "  constraints: no_em_dashes, no_oxford_comma",
      "- cca-hyperlattice.gap: ",
    ]);
  });

  it("formats only the header for no policies", () => {
    expect(formatCcaGapPoliciesForPrompt()).toBe(
      "CCA GAP policies (AEP writing engine, schema-validated, no external LLM):",
    );
  });
});
