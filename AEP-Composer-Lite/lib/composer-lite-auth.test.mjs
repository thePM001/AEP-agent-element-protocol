/**
 * Fail-closed Composer Lite auth regression tests (CRITICAL R1 + R2).
 * Run: node --test AEP-Composer-Lite/lib/composer-lite-auth.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeComposerLiteRequest,
  assertComposerLitePublishSafe,
  isPublicComposerPath,
  isSensitiveComposerRead,
  isNonLoopbackBind,
  tokensEqual,
} from "./composer-lite-auth.mjs";

function req(remote = "10.0.0.5", headers = {}) {
  return { socket: { remoteAddress: remote }, headers };
}

function localReq(headers = {}) {
  return req("127.0.0.1", headers);
}

describe("public allowlist (fail-closed)", () => {
  it("only health and static install UI are public", () => {
    assert.equal(isPublicComposerPath("/api/health", "GET"), true);
    assert.equal(isPublicComposerPath("/", "GET"), true);
    assert.equal(isPublicComposerPath("/install", "GET"), true);
    assert.equal(isPublicComposerPath("/assets/app.js", "GET"), true);
    assert.equal(isPublicComposerPath("/api/cca", "GET"), false);
    assert.equal(isPublicComposerPath("/api/inference", "GET"), false);
    assert.equal(isPublicComposerPath("/api/docking", "GET"), false);
    assert.equal(isPublicComposerPath("/api/fabric/traces", "GET"), false);
    assert.equal(isPublicComposerPath("/api/integrations", "GET"), false);
    assert.equal(isPublicComposerPath("/api/hyperlattice", "GET"), false);
    assert.equal(isPublicComposerPath("/api/policy-lattice", "GET"), false);
    assert.equal(isPublicComposerPath("/api/agentmesh", "GET"), false);
    assert.equal(isPublicComposerPath("/api/setup/status", "GET"), false);
  });

  it("isSensitiveComposerRead covers docking not only dock prefix", () => {
    assert.equal(isSensitiveComposerRead("/api/docking", "GET"), true);
    assert.equal(isSensitiveComposerRead("/api/dock", "GET"), true);
    assert.equal(isSensitiveComposerRead("/api/health", "GET"), false);
  });
});

describe("CRITICAL R1 remote privileged GET without token", () => {
  const privileged = [
    "/api/cca",
    "/api/cca/plan",
    "/api/inference",
    "/api/docking",
    "/api/fabric/traces",
    "/api/integrations",
    "/api/hyperlattice",
    "/api/policy-lattice",
    "/api/agentmesh",
    "/api/setup/status",
    "/api/registry",
  ];
  for (const path of privileged) {
    it(`denies remote GET ${path} without token`, () => {
      const r = authorizeComposerLiteRequest(req("203.0.113.9"), path, "GET", {});
      assert.equal(r.allowed, false);
      assert.ok(["remote_without_token", "missing_token"].includes(r.reason));
    });
  }

  it("allows remote GET /api/health without token", () => {
    const r = authorizeComposerLiteRequest(req("203.0.113.9"), "/api/health", "GET", {});
    assert.equal(r.allowed, true);
    assert.equal(r.reason, "public");
  });
});

describe("CRITICAL R2 loopback + configured token", () => {
  it("denies loopback without presenting token when token is configured", () => {
    const env = { COMPOSER_LITE_SETUP_TOKEN: "super-secret-token-value-32chars-ok!!" };
    const r = authorizeComposerLiteRequest(localReq(), "/api/cca", "GET", env);
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "missing_token");
  });

  it("allows loopback with valid token when configured", () => {
    const env = { COMPOSER_LITE_SETUP_TOKEN: "super-secret-token-value-32chars-ok!!" };
    const r = authorizeComposerLiteRequest(
      localReq({ "x-aep-setup-token": "super-secret-token-value-32chars-ok!!" }),
      "/api/cca",
      "GET",
      env,
    );
    assert.equal(r.allowed, true);
    assert.equal(r.reason, "token");
  });

  it("denies loopback without token when token not configured (fail closed)", () => {
    const r = authorizeComposerLiteRequest(localReq(), "/api/cca", "GET", {});
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "missing_token");
  });

  it("allows loopback without token only with ALLOW_UNAUTHENTICATED_DEV=1", () => {
    const env = { COMPOSER_LITE_ALLOW_UNAUTHENTICATED_DEV: "1" };
    const r = authorizeComposerLiteRequest(localReq(), "/api/cca", "GET", env);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, "local_dev_unauthenticated");
  });

  it("TRUST_LOOPBACK=1 restores loopback free-pass when token configured", () => {
    const env = {
      COMPOSER_LITE_SETUP_TOKEN: "super-secret-token-value-32chars-ok!!",
      COMPOSER_LITE_TRUST_LOOPBACK: "1",
    };
    const r = authorizeComposerLiteRequest(localReq(), "/api/cca", "GET", env);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, "local_override");
  });

  it("remote with valid token is allowed", () => {
    const env = { COMPOSER_LITE_SETUP_TOKEN: "super-secret-token-value-32chars-ok!!" };
    const r = authorizeComposerLiteRequest(
      req("203.0.113.9", { "x-aep-setup-token": "super-secret-token-value-32chars-ok!!" }),
      "/api/docking",
      "GET",
      env,
    );
    assert.equal(r.allowed, true);
    assert.equal(r.reason, "token");
  });

  it("rejects wrong token", () => {
    const env = { COMPOSER_LITE_SETUP_TOKEN: "super-secret-token-value-32chars-ok!!" };
    const r = authorizeComposerLiteRequest(
      req("203.0.113.9", { "x-aep-setup-token": "wrong" }),
      "/api/cca",
      "GET",
      env,
    );
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "invalid_token");
  });
});

describe("publish safety", () => {
  it("isNonLoopbackBind detects 0.0.0.0", () => {
    assert.equal(isNonLoopbackBind("0.0.0.0"), true);
    assert.equal(isNonLoopbackBind("127.0.0.1"), false);
    assert.equal(isNonLoopbackBind("localhost"), false);
  });

  it("assertComposerLitePublishSafe throws on 0.0.0.0 without token", () => {
    assert.throws(
      () => assertComposerLitePublishSafe({ COMPOSER_LITE_HOST: "0.0.0.0" }),
      /non-loopback/,
    );
  });

  it("assertComposerLitePublishSafe ok with token on 0.0.0.0", () => {
    assert.doesNotThrow(() =>
      assertComposerLitePublishSafe({
        COMPOSER_LITE_HOST: "0.0.0.0",
        COMPOSER_LITE_SETUP_TOKEN: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
  });

  it("assertComposerLitePublishSafe ok on loopback without token", () => {
    assert.doesNotThrow(() =>
      assertComposerLitePublishSafe({ COMPOSER_LITE_HOST: "127.0.0.1" }),
    );
  });
});

describe("tokensEqual", () => {
  it("matches equal strings", () => {
    assert.equal(tokensEqual("abc", "abc"), true);
    assert.equal(tokensEqual("abc", "abd"), false);
  });
});


it("assertComposerLitePublishSafe rejects short token on non-loopback", () => {
  assert.throws(
    () =>
      assertComposerLitePublishSafe({
        COMPOSER_LITE_HOST: "0.0.0.0",
        COMPOSER_LITE_SETUP_TOKEN: "tok",
      }),
    /too short/,
  );
});
