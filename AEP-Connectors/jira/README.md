# Jira Connector

**Registry id:** `connector-jira`
**UCB-only:** all traffic via `/ucb/v1/egress/jira/**`

## Create an issue

`createIssue({ projectKey, issueType, summary, description })` posts `/rest/api/3/issue` through UCB. UCB injects `AEP_JIRA_API_TOKEN` as Bearer on the egress proxy. This is a real client.

## Probe

`probe` calls UCB `GET /jira/rest/api/3/myself`.

## Auth

Set `AEP_JIRA_API_TOKEN` in the environment.

## Default upstream

`https://api.atlassian.com` is UCB route metadata. Connectors call UCB rather than that host.

## Access rules

Manifest routes allow `POST /jira/rest/api/3/issue` and `GET /jira/rest/api/3/myself`.
