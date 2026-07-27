/**
 * TM-23: connector egress routes must match UCB remainder-path evaluation.
 */
import { buildEgressRoutes, ucbEgressPrefix } from "./connector-kit.mjs";
import assert from "node:assert/strict";

const spec = {
  id: "connector-slack",
  service: "slack",
  label: "Slack",
  upstream: "https://slack.com/api",
  authTokenEnv: "AEP_SLACK_BOT_TOKEN",
  keywords: ["slack"],
};

const prefix = ucbEgressPrefix(spec);
assert.equal(prefix, "/slack", "prefix must be remainder path /{service}");
assert.ok(!prefix.includes("ucb/v1/egress"), "must not embed full UCB capture path");

const routes = buildEgressRoutes(spec, {});
assert.equal(routes.length, 1);
assert.equal(routes[0].path_prefix, "/slack");
assert.equal(routes[0].strip_prefix, "/slack");
assert.ok(routes[0].access_rules.every((r) => r.path.startsWith("/slack")));

// Simulate UCB remainder match (path boundary)
function prefixMatches(path, p) {
  return path === p || path.startsWith(p + "/");
}
assert.ok(prefixMatches("/slack/api/chat.postMessage", routes[0].path_prefix));
assert.ok(!prefixMatches("/slackevil/x", routes[0].path_prefix));

console.log("TM-23 connector-kit OK");
