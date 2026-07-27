#!/usr/bin/env node
/**
 * Shared connector kit: UCB egress route builders, config helpers, probes.
 * UCB captures /ucb/v1/egress/* and evaluates the remainder path (e.g. /slack/...).
 * Connectors MUST emit path_prefix = /{service} (not the full /ucb/v1/egress/... form).
 */

/**
 * @typedef {object} ConnectorSpec
 * @property {string} id - registry id e.g. connector-slack
 * @property {string} service - short service key e.g. slack
 * @property {string} label
 * @property {string} upstream - default upstream base URL
 * @property {string} authTokenEnv - env var for Bearer injection
 * @property {string[]} keywords - CCA intent matching
 * @property {string} [mcpToolPrefix] - optional MCP tool namespace
 * @property {boolean} [requiresUcb=true]
 */

/** @param {ConnectorSpec} spec */
export function connectorIdToService(spec) {
  return spec.service || spec.id.replace(/^connector-/, "");
}

/**
 * UCB egress path prefix for this connector (remainder path after /ucb/v1/egress/).
 * TM-23: must be /{service} so match_route sees the same path the handler evaluates.
 * @param {ConnectorSpec} spec
 */
export function ucbEgressPrefix(spec) {
  const svc = connectorIdToService(spec);
  return `/${svc}`;
}

/**
 * Normalize connector secret env names for UCB egress allowlist.
 * Allowed: UCB_EGRESS_*, UCB_AUTH_*, AEP_* (alnum/underscore only).
 * @param {string} name
 * @returns {string|undefined}
 */
export function normalizeAuthTokenEnv(name) {
  const n = String(name ?? "").trim();
  if (!n) return undefined;
  if (!/^[A-Za-z0-9_]+$/.test(n)) return undefined;
  if (n.startsWith("UCB_EGRESS_") || n.startsWith("UCB_AUTH_") || n.startsWith("AEP_")) {
    return n;
  }
  // Force non-allowlisted names into UCB_EGRESS_ namespace (no AWS_*/PATH injection)
  return `UCB_EGRESS_${n}`;
}

/**
 * Build manifest egress.routes block for UCB strict mode.
 * @param {ConnectorSpec} spec
 * @param {object} [config]
 */
export function buildEgressRoutes(spec, config = {}) {
  const svc = connectorIdToService(spec);
  // Remainder path evaluated by UCB after /ucb/v1/egress/* capture (TM-23).
  const prefix = ucbEgressPrefix(spec);
  const upstream = String(config.upstream ?? spec.upstream).replace(/\/$/, "");
  const strip = prefix;
  const authEnv = normalizeAuthTokenEnv(config.auth_token_env ?? spec.authTokenEnv);
  if (!authEnv) {
    throw new Error(
      `connector ${spec.id}: auth_token_env missing or invalid (use AEP_* or UCB_EGRESS_*)`,
    );
  }

  return [
    {
      path_prefix: prefix,
      upstream,
      strip_prefix: strip,
      auth_token_env: authEnv,
      // Least privilege methods (GET/POST only by default); paths match full_path remainder.
      access_rules: [
        { action: "ALLOW", method: "GET", path: `${prefix}/**` },
        { action: "ALLOW", method: "POST", path: `${prefix}/**` },
      ],
    },
  ];
}

/**
 * Extension block written to base-node.json connectors section.
 * @param {ConnectorSpec} spec
 * @param {object} config
 */
export function connectorExtension(spec, config) {
  const svc = connectorIdToService(spec);
  return {
    id: spec.id,
    transport: "ucb-egress",
    service: svc,
    ucb_required: true,
    egress_routes: buildEgressRoutes(spec, config),
    config,
    node_type: "connector",
    aep_pattern: "NT-00006",
  };
}

/**
 * Match user intent to connector specs.
 * @param {string} intent
 * @param {ConnectorSpec[]} specs
 */
export function matchConnectorsFromIntent(intent, specs) {
  const lower = intent.toLowerCase();
  return specs.filter((spec) =>
    (spec.keywords ?? []).some((kw) => lower.includes(kw.toLowerCase())),
  );
}

/**
 * Probe upstream via TCP (for host:port connectors) or return configured status.
 * @param {string} host
 * @param {number} port
 * @param {(host: string, port: number) => Promise<{ok: boolean, error?: string}>} probeTcp
 */
export async function probeTcpUpstream(host, port, probeTcp) {
  if (!host) return { ok: false, status: "unconfigured", error: "host required" };
  const tcp = await probeTcp(host, port);
  return {
    ok: tcp.ok,
    status: tcp.ok ? "reachable" : "unreachable",
    host,
    port,
    ucb_only: true,
    error: tcp.error ?? null,
  };
}

/**
 * Probe HTTPS API root (HEAD/GET) - still routed through lattice-gated fetch to UCB in production.
 * @param {string} url
 */
export async function probeHttpsRoot(url, { fetchFn, timeoutMs = 2000 } = {}) {
  if (!url) return { ok: false, status: "unconfigured" };
  const fn = fetchFn ?? globalThis.fetch;
  if (!fn) return { ok: false, status: "no_fetch", error: "fetch unavailable" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fn(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok || res.status < 500, status: `http_${res.status}`, url, ucb_only: true };
  } catch (err) {
    return { ok: false, status: "offline", url, error: err?.message ?? "probe failed", ucb_only: true };
  }
}