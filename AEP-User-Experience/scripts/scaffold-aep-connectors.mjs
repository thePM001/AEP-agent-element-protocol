#!/usr/bin/env node
/** Generate connector lib stubs from AEP-Connectors/catalog.json */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const catalog = JSON.parse(readFileSync(join(REPO, "AEP-Connectors/catalog.json"), "utf8"));

const LIB_TEMPLATE = (spec) => `#!/usr/bin/env node
import { probeTcpHost } from "../../../AEP-Components/cca/lib/environment-probe.mjs";
import {
  buildEgressRoutes,
  connectorExtension,
  probeHttpsRoot,
  probeTcpUpstream,
} from "../../lib/connector-kit.mjs";

export const SPEC = {
  id: "${spec.id}",
  service: "${spec.service}",
  label: "${spec.label}",
  upstream: "${spec.upstream}",
  authTokenEnv: "${spec.auth_token_env}",
  keywords: ${JSON.stringify(spec.keywords)},
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

export function ${spec.service.replace(/-/g, "_")}ConnectorExtension(config) {
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
`;

const README_TEMPLATE = (spec) => `# ${spec.label} Connector

**Registry id:** \`${spec.id}\`  
**UCB-only:** all traffic via \`/ucb/v1/egress/${spec.service}/**\`

## Auth

Set \`${spec.auth_token_env}\` in the environment. UCB injects it as Bearer on egress proxy.

## Default upstream

\`${spec.upstream}\`

Override in CCA plan \`connectors.${spec.service}\` or task manifest egress routes.

## MCP / Nango

Optional MCP servers from [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) or self-hosted [Nango](https://github.com/nangohq/nango) may sit upstream - still reached only through UCB egress.
`;

for (const spec of catalog.connectors) {
  const dir = join(REPO, "AEP-Connectors", spec.folder);
  const libDir = join(dir, "lib");
  mkdirSync(libDir, { recursive: true });
  const libFile = join(libDir, `${spec.service}-connector.mjs`);
  if (!existsSync(libFile) || spec.id !== "connector-postgres") {
    writeFileSync(libFile, LIB_TEMPLATE(spec));
  }
  writeFileSync(join(dir, "README.md"), README_TEMPLATE(spec));
  console.log(`  ${spec.id}`);
}

console.log(`Scaffolded ${catalog.connectors.length} connectors.`);