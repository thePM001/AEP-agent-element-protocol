/**
 * Composer Lite mutating API gate.
 * Local loopback requests are allowed. Remote callers must present COMPOSER_LITE_SETUP_TOKEN.
 */

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

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

function normalizeAddress(addr) {
  return String(addr ?? "").replace(/^::ffff:/, "");
}

export function isLocalComposerRequest(req) {
  const remote = normalizeAddress(req.socket?.remoteAddress);
  const loopbackPeer = remote === "127.0.0.1" || remote === "::1";
  if (!loopbackPeer) return false;
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = normalizeAddress(forwarded.split(",")[0].trim());
    return first === "127.0.0.1" || first === "::1";
  }
  return true;
}

export function authorizeComposerLiteAccess(req, env = process.env) {
  if (isLocalComposerRequest(req)) {
    return { allowed: true, reason: "local" };
  }
  const token = readSetupToken(req, env);
  if (token.configured && token.valid) {
    return { allowed: true, reason: "token" };
  }
  if (!token.configured) {
    return {
      allowed: false,
      reason: "remote_without_token",
      message:
        "Composer Lite access from non-loopback requires COMPOSER_LITE_SETUP_TOKEN.",
    };
  }
  return {
    allowed: false,
    reason: "invalid_token",
    message: "Invalid or missing Composer Lite setup token.",
  };
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
  return {
    configured: true,
    presented: header ?? null,
    valid: Boolean(header && header === configured),
  };
}

export function isMutatingComposerPath(pathname, method) {
  if (!MUTATING_METHODS.has(method)) return false;
  if (pathname === "/api/graph" && method === "PUT") return true;
  if (pathname === "/api/inference" && method === "POST") return true;
  if (pathname === "/api/mesh" && method === "POST") return true;
  if (pathname === "/api/registry/install") return true;
  return MUTATING_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function authorizeComposerLiteRequest(req, pathname, method, env = process.env) {
  if (!isMutatingComposerPath(pathname, method)) {
    return { allowed: true, reason: "read_only" };
  }
  const access = authorizeComposerLiteAccess(req, env);
  if (!access.allowed) {
    return {
      ...access,
      message:
        access.reason === "remote_without_token"
          ? "Mutating Composer Lite APIs are restricted to loopback. Set COMPOSER_LITE_SETUP_TOKEN for remote setup."
          : access.message,
    };
  }
  return { allowed: true, reason: access.reason };
}