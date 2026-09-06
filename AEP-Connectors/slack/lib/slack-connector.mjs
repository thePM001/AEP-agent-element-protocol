#!/usr/bin/env node
import {
  buildEgressRoutes,
  connectorExtension,
  probeViaUcb,
  slackPostMessage as kitSlackPost,
} from "../../lib/connector-kit.mjs";

export const SPEC = {
  id: "connector-slack",
  service: "slack",
  label: "Slack",
  upstream: "https://slack.com/api",
  authTokenEnv: "AEP_SLACK_BOT_TOKEN",
  keywords: ["slack","slack channel","slack message"],
  accessRules: [
    { action: "ALLOW", method: "POST", path: "/slack/chat.postMessage" },
    { action: "ALLOW", method: "POST", path: "/slack/auth.test" },
    { action: "ALLOW", method: "GET", path: "/slack/auth.test" },
  ],
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

export function slackConnectorExtension(config) {
  const v = validateConfig(config);
  if (!v.valid) throw new Error(v.errors.join("; "));
  return connectorExtension(SPEC, v.config);
}

export function egressRoutesForManifest(config) {
  return buildEgressRoutes(SPEC, normalizeConfig(config));
}

export async function probe(config, opts = {}) {
  const v = validateConfig(config);
  if (!v.valid) return { ok: false, status: "invalid_config", errors: v.errors, ucb_only: true };
  return probeViaUcb(SPEC.service, "auth.test", { method: "POST", body: "{}", ...opts });
}

export async function postMessage({ channel, text, config, ...opts } = {}) {
  const v = validateConfig(config);
  if (!v.valid) throw new Error(v.errors.join("; "));
  return kitSlackPost({ channel, text, ...opts });
}
