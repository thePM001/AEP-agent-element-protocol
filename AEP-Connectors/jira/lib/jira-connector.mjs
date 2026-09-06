#!/usr/bin/env node
import {
  buildEgressRoutes,
  connectorExtension,
  probeViaUcb,
  jiraCreateIssue as kitJiraCreate,
} from "../../lib/connector-kit.mjs";

export const SPEC = {
  id: "connector-jira",
  service: "jira",
  label: "Jira",
  upstream: "https://api.atlassian.com",
  authTokenEnv: "AEP_JIRA_API_TOKEN",
  keywords: ["jira","atlassian","jira ticket","jira issue"],
  accessRules: [
    { action: "ALLOW", method: "POST", path: "/jira/rest/api/3/issue" },
    { action: "ALLOW", method: "GET", path: "/jira/rest/api/3/myself" },
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

export function jiraConnectorExtension(config) {
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
  return probeViaUcb(SPEC.service, "rest/api/3/myself", { method: "GET", ...opts });
}

export async function createIssue({ projectKey, issueType, summary, description, config, ...opts } = {}) {
  const v = validateConfig(config);
  if (!v.valid) throw new Error(v.errors.join("; "));
  return kitJiraCreate({ projectKey, issueType, summary, description, ...opts });
}
