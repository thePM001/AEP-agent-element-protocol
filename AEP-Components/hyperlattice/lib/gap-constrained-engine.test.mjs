/**
 * Hyperlattice GAP engine URL resolution.
 * Run: node --test AEP-Components/hyperlattice/lib/gap-constrained-engine.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveGapEngineUrl,
  gapEngineConfigured,
  gapEngineHealth,
  validateGapDocument,
  validateCcaGapPolicies,
  loadCcaGapPolicies,
  GAP_ENGINE_UNSET_REASON,
} from "./gap-constrained-engine.mjs";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "gap-constrained-engine.mjs"),
  "utf8",
);

describe("resolveGapEngineUrl", () => {
  it("uses AEP_GAP_ENGINE_URL when set and strips a trailing slash", () => {
    const url = resolveGapEngineUrl({ AEP_GAP_ENGINE_URL: "http://127.0.0.1:9999/" });
    assert.equal(url, "http://127.0.0.1:9999");
    assert.equal(gapEngineConfigured({ AEP_GAP_ENGINE_URL: "http://127.0.0.1:9999/" }), true);
  });

  it("ignores UCB_GAP_ENGINE_URL when AEP_GAP_ENGINE_URL is unset", () => {
    const url = resolveGapEngineUrl({
      UCB_GAP_ENGINE_URL: "http://127.0.0.1:8407",
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
      UCB_GAP_ENGINE_URL: "http://127.0.0.1:8407",
    });
    assert.equal(url, "http://10.0.0.8:9");
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
    let called = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = async () => {
      called += 1;
      throw new Error("fetch must not run");
    };
    try {
      const health = await gapEngineHealth({});
      assert.equal(health.skipped, true);
      assert.equal(health.configured, false);
      assert.equal(health.ok, false);
      assert.equal(health.reason, GAP_ENGINE_UNSET_REASON);
      const validated = await validateGapDocument({ id: "x" }, {});
      assert.equal(validated.skipped, true);
      assert.equal(validated.configured, false);
      assert.equal(called, 0);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("does not fetch when only UCB_GAP_ENGINE_URL is set", async () => {
    let called = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = async () => {
      called += 1;
      throw new Error("fetch must not run");
    };
    try {
      const health = await gapEngineHealth({ UCB_GAP_ENGINE_URL: "http://127.0.0.1:8407" });
      assert.equal(health.skipped, true);
      assert.equal(called, 0);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("calls AEP_GAP_ENGINE_URL health when configured", async () => {
    const seen = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ status: "ok" }) };
    };
    try {
      const health = await gapEngineHealth({
        AEP_GAP_ENGINE_URL: "http://10.0.0.8:9",
        UCB_GAP_ENGINE_URL: "http://127.0.0.1:8407",
      });
      assert.equal(seen.length, 1);
      assert.equal(seen[0], "http://10.0.0.8:9/api/v1/health");
      assert.equal(health.configured, true);
      assert.equal(health.skipped, false);
      assert.equal(health.engine, "http://10.0.0.8:9");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("validateCcaGapPolicies", () => {
  it("refuses remote validate without AEP_GAP_ENGINE_URL and does not fetch", async () => {
    let called = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = async () => {
      called += 1;
      throw new Error("fetch must not run");
    };
    try {
      const result = await validateCcaGapPolicies("/tmp/ucb-agent-286-p2-no-policies", {});
      assert.equal(result.skipped, true);
      assert.equal(result.ok, false);
      assert.equal(result.engine, null);
      assert.equal(result.reason, GAP_ENGINE_UNSET_REASON);
      assert.equal(called, 0);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("loadCcaGapPolicies", () => {
  it("does not stamp a remote UCB engine URL onto local policies", () => {
    const policies = loadCcaGapPolicies("/tmp/ucb-agent-286-p2", {
      UCB_GAP_ENGINE_URL: "http://127.0.0.1:8407",
    });
    assert.ok(policies.length >= 1);
    for (const policy of policies) {
      assert.equal(policy.engine, null);
      assert.equal(policy.synthesized_by, "local_gap_parse");
    }
  });
});
