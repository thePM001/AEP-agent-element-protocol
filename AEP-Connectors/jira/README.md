# Jira Connector

**Registry id:** `connector-jira`  
**UCB-only:** all traffic via `/ucb/v1/egress/jira/**`

## Auth

Set `AEP_JIRA_API_TOKEN` in the environment. UCB injects it as Bearer on egress proxy.

## Default upstream

`https://api.atlassian.com`

Override in CCA plan `connectors.jira` or task manifest egress routes.

## MCP / Nango

Optional MCP servers from [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) or self-hosted [Nango](https://github.com/nangohq/nango) may sit upstream - still reached only through UCB egress.
