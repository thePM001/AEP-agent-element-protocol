# PostgreSQL Connector

**Registry id:** `connector-postgres`  
**UCB-only:** all traffic via `/ucb/v1/egress/postgres/**`

## Auth

Set `AEP_POSTGRES_PASSWORD` in the environment. UCB injects it as Bearer on egress proxy.

## Default upstream

`http://postgres:5432`

Override in CCA plan `connectors.postgres` or task manifest egress routes.

## MCP / Nango

Optional MCP servers from [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) or self-hosted [Nango](https://github.com/nangohq/nango) may sit upstream - still reached only through UCB egress.
