# Google Cloud Connector

**Registry id:** `connector-gcp`  
**UCB-only:** all traffic via `/ucb/v1/egress/gcp/**`

## Auth

Set `AEP_GCP_ACCESS_TOKEN` in the environment. UCB injects it as Bearer on egress proxy.

## Default upstream

`https://cloudresourcemanager.googleapis.com`

Override in CCA plan `connectors.gcp` or task manifest egress routes.

## MCP / Nango

Optional MCP servers from [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) or self-hosted [Nango](https://github.com/nangohq/nango) may sit upstream - still reached only through UCB egress.
