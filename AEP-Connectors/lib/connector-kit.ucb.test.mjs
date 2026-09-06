/**
 * AEP28-ENV-054: Slack and Jira real clients through UCB only.
 */
import assert from "node:assert/strict";
import {
  assertUcbOnlyUrl,
  ucbEgressUrl,
  slackPostMessage,
  jiraCreateIssue,
  probeViaUcb,
  defaultUcbUrl,
  hostIsVendor,
  buildEgressRoutes,
} from "./connector-kit.mjs";
import { postMessage, probe as slackProbe, SPEC as slackSpec } from "../slack/lib/slack-connector.mjs";
import { createIssue, probe as jiraProbe, SPEC as jiraSpec } from "../jira/lib/jira-connector.mjs";

try {
  assertUcbOnlyUrl("https://slack.com/api/chat.postMessage");
  throw new Error("vendor slack url should deny");
} catch (e) {
  if (String(e.message).includes("vendor") === false) throw e;
}

try {
  assertUcbOnlyUrl("https://api.atlassian.com/rest/api/3/issue");
  throw new Error("vendor jira url should deny");
} catch (e) {
  if (String(e.message).includes("vendor") === false) throw e;
}

assert.equal(hostIsVendor("slack.com"), true);
assert.equal(hostIsVendor("127.0.0.1"), false);

const u = ucbEgressUrl("slack", "chat.postMessage");
assert.equal(u, defaultUcbUrl() + "/ucb/v1/egress/slack/chat.postMessage");

let seen;
const fetchFn = async (url, init) => {
  seen = { url, init };
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, ts: "1", channel: "C1" }),
  };
};
const r = await slackPostMessage({ channel: "C1", text: "hi", fetchFn });
assert.equal(seen.url, defaultUcbUrl() + "/ucb/v1/egress/slack/chat.postMessage");
assert.equal(seen.init.method, "POST");
assert.equal(r.ok, true);
assert.match(String(seen.init.body), /C1/);

const r2 = await postMessage({ channel: "C1", text: "hi", fetchFn });
assert.equal(r2.ok, true);

let seenJ;
const fetchJ = async (url, init) => {
  seenJ = { url, init };
  return {
    ok: true,
    status: 201,
    json: async () => ({ id: "10000", key: "AB-1" }),
  };
};
const j = await jiraCreateIssue({ projectKey: "AB", summary: "hi", fetchFn: fetchJ });
assert.equal(seenJ.url, defaultUcbUrl() + "/ucb/v1/egress/jira/rest/api/3/issue");
assert.equal(j.key, "AB-1");

const j2 = await createIssue({ projectKey: "AB", summary: "hi", fetchFn: fetchJ });
assert.equal(j2.key, "AB-1");

const p = await slackProbe({}, { fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) });
assert.equal(p.ucb_only, true);
assert.equal(p.service, "slack");

const pj = await jiraProbe({}, { fetchFn: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
assert.equal(pj.ucb_only, true);
assert.equal(pj.service, "jira");

const pv = await probeViaUcb("notion", "", { fetchFn: async (url) => {
  assert.match(url, /\/ucb\/v1\/egress\/notion$/);
  return { ok: true, status: 200, json: async () => ({}) };
}});
assert.equal(pv.ucb_only, true);

const slackRoutes = buildEgressRoutes(slackSpec, {});
assert.equal(slackRoutes[0].access_rules.some((a) => a.path === "/slack/chat.postMessage"), true);
const jiraRoutes = buildEgressRoutes(jiraSpec, {});
assert.equal(jiraRoutes[0].access_rules.some((a) => a.path === "/jira/rest/api/3/issue"), true);

console.log("UCB connector clients OK");
