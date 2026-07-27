# AEP-Connectors

External API, SaaS, and database connectors for AEP 2.8. **Every connector routes exclusively through UCB** (Universal Connect Bridge, port `8412`). Agents never call third-party APIs directly.

## Architecture (UCB-only)

```
Agent / Composer / CCA plan
        |
        v
  Task manifest egress.routes  (compiled per connector)
        |
        v
+------------------+
|  aep-ucb :8412   |  POST/GET /ucb/v1/egress/{service}/**
+--------+---------+  credential injection (auth_token_env)
         |            access_rules (ALLOW/DENY per method+path)
         v
   Upstream API (Slack, Jira, AWS, Postgres, ...)
```

**Invariants**

1. No raw `fetch()` to external hosts from governed components - use `latticeGatedFetch` to UCB egress paths only.
2. Each connector ships **deterministic egress route templates** (Compiled AI pattern): config in → manifest routes out.
3. Credentials live in environment variables; UCB injects Bearer tokens at proxy time.
4. Optional MCP backends are reached via UCB `POST /mcp`, not direct MCP sockets from agents.

## What Postgres connector is today

`connector-postgres` is the **reference scaffold** (NT-00006 pattern):

- Normalizes connection config for CCA plans and `base-node.json`
- TCP reachability probe (no npm `pg` driver in Docker)
- Emits UCB egress routes for governed SQL proxy upstreams

It is **not** a full SQL driver. Real queries flow through UCB egress to your Postgres proxy or MCP SQL server.

## Connector catalog

| ID | Service | Upstream | Auth env |
|----|---------|----------|----------|
| `connector-postgres` | PostgreSQL | configurable host | `AEP_POSTGRES_PASSWORD` |
| `connector-slack` | Slack Web API | `https://slack.com/api` | `AEP_SLACK_BOT_TOKEN` |
| `connector-jira` | Jira Cloud/DC | `https://{host}/rest/api` | `AEP_JIRA_API_TOKEN` |
| `connector-notion` | Notion API | `https://api.notion.com` | `AEP_NOTION_TOKEN` |
| `connector-hubspot` | HubSpot CRM | `https://api.hubapi.com` | `AEP_HUBSPOT_TOKEN` |
| `connector-odoo` | Odoo JSON-RPC | configurable | `AEP_ODOO_API_KEY` |
| `connector-google-workspace` | Google Workspace | `https://www.googleapis.com` | `AEP_GWS_ACCESS_TOKEN` |
| `connector-gcp` | Google Cloud APIs | `https://cloudresourcemanager.googleapis.com` | `AEP_GCP_ACCESS_TOKEN` |
| `connector-aws` | AWS APIs | configurable regional endpoint | `AEP_AWS_*` (SigV4 via proxy) |
| `connector-azure` | Azure Resource Manager | `https://management.azure.com` | `AEP_AZURE_ACCESS_TOKEN` |
| `connector-n8n` | n8n workflows | configurable instance `/api/v1` | `AEP_N8N_API_KEY` |
| `connector-make` | Make (Integromat) | `https://{region}.make.com/api/v2` | `AEP_MAKE_API_TOKEN` |
| `connector-zapier` | Zapier Platform | `https://api.zapier.com/v1` | `AEP_ZAPIER_API_KEY` |

Registry: `catalog.json` + `AEP-Base-Node/registry/components/connector-*.json`.

## Open-source integration strategy

AEP does **not** vendor a monolithic connector runtime. We compose:

| Layer | Role | Examples |
|-------|------|----------|
| **UCB egress** | Mandatory perimeter, manifest ACLs, credential injection | `AEP-Docks/ucb/` |
| **AEP-Connectors** | Compiled route templates + probes + CCA/composer metadata | this folder |
| **MCP servers** (optional) | Tool-level integrations behind UCB `/mcp` | [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) |
| **Nango** (optional, self-hosted) | OAuth + unified API proxy upstream | [nangohq/nango](https://github.com/nangohq/nango) behind UCB egress |

Nango or MCP sits **upstream of UCB**, never beside it. Configure `upstream` in egress routes to point at your self-hosted Nango proxy when you need OAuth-heavy SaaS at scale.

## Adding a connector

1. Create `AEP-Connectors/{service}/lib/{service}-connector.mjs` using `../lib/connector-kit.mjs`.
2. Add manifest `AEP-Base-Node/registry/components/connector-{service}.json`.
3. Register in `catalog.json` and `AEP-Connectors/catalog.json`.
4. CCA auto-matches `connector-*` ids from user intent keywords.

## CCA usage

When user mentions a service ("connect Slack", "Jira tickets", "AWS S3"), CCA:

1. Enables `ucb` (required for all connectors)
2. Enables matching `connector-*` component
3. Writes `plan.connectors` config + synthesizes `egress.routes` for task manifests