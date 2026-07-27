#!/usr/bin/env node
/** Register AEP-Connectors/catalog.json entries in AEP-Base-Node registry */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const catalog = JSON.parse(readFileSync(join(REPO, "AEP-Connectors/catalog.json"), "utf8"));
const registryCatalogPath = join(REPO, "AEP-Base-Node/registry/catalog.json");
const registryCatalog = JSON.parse(readFileSync(registryCatalogPath, "utf8"));
const componentsDir = join(REPO, "AEP-Base-Node/registry/components");

function manifestFor(spec) {
  const folder = spec.folder;
  return {
    manifest_version: "1",
    id: spec.id,
    version: "2.8.0",
    kind: "connector",
    path: `AEP-Connectors/${folder}/`,
    description: `UCB-only ${spec.label} connector. All traffic via /ucb/v1/egress/${spec.service}/**.`,
    requires: ["aep-base-node", "lattice-channels", "ucb", "composer-lite"],
    capabilities: [
      `connector:${spec.service}`,
      "ucb:egress-proxy",
      "integration:external-api",
    ],
    actions: [
      {
        id: `wire_${spec.service}`,
        description: `Wire ${spec.label} connector egress routes`,
        runtime: "plan",
        method: "connector_config",
      },
      {
        id: `probe_${spec.service}`,
        description: `Health probe for ${spec.label}`,
        runtime: "connector",
        method: "probe",
      },
    ],
    setup_hooks: [
      {
        id: `${spec.service}_connector_default`,
        policy_section: "connectors",
        default: { [spec.service]: { upstream: spec.upstream } },
      },
    ],
    composer: { palette: true, node_type: "connector" },
    composer_node: {
      type: "connector",
      label: spec.label,
      short: spec.label.slice(0, 2).toUpperCase(),
      color: "#475569",
      service: spec.service,
      ucb_only: true,
      description: `${spec.label} via UCB egress`,
      registry_id: spec.id,
    },
    resource_requirements: {
      min_memory_mb: 32,
      min_disk_mb: 10,
      requires_internet: true,
      gpu_required: false,
    },
    cca: {
      summary: `Connect ${spec.label}. Requires UCB. Routes: /ucb/v1/egress/${spec.service}/**.`,
      use_when: spec.keywords,
      avoid_when: ["air-gapped with no external APIs", "UCB disabled"],
      pairs_with: ["ucb", "aep-base-node", "composer-lite"],
    },
    implementation: {
      module: `AEP-Connectors/${folder}/lib/${spec.service}-connector.mjs`,
      ucb_egress_prefix: `/ucb/v1/egress/${spec.service}`,
      auth_token_env: spec.auth_token_env,
    },
    integration: {
      ucb_only: true,
      mcp_optional: spec.mcp_candidates ?? null,
      nango_compatible: true,
    },
  };
}

const existingIds = new Set(registryCatalog.components.map((c) => c.id));

for (const spec of catalog.connectors) {
  const manifest = manifestFor(spec);
  writeFileSync(join(componentsDir, `${spec.id}.json`), `${JSON.stringify(manifest, null, 2)}\n`);

  if (!existingIds.has(spec.id)) {
    registryCatalog.components.push({
      id: spec.id,
      name: spec.label,
      kind: "connector",
      bundled: true,
      default_enabled: false,
      composer_palette: true,
      path: `AEP-Connectors/${spec.folder}/`,
      description: manifest.description,
      manifest: `AEP-Base-Node/registry/components/${spec.id}.json`,
    });
    existingIds.add(spec.id);
  } else {
    const entry = registryCatalog.components.find((c) => c.id === spec.id);
    if (entry) {
      entry.path = `AEP-Connectors/${spec.folder}/`;
      entry.description = manifest.description;
      entry.composer_palette = true;
    }
  }
  console.log(`  registered ${spec.id}`);
}

writeFileSync(registryCatalogPath, `${JSON.stringify(registryCatalog, null, 2)}\n`);
console.log(`Catalog now has ${registryCatalog.components.length} components.`);