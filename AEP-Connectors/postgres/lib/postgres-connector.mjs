#!/usr/bin/env node

import { probeTcpHost } from "../../../AEP-Components/cca/lib/environment-probe.mjs";
import {
  buildEgressRoutes,
  connectorExtension,
  probeTcpUpstream,
} from "../../lib/connector-kit.mjs";

export const SPEC = {
  id: "connector-postgres",
  service: "postgres",
  label: "PostgreSQL",
  upstream: "http://postgres:5432",
  authTokenEnv: "AEP_POSTGRES_PASSWORD",
  keywords: ["postgres", "postgresql", "sql database"],
};

const DEFAULTS = {
  host: "postgres",
  port: 5432,
  database: "aep_evidence",
  user: "aep",
  ssl_mode: "require",
};

/**
 * @param {object} [raw]
 */
export function normalizePostgresConfig(raw = {}) {
  const host = String(raw.host ?? DEFAULTS.host).trim();
  const port = Number(raw.port ?? DEFAULTS.port);
  return {
    host,
    port,
    database: String(raw.database ?? DEFAULTS.database).trim(),
    user: String(raw.user ?? DEFAULTS.user).trim(),
    ssl_mode: String(raw.ssl_mode ?? DEFAULTS.ssl_mode).trim(),
    password_env: raw.password_env ? String(raw.password_env) : "AEP_POSTGRES_PASSWORD",
    upstream: raw.upstream ?? `http://${host}:${port}`,
    auth_token_env: raw.password_env ?? SPEC.authTokenEnv,
  };
}

/**
 * @param {object} config
 */
export function validatePostgresConfig(config) {
  const errors = [];
  const c = normalizePostgresConfig(config);
  if (!c.host) errors.push("postgres host required");
  if (!Number.isFinite(c.port) || c.port < 1 || c.port > 65535) errors.push("invalid postgres port");
  if (!c.database) errors.push("postgres database required");
  return { valid: errors.length === 0, errors, config: c };
}

/**
 * UCB egress routes for governed Postgres proxy upstream.
 * @param {object} config
 */
export function egressRoutesForManifest(config) {
  const v = validatePostgresConfig(config);
  return buildEgressRoutes(SPEC, v.config);
}

/**
 * @param {object} config
 */
export function postgresConnectorExtension(config) {
  const v = validatePostgresConfig(config);
  if (!v.valid) throw new Error(v.errors.join("; "));
  const ext = connectorExtension(SPEC, v.config);
  return {
    ...ext,
    storage_backend: "postgres",
    config: {
      host: v.config.host,
      port: v.config.port,
      database: v.config.database,
      user: v.config.user,
      ssl_mode: v.config.ssl_mode,
      password_env: v.config.password_env,
    },
  };
}

/**
 * @param {object} config
 */
export async function probePostgres(config) {
  const v = validatePostgresConfig(config);
  if (!v.valid) {
    return { ok: false, status: "invalid_config", errors: v.errors, ucb_only: true };
  }
  const result = await probeTcpUpstream(v.config.host, v.config.port, probeTcpHost);
  return {
    ...result,
    database: v.config.database,
    lattice_gated: true,
    transport: "ucb-egress",
  };
}