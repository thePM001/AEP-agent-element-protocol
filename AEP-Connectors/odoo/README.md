# Odoo Connector

**Registry id:** `connector-odoo`  
**UCB-only:** all traffic via `/ucb/v1/egress/odoo/**`

## Auth

Set `AEP_ODOO_API_KEY` in the environment. UCB injects it as Bearer on egress proxy.

## Default upstream

`https://odoo.example.com`

Override in CCA plan `connectors.odoo` or task manifest egress routes.

## MCP / Nango

Optional MCP servers from [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) or self-hosted [Nango](https://github.com/nangohq/nango) may sit upstream - still reached only through UCB egress.
