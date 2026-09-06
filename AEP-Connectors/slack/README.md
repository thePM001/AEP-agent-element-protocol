# Slack Connector

**Registry id:** `connector-slack`
**UCB-only:** all traffic via `/ucb/v1/egress/slack/**`

## Post a message

`postMessage({ channel, text })` sends Slack `chat.postMessage` through UCB. UCB injects `AEP_SLACK_BOT_TOKEN` as Bearer on the egress proxy. This is a real client.

## Probe

`probe` calls UCB `POST /slack/auth.test`.

## Auth

Set `AEP_SLACK_BOT_TOKEN` in the environment.

## Default upstream

`https://slack.com/api` is UCB route metadata. Connectors call UCB rather than that host.

## Access rules

Manifest routes allow `POST /slack/chat.postMessage` and `POST|GET /slack/auth.test`.
