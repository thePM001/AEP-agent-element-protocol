#!/usr/bin/env node
/**
 * Shared connector kit: UCB egress route builders, config helpers, probes.
 * All external connectors MUST emit routes for /ucb/v1/egress/{serviceId}/**
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
 * UCB egress path prefix for this connector.
 * @param {ConnectorSpec} spec
 */
export function ucbEgressPrefix(spec) {
  const svc = connectorIdToService(spec);
  return `/ucb/v1/egress/${svc}`;
}

/**
 * Build manifest egress.routes block for UCB strict mode.
 * @param {ConnectorSpec} spec
 * @param {object} [config]
 */
export function buildEgressRoutes(spec, config = {}) {
  const svc = connectorIdToService(spec);
  const prefix = ucbEgressPrefix(spec);
  const upstream = String(config.upstream ?? spec.upstream).replace(/\/$/, "");
  const strip = `/ucb/v1/egress/${svc}`;

  return [
    {
      path_prefix: prefix,
      upstream,
      strip_prefix: strip,
      auth_token_env: config.auth_token_env ?? spec.authTokenEnv,
      access_rules: [
        { action: "ALLOW", method: "GET", path: `${prefix}/**` },
        { action: "ALLOW", method: "POST", path: `${prefix}/**` },
        { action: "ALLOW", method: "PUT", path: `${prefix}/**` },
        { action: "ALLOW", method: "PATCH", path: `${prefix}/**` },
        { action: "ALLOW", method: "DELETE", path: `${prefix}/**` },
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