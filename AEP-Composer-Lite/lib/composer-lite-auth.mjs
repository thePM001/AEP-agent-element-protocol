/**
 * Composer Lite API gate (AEP fail-closed).
 *
 * CRITICAL R1 (denylist incomplete): default-deny all non-public paths.
 *   Only an explicit PUBLIC allowlist is open without auth.
 * CRITICAL R2 (loopback free pass): when COMPOSER_LITE_SETUP_TOKEN is set,
 *   token is required even for loopback peers (unless opt-in TRUST_LOOPBACK=1).
 * Publish safety: non-loopback bind without token refuses to start.
 *
 * @PAD: aep28-composer-lite-auth-fail-closed-v2
 */

import { createHash, timingSafeEqual } from "node:crypto";

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

/** @deprecated retained for tests / call sites; authorize uses public allowlist. */
const MUTATING_PREFIXES = [
  "/api/setup/",
  "/api/registry/install",
  "/api/graph",
  "/api/cca/",
  "/api/integration/",
  "/api/wasm/",
  "/api/schema-builder/",
  "/api/policy-builder/",
  "/api/inference",
  "/api/mesh",
];

/**
 * Explicit public surface only (fail-closed). Everything else needs access gate.
 * Keep this list tiny. Never add privileged GETs here.
 */
const PUBLIC_GET_PATHS = new Set([
  "/api/health",
]);

const PUBLIC_GET_PREFIXES = [
  "/assets/",
];

const PUBLIC_EXACT = new Set([
  "/",
  "/index.html",
  "/install",
  "/install/",
  "/install-wizard.html",
]);

function normalizeAddress(addr) {
  return String(addr ?? "").replace(/^::ffff:/, "");
}

/** Constant-time compare of setup tokens (hash then timingSafeEqual). */
export function tokensEqual(presented, configured) {
  const a = createHash("sha256").update(`aep-composer-lite-token-v1|${String(presented ?? "")}`).digest();
  const b = createHash("sha256").update(`aep-composer-lite-token-v1|${String(configured ?? "")}`).digest();
  return timingSafeEqual(a, b);
}

export function isLoopbackHost(host) {
  const h = String(host ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "" || h === "127.0.0.1" || h === "::1" || h === "localhost";
}

/** True when process binds all interfaces or a non-loopback address. */
export function isNonLoopbackBind(host) {
  const h = String(host ?? "127.0.0.1").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackHost(h)) return false;
  if (h === "0.0.0.0" || h === "::" || h === "*") return true;
  return true;
}

/**
 * Fail-closed publish gate for server boot.
 * Non-loopback bind without COMPOSER_LITE_SETUP_TOKEN is a hard error.
 */
/** Minimum setup token length for non-loopback publish (entropy floor). */
export const COMPOSER_LITE_SETUP_TOKEN_MIN_LEN = 32;

export function assertComposerLitePublishSafe(env = process.env) {
  const host = env.COMPOSER_LITE_HOST || "127.0.0.1";
  const token = String(env.COMPOSER_LITE_SETUP_TOKEN ?? "").trim();
  if (isNonLoopbackBind(host) && !token) {
    const msg =
      "COMPOSER_LITE_HOST is non-loopback (" +
      host +
      ") but COMPOSER_LITE_SETUP_TOKEN is empty. " +
      "Fail-closed: set a strong token or bind 127.0.0.1 only.";
    throw new Error(msg);
  }
  if (isNonLoopbackBind(host) && token.length < COMPOSER_LITE_SETUP_TOKEN_MIN_LEN) {
    throw new Error(
      "COMPOSER_LITE_SETUP_TOKEN is too short for non-loopback publish " +
        "(need at least " +
        COMPOSER_LITE_SETUP_TOKEN_MIN_LEN +
        " characters; use openssl rand -hex 32).",
    );
  }
}

export function isLocalComposerRequest(req) {
  const remote = normalizeAddress(req.socket?.remoteAddress);
  const loopbackPeer = remote === "127.0.0.1" || remote === "::1";
  if (!loopbackPeer) return false;
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    // Peer is loopback but client claims a forwarded chain: only trust if first hop is loopback.
    // Remote attackers cannot set socket peer; reverse proxies must inject real client IP.
    const first = normalizeAddress(forwarded.split(",")[0].trim());
    return first === "127.0.0.1" || first === "::1";
  }
  return true;
}

/**
 * When token is configured, loopback free-pass is OFF by default (proxy-safe).
 * Opt-in: COMPOSER_LITE_TRUST_LOOPBACK=1 allows loopback without presenting token.
 */
export function trustLoopbackWithoutToken(env = process.env) {
  const raw = String(env.COMPOSER_LITE_TRUST_LOOPBACK ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function readSetupToken(req, env = process.env) {
  const configured = String(env.COMPOSER_LITE_SETUP_TOKEN ?? "").trim();
  if (!configured) return { configured: false, valid: false, presented: null };
  const header =
    req.headers["x-aep-setup-token"]
    ?? req.headers["x-composer-lite-token"]
    ?? (typeof req.headers.authorization === "string"
      && req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : null);
  const presented = header ?? null;
  return {
    configured: true,
    presented,
    valid: Boolean(presented && tokensEqual(presented, configured)),
  };
}

export function authorizeComposerLiteAccess(req, env = process.env) {
  const token = readSetupToken(req, env);

  if (token.configured) {
    if (token.valid) {
      return { allowed: true, reason: "token" };
    }
    // Token configured: require it. Loopback free-pass only with explicit opt-in.
    if (isLocalComposerRequest(req) && trustLoopbackWithoutToken(env)) {
      return { allowed: true, reason: "local_override" };
    }
    return {
      allowed: false,
      reason: token.presented ? "invalid_token" : "missing_token",
      message: token.presented
        ? "Invalid Composer Lite setup token."
        : "Composer Lite setup token required (COMPOSER_LITE_SETUP_TOKEN).",
    };
  }

  // No token configured: deny by default (including loopback).
  // Opt-in only: COMPOSER_LITE_ALLOW_UNAUTHENTICATED_DEV=1 for local free-pass.
  const allowUnauth = String(env.COMPOSER_LITE_ALLOW_UNAUTHENTICATED_DEV ?? "0")
    .trim()
    .toLowerCase();
  if (
    isLocalComposerRequest(req) &&
    (allowUnauth === "1" || allowUnauth === "true" || allowUnauth === "yes")
  ) {
    return { allowed: true, reason: "local_dev_unauthenticated" };
  }
  return {
    allowed: false,
    reason: "missing_token",
    message:
      "Composer Lite requires COMPOSER_LITE_SETUP_TOKEN (set COMPOSER_LITE_ALLOW_UNAUTHENTICATED_DEV=1 only for explicit local free-pass).",
  };
}

/**
 * Public path allowlist (fail-closed). API privileged routes are NOT public.
 */
export function isPublicComposerPath(pathname, method) {
  const m = String(method || "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD") return false;
  const path = String(pathname || "/");
  if (PUBLIC_EXACT.has(path)) return true;
  if (PUBLIC_GET_PATHS.has(path)) return true;
  if (PUBLIC_GET_PREFIXES.some((p) => path === p.slice(0, -1) || path.startsWith(p))) {
    return true;
  }
  return false;
}

/**
 * @deprecated Prefer isPublicComposerPath + default deny. Kept for call-site compatibility.
 * True when path is an /api privileged read (everything under /api except public GETs).
 */
export function isSensitiveComposerRead(pathname, method) {
  const m = String(method || "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD") return false;
  const path = String(pathname || "");
  if (!path.startsWith("/api")) return false;
  if (isPublicComposerPath(path, m)) return false;
  return true;
}

export function isMutatingComposerPath(pathname, method) {
  if (!MUTATING_METHODS.has(String(method || "").toUpperCase())) return false;
  const path = String(pathname || "");
  if (path === "/api/graph" && method === "PUT") return true;
  if (path === "/api/inference" && method === "POST") return true;
  if (path === "/api/mesh" && method === "POST") return true;
  if (path === "/api/registry/install") return true;
  if (path.startsWith("/api/")) return true;
  return MUTATING_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Authorize a full request. Default-deny: only public paths skip the access gate.
 */
export function authorizeComposerLiteRequest(req, pathname, method, env = process.env) {
  if (isPublicComposerPath(pathname, method)) {
    return { allowed: true, reason: "public" };
  }
  const access = authorizeComposerLiteAccess(req, env);
  if (!access.allowed) {
    return {
      ...access,
      message:
        access.reason === "remote_without_token"
          ? "Sensitive Composer Lite APIs are restricted. Set COMPOSER_LITE_SETUP_TOKEN for non-loopback access."
          : access.message,
    };
  }
  return { allowed: true, reason: access.reason };
}
