# Slack Connector

**Registry id:** `connector-slack`  
**UCB-only:** all traffic via `/ucb/v1/egress/slack/**`

## Auth

Set `AEP_SLACK_BOT_TOKEN` in the environment. UCB injects it as Bearer on egress proxy.

## Default upstream

`https://slack.com/api`

Override in CCA plan `connectors.slack` or task manifest egress routes.

## MCP / Nango

Optional MCP servers from [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) or self-hosted [Nango](https://github.com/nangohq/nango) may sit upstream - still reached only through UCB egress.
