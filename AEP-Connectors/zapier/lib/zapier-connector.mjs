#!/usr/bin/env node
import { probeTcpHost } from "../../../AEP-Components/cca/lib/environment-probe.mjs";
import {
  buildEgressRoutes,
  connectorExtension,
  probeHttpsRoot,
  probeTcpUpstream,
} from "../../lib/connector-kit.mjs";

export const SPEC = {
  id: "connector-zapier",
  service: "zapier",
  label: "Zapier",
  upstream: "https://api.zapier.com/v1",
  authTokenEnv: "AEP_ZAPIER_API_KEY",
  keywords: ["zapier","zap","zapier automation","zapier workflow"],
};

const DEFAULTS = {
  upstream: SPEC.upstream,
  auth_token_env: SPEC.authTokenEnv,
};

export function normalizeConfig(raw = {}) {
  return {
    upstream: String(raw.upstream ?? DEFAULTS.upstream).trim(),
    auth_token_env: String(raw.auth_token_env ?? DEFAULTS.auth_token_env).trim(),
    ...raw,
  };
}

export function validateConfig(config) {
  const c = normalizeConfig(config);
  const errors = [];
  if (!c.upstream) errors.push("upstream required");
  if (!c.auth_token_env) errors.push("auth_token_env required");
  return { valid: errors.length === 0, errors, config: c };
}

export function zapierConnectorExtension(config) {
  const v = validateConfig(config);
  if (!v.valid) throw new Error(v.errors.join("; "));
  return connectorExtension(SPEC, v.config);
}

export function egressRoutesForManifest(config) {
  return buildEgressRoutes(SPEC, normalizeConfig(config));
}

export async function probe(config) {
  const v = validateConfig(config);
  if (!v.valid) return { ok: false, status: "invalid_config", errors: v.errors, ucb_only: true };
  const url = v.config.upstream;
  if (url.startsWith("http://") && !url.includes("://localhost")) {
    try {
      const u = new URL(url);
      if (u.port || u.hostname) {
        const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
        return probeTcpUpstream(u.hostname, port, probeTcpHost);
      }
    } catch { /* fall through */ }
  }
  return probeHttpsRoot(url);
}
