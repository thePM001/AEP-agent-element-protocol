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
      access_rules: config.access_rules ?? spec.accessRules ?? [
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
  if (hostIsVendor(host)) {
    return { ok: false, status: "vendor_denied", error: "vendor host denied", host, port, ucb_only: true };
  }
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
  try {
    assertUcbOnlyUrl(url);
  } catch (err) {
    return { ok: false, status: "vendor_denied", error: err.message, ucb_only: true };
  }
  const fn = fetchFn ?? (typeof fetch === "function" ? fetch : undefined);
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

const VENDOR_HOSTS = new Set([
  "slack.com",
  "www.slack.com",
  "api.slack.com",
  "hooks.slack.com",
  "atlassian.com",
  "www.atlassian.com",
  "api.atlassian.com",
  "api.notion.com",
  "api.hubapi.com",
  "googleapis.com",
  "www.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "sts.amazonaws.com",
  "amazonaws.com",
  "management.azure.com",
  "api.zapier.com",
  "make.com",
  "eu1.make.com",
]);

export function defaultUcbUrl() {
  try {
    if (typeof process !== "undefined" && process.env && process.env.UCB_URL) {
      return String(process.env.UCB_URL).replace(/\/$/, "");
    }
  } catch (_e) {}
  return "http://127.0.0.1:8412";
}

export function hostIsVendor(host) {
  const h = String(host || "").trim().replace(/\.$/, "").toLowerCase();
  if (!h) return false;
  if (VENDOR_HOSTS.has(h)) return true;
  for (const v of VENDOR_HOSTS) {
    if (h.endsWith("." + v)) return true;
  }
  return false;
}

export function assertUcbOnlyUrl(url) {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("url scheme must be http or https");
  }
  if (hostIsVendor(u.hostname)) {
    throw new Error("vendor host denied");
  }
  return url;
}

export function ucbEgressUrl(service, remainder = "", { ucbBase } = {}) {
  const base = String(ucbBase ?? defaultUcbUrl()).replace(/\/$/, "");
  assertUcbOnlyUrl(base);
  const svc = String(service || "").replace(/^\/+|\/+$/g, "");
  if (!svc) throw new Error("service required");
  const rem = String(remainder || "").replace(/^\/+/, "");
  const url = rem ? `${base}/ucb/v1/egress/${svc}/${rem}` : `${base}/ucb/v1/egress/${svc}`;
  assertUcbOnlyUrl(url);
  const path = new URL(url).pathname;
  if (path.startsWith("/ucb/v1/egress/") === false) {
    throw new Error("UCB egress path required");
  }
  return url;
}

export async function ucbFetch(service, remainder, opts = {}) {
  const {
    method = "GET",
    body,
    headers = {},
    agentId,
    apiKey,
    fetchFn,
    ucbBase,
    timeoutMs = 5000,
  } = opts;
  const url = ucbEgressUrl(service, remainder, { ucbBase });
  const fn = fetchFn ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fn) throw new Error("fetch unavailable");
  let agent = agentId;
  let key = apiKey;
  try {
    if (!agent && typeof process !== "undefined" && process.env) {
      agent = process.env.AEP_AGENT_ID;
    }
    if (!key && typeof process !== "undefined" && process.env) {
      key = process.env.UCB_API_KEY || process.env.AEP_UCB_API_KEY;
    }
  } catch (_e) {}
  agent = agent || "connector-agent";
  key = key || "";
  const h = {
    Accept: "application/json",
    "X-AEP-Agent-Id": agent,
    ...headers,
  };
  if (key) h.Authorization = `Bearer ${key}`;
  if (body != null && h["Content-Type"] == null && h["content-type"] == null) {
    h["Content-Type"] = "application/json";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(url, { method, headers: h, body, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function probeViaUcb(service, remainder = "", opts = {}) {
  try {
    const res = await ucbFetch(service, remainder, { method: opts.method ?? "GET", ...opts });
    return {
      ok: res.ok || res.status < 500,
      status: `http_${res.status}`,
      url: ucbEgressUrl(service, remainder, { ucbBase: opts.ucbBase }),
      ucb_only: true,
      service,
    };
  } catch (err) {
    return {
      ok: false,
      status: "offline",
      error: err?.message ?? "probe failed",
      ucb_only: true,
      service,
    };
  }
}

export async function slackPostMessage({ channel, text, ...opts } = {}) {
  if (!channel) throw new Error("channel required");
  const res = await ucbFetch("slack", "chat.postMessage", {
    method: "POST",
    body: JSON.stringify({ channel, text: text ?? "" }),
    ...opts,
  });
  const json = await res.json().catch(() => ({ ok: false, error: "non_json" }));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `slack http_${res.status}`);
  }
  return json;
}

export async function jiraCreateIssue({
  projectKey,
  issueType = "Task",
  summary,
  description,
  ...opts
} = {}) {
  if (!projectKey) throw new Error("project key required");
  if (!summary) throw new Error("summary required");
  const payload = {
    fields: {
      project: { key: projectKey },
      issuetype: { name: issueType },
      summary,
    },
  };
  if (description) {
    payload.fields.description = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: description }],
        },
      ],
    };
  }
  const res = await ucbFetch("jira", "rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify(payload),
    ...opts,
  });
  const json = await res.json().catch(() => ({ ok: false, error: "non_json" }));
  if (!res.ok) {
    const msg = (json.errorMessages && json.errorMessages[0]) || json.error || `jira http_${res.status}`;
    throw new Error(msg);
  }
  return json;
}
