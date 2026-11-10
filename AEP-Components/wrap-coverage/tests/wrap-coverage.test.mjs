// Wrap coverage report: every credential, egress route, tool and lattice grant
// of a deployment is listed with the wrap that governs it. An entry that no
// wrap governs is UNMATCHED.

import { describe, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  InventoryError,
  addWrapsFromDocuments,
  buildCoverage,
  cawEntries,
  coverageForFile,
  findWrapFor,
  formatText,
  grantCovers,
  isCatchAllNetworkRule,
  loadInventory,
  main,
  parseDocuments,
  validateInventory,
} from "../lib/wrap-coverage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const FIXTURES = join(HERE, "fixtures");
const E2E = join(ROOT, "AEP-User-Experience/examples/end-to-end-run/deployment/wrap-coverage.yaml");

/**
 * @param {string} name
 */
function fixture(name) {
  return join(FIXTURES, name);
}

/**
 * @param {ReturnType<typeof coverageForFile>} report
 * @param {string} kind
 * @param {string} id
 */
function entry(report, kind, id) {
  const found = report.entries.filter((e) => e.kind === kind && e.id === id);
  expect(found, `${kind} ${id}`).toHaveLength(1);
  const first = found[0];
  if (first === undefined) throw new Error(`no entry ${kind} ${id}`);
  return first;
}

/**
 * Run the command line body in this process. The script calls the same main with the
 * arguments after its path and sets the exit code to its answer.
 * @param {string[]} args
 */
function runCli(args) {
  let stdout = "";
  let stderr = "";
  const status = main(args, {
    out: (s) => {
      stdout += s;
    },
    err: (s) => {
      stderr += s;
    },
  });
  return { status, stdout, stderr };
}

describe("wrap coverage on the end-to-end example", () => {
  it("the end-to-end inventory has zero unmatched entries", () => {
    const report = coverageForFile(E2E);
    expect(report.summary.unmatched).toBe(0);
    expect(report.summary.entries).toBeGreaterThan(0);
    expect(report.summary.matched).toBe(report.summary.entries - report.summary.neutralized);
    for (const e of report.entries) expect(e.wrap, `${e.kind} ${e.id}`).toBe("caw");
  });

  it("the end-to-end inventory covers its credentials, tool, lattice grants and CAW egress", () => {
    const report = coverageForFile(E2E);
    const kinds = new Set(report.entries.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(["action_grant", "credential", "egress_route", "tool"]);
    expect(entry(report, "egress_route", "network_rules.allow-dock-gateway-loopback").status).toBe("MATCHED");
    expect(report.inventory).toBe("AEP-User-Experience/examples/end-to-end-run/deployment/wrap-coverage.yaml");
  });
});

describe("wrap coverage matching rules", () => {
  const report = coverageForFile(fixture("mixed.yaml"));

  it("a credential without a grant is unmatched", () => {
    const e = entry(report, "credential", "cred-orphan");
    expect(e.status).toBe("UNMATCHED");
    expect(e.wrap).toBeNull();
    expect(e.reason).toBe("no wrap grants agent-a write:docs");
    expect(entry(report, "credential", "cred-granted")).toMatchObject({ status: "MATCHED", wrap: "alpha" });
  });

  it("a tool without a grant is unmatched even when a GAP document with an empty wrap grants it", () => {
    expect(entry(report, "tool", "tool-orphan")).toMatchObject({
      status: "UNMATCHED",
      reason: "no wrap grants agent-c deploy:prod",
    });
    expect(entry(report, "tool", "tool-granted")).toMatchObject({ status: "MATCHED", wrap: "alpha" });
  });

  it("a star grant covers any action or any agent", () => {
    expect(entry(report, "credential", "cred-star-action")).toMatchObject({ status: "MATCHED", wrap: "alpha" });
    expect(entry(report, "credential", "cred-star-agent")).toMatchObject({ status: "MATCHED", wrap: "beta" });
    expect(grantCovers({ agent_id: "*", action: "*" }, "anyone", "anything")).toBe(true);
    expect(grantCovers({ agent_id: "agent-a", action: "*" }, "agent-b", "read:docs")).toBe(false);
  });

  it("a lattice grant that no wrap grants is unmatched", () => {
    expect(entry(report, "action_grant", "read:docs@agent-a")).toMatchObject({ status: "MATCHED", wrap: "alpha" });
    expect(entry(report, "action_grant", "write:docs@agent-a")).toMatchObject({
      status: "UNMATCHED",
      reason: "no wrap grants agent-a write:docs",
    });
  });

  it("a star lattice grant is its own entry and needs a star agent grant", () => {
    expect(entry(report, "action_grant", "tool:run@*")).toMatchObject({ status: "MATCHED", wrap: "beta" });
    expect(entry(report, "action_grant", "deploy:prod@*")).toMatchObject({ status: "UNMATCHED" });
    expect(report.entries.some((e) => e.id.startsWith("closed:action"))).toBe(false);
  });

  it("a CAW catch-all allow rule without unmatched_egress deny is unmatched", () => {
    expect(entry(report, "egress_route", "network_rules.allow-everything")).toMatchObject({
      status: "UNMATCHED",
      reason: "catch-all allow rule lets unnamed destinations through",
      source: "AEP-Components/wrap-coverage/tests/fixtures/caw/open.yaml",
    });
    expect(entry(report, "egress_route", "network_rules.approve-any-address")).toMatchObject({
      status: "UNMATCHED",
      reason: "catch-all approve rule lets unnamed destinations through",
    });
  });

  it("a CAW catch-all rule under unmatched_egress deny is neutralized", () => {
    const e = entry(report, "egress_route", "network_rules.allow-all");
    expect(e.status).toBe("NEUTRALIZED");
    expect(e.source).toBe("AEP-Components/wrap-coverage/tests/fixtures/caw/neutralized.yaml");
    expect(report.summary.neutralized).toBe(1);
  });

  it("explicit CAW network rules match the policy wrap and deny rules are not entries", () => {
    expect(entry(report, "egress_route", "network_rules.allow-docs-api")).toMatchObject({ status: "MATCHED", wrap: "alpha" });
    expect(report.entries.some((e) => e.id === "network_rules.deny-rest")).toBe(false);
  });

  it("every entry of a CAW policy whose wrap no GAP document declares is unmatched", () => {
    const fromUndeclared = report.entries.filter((e) => e.source.endsWith("caw/undeclared.yaml"));
    expect(fromUndeclared).toHaveLength(2);
    for (const e of fromUndeclared) {
      expect(e.status).toBe("UNMATCHED");
      expect(e.reason).toBe("wrap nowhere is not declared by any GAP document");
    }
  });

  it("an MCP star tool or a tool without a name is an unmatched catch-all tool grant", () => {
    expect(entry(report, "tool", "mcp_rules.files/*")).toMatchObject({ status: "UNMATCHED", reason: "catch-all tool grant" });
    expect(entry(report, "tool", "mcp_rules.files/[2]")).toMatchObject({ status: "UNMATCHED", reason: "catch-all tool grant" });
    expect(entry(report, "tool", "mcp_rules.files/read_file")).toMatchObject({ status: "MATCHED", wrap: "alpha" });
  });

  it("an http_service upstream and its secret match the policy wrap", () => {
    expect(entry(report, "egress_route", "http_services.docs-api")).toMatchObject({ status: "MATCHED", wrap: "alpha" });
    expect(entry(report, "credential", "http_services.docs-api.secret")).toMatchObject({ status: "MATCHED", wrap: "alpha" });
    expect(entry(report, "egress_route", "http_services.open-data")).toMatchObject({ status: "MATCHED" });
    expect(report.entries.some((e) => e.id === "http_services.open-data.secret")).toBe(false);
  });

  it("the summary counts every entry once", () => {
    expect(report.summary).toEqual({ entries: 23, matched: 12, unmatched: 10, neutralized: 1 });
    const text = formatText(report);
    expect(text.trimEnd().split("\n").pop()).toBe("wrap coverage: 23 entries, 12 matched, 10 unmatched, 1 neutralized");
    expect(text).toContain("UNMATCHED credential cred-orphan no wrap grants agent-a write:docs AEP-Components/wrap-coverage/tests/fixtures/mixed.yaml");
  });

  it("a catch-all is neutralized only in a policy that sets unmatched_egress deny", () => {
    const clean = coverageForFile(fixture("clean.yaml"));
    expect(clean.summary).toEqual({ entries: 3, matched: 2, unmatched: 0, neutralized: 1 });
  });
});

describe("wrap coverage of UCB manifests", () => {
  const report = coverageForFile(fixture("ucb.yaml"));

  it("UCB manifest routes and token envs match when a wrap grants the manifest agent", () => {
    expect(entry(report, "egress_route", "ucb-agent:egress/docs")).toMatchObject({ status: "MATCHED", wrap: "gamma" });
    expect(entry(report, "credential", "ucb-agent:env:DOCS_TOKEN")).toMatchObject({ status: "MATCHED", wrap: "gamma" });
    expect(entry(report, "egress_route", "ucb-agent:egress/plain")).toMatchObject({ status: "MATCHED" });
  });

  it("UCB manifest routes and token envs are unmatched when no wrap grants the manifest agent", () => {
    for (const id of ["stranger:egress/out", "stranger:env:OUT_TOKEN"]) {
      const e = report.entries.find((x) => x.id === id);
      expect(e, id).toMatchObject({ status: "UNMATCHED", reason: "no wrap grants agent stranger any action" });
    }
    expect(report.summary.unmatched).toBe(2);
  });
});

describe("wrap coverage pure helpers", () => {
  it("isCatchAllNetworkRule classifies wildcard rules", () => {
    expect(isCatchAllNetworkRule({ decision: "allow" })).toBe(true);
    expect(isCatchAllNetworkRule({ domains: ["*"], ports: [443] })).toBe(true);
    expect(isCatchAllNetworkRule({ cidrs: ["0.0.0.0/0"] })).toBe(true);
    expect(isCatchAllNetworkRule({ cidrs: ["0.0.0.0/0", "::/0"], domains: ["*"] })).toBe(true);
    expect(isCatchAllNetworkRule({ cidrs: ["10.0.0.0/8"] })).toBe(false);
    expect(isCatchAllNetworkRule({ cidrs: ["0.0.0.0/0", "10.0.0.0/8"] })).toBe(false);
    expect(isCatchAllNetworkRule({ domains: ["**"] })).toBe(true);
    expect(isCatchAllNetworkRule({ domains: ["*.*", "?*"], ports: [443] })).toBe(true);
    expect(isCatchAllNetworkRule({ domains: ["*.example.com"] })).toBe(false);
    expect(isCatchAllNetworkRule({ domains: ["docs.example.com"] })).toBe(false);
    expect(isCatchAllNetworkRule({ cidrs: ["::/0"], domains: ["docs.example.com"] })).toBe(false);
  });

  it("multi-document GAP files declare one wrap per document and a profile document declares none", () => {
    const text = "metadata:\n  wrap: one\n  agent_permission:\n    - agent_id: a\n      action: x\n---\nkind: aep.caw.profile\n---\n";
    const docs = parseDocuments(text, "inline");
    expect(docs).toHaveLength(2);
    const table = addWrapsFromDocuments(new Map(), docs, "inline");
    expect([...table.keys()]).toEqual(["one"]);
    expect(findWrapFor(table, "a", "x")).toBe("one");
    expect(findWrapFor(table, "a", "y")).toBeNull();
  });

  it("a CAW policy with an unknown unmatched_egress value is rejected", () => {
    expect(() => cawEntries({ unmatched_egress: "allow" }, "w", new Map(), "inline")).toThrow(InventoryError);
    expect(() => coverageForFile(fixture("bad-mode.yaml"))).toThrow(/unmatched_egress/);
  });

  it("buildCoverage resolves inventory paths against the base folder", () => {
    const { inventory, baseDir } = loadInventory(fixture("clean.yaml"));
    const report = buildCoverage(inventory, baseDir);
    expect(report.summary.unmatched).toBe(0);
  });
});

describe("wrap coverage inventory validation", () => {
  it("an inventory with a wrong kind is rejected", () => {
    expect(() => loadInventory(fixture("invalid/wrong-kind.yaml"))).toThrow(/kind must be aep.wrap-coverage.inventory/);
  });

  it("an inventory with a wrong version is rejected", () => {
    expect(() => loadInventory(fixture("invalid/wrong-version.yaml"))).toThrow(/version must be 1/);
  });

  it("an inventory with an unknown top-level key is rejected", () => {
    expect(() => loadInventory(fixture("invalid/unknown-key.yaml"))).toThrow(/unknown key secrets/);
  });

  it("an inventory credential without an action is rejected", () => {
    expect(() => loadInventory(fixture("invalid/credential-without-action.yaml"))).toThrow(/action is required/);
    expect(() => validateInventory(["not", "a", "mapping"])).toThrow(InventoryError);
  });

  it("an inventory that names a missing GAP folder is rejected", () => {
    expect(() => coverageForFile(fixture("invalid/missing-gap-dir.yaml"))).toThrow(InventoryError);
  });
});

describe("wrap coverage command line", () => {
  it("the CLI exits 0 on the end-to-end inventory", () => {
    const run = runCli([E2E]);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/wrap coverage: \d+ entries, \d+ matched, 0 unmatched, 0 neutralized\n$/);
  });

  it("the CLI exits 1 when an entry is unmatched", () => {
    const run = runCli([fixture("mixed.yaml")]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("UNMATCHED tool mcp_rules.files/* catch-all tool grant");
  });

  it("the CLI exits 2 on an invalid or missing inventory", () => {
    expect(runCli([fixture("invalid/wrong-kind.yaml")]).status).toBe(2);
    expect(runCli([fixture("no-such-inventory.yaml")]).status).toBe(2);
    const usage = runCli([]);
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain("usage:");
  });

  it("the CLI prints one JSON object with --json", () => {
    const run = runCli([fixture("ucb.yaml"), "--json"]);
    expect(run.status).toBe(1);
    const parsed = JSON.parse(run.stdout);
    expect(parsed.inventory).toBe("AEP-Components/wrap-coverage/tests/fixtures/ucb.yaml");
    expect(parsed.summary).toEqual({ entries: 5, matched: 3, unmatched: 2, neutralized: 0 });
    expect(Object.keys(parsed.entries[0]).sort()).toEqual(["id", "kind", "reason", "source", "status", "wrap"]);
  });
});
