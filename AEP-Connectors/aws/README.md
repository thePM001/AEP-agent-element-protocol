# AWS Connector

**Registry id:** `connector-aws`  
**UCB-only:** all traffic via `/ucb/v1/egress/aws/**`

## Auth

Set `AEP_AWS_SESSION_TOKEN` in the environment. UCB injects it as Bearer on egress proxy.

## Default upstream

`https://sts.amazonaws.com`

Override in CCA plan `connectors.aws` or task manifest egress routes.

## MCP / Nango

Optional MCP servers from [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) or self-hosted [Nango](https://github.com/nangohq/nango) may sit upstream - still reached only through UCB egress.
