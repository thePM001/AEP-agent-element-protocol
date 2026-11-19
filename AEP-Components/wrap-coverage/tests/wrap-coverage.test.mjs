// Wrap coverage report: every credential, egress route, tool and lattice grant
// of a deployment is listed with the wrap that governs it. An entry that no
// wrap governs is UNMATCHED.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  InventoryError,
  addWrapsFromDocuments,
  buildCoverage,
  coverageForFile,
  egressEntries,
  findWrapFor,
  formatText,
  grantCovers,
  loadInventory,
  main,
  parseDocuments,
  routeHostProblem,
  validateInventory,
} from "../lib/wrap-coverage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const FIXTURES = join(HERE, "fixtures");
const E2E = join(ROOT, "AEP-User-Experience/examples/end-to-end-run/deployment/wrap-coverage.yaml");
const REFERENCE_GAP = join(ROOT, "AEP-Components/gap/policies/reference");
const REPORT_SOURCE = join(HERE, "..", "lib", "wrap-coverage.mjs");

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
    expect(report.summary.matched).toBe(report.summary.entries);
    for (const e of report.entries) expect(e.wrap, `${e.kind} ${e.id}`).toBe("caw");
  });

  // The example deploys a CAW profile that opens no route, so its inventory names
  // no egress route.
  it("the end-to-end inventory covers its credentials, tool and lattice grants", () => {
    const report = coverageForFile(E2E);
    const kinds = new Set(report.entries.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(["action_grant", "credential", "tool"]);
    expect(entry(report, "action_grant", "ucb:ingest@agent-a").status).toBe("MATCHED");
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

  it("the summary counts every entry once", () => {
    expect(report.summary).toEqual({ entries: 10, matched: 6, unmatched: 4 });
    const text = formatText(report);
    expect(text.trimEnd().split("\n").pop()).toBe("wrap coverage: 10 entries, 6 matched, 4 unmatched");
    expect(text).toContain("UNMATCHED credential cred-orphan no wrap grants agent-a write:docs AEP-Components/wrap-coverage/tests/fixtures/mixed.yaml");
  });

  it("an inventory whose entries all have a wrap has no unmatched entry", () => {
    const clean = coverageForFile(fixture("clean.yaml"));
    expect(clean.summary).toEqual({ entries: 1, matched: 1, unmatched: 0 });
  });
});

describe("wrap coverage of CAW egress policies", () => {
  const report = coverageForFile(fixture("egress.yaml"));
  const source = "AEP-Components/wrap-coverage/tests/fixtures/gap-egress/egress.gap";

  it("a route of a CAW egress policy to any host is unmatched", () => {
    expect(entry(report, "egress_route", "open/any-host")).toMatchObject({
      status: "UNMATCHED",
      wrap: null,
      reason: "catch-all route lets any host through; the CAW refuses the policy",
      source,
    });
  });

  it("a wildcard over one top level label is a catch-all route", () => {
    expect(entry(report, "egress_route", "open/every-com-name")).toMatchObject({
      status: "UNMATCHED",
      reason: "catch-all route lets every name under .com through; the CAW refuses the policy",
    });
  });

  it("a route to an address is unmatched", () => {
    expect(entry(report, "egress_route", "open/an-address")).toMatchObject({
      status: "UNMATCHED",
      reason: "the route names an address instead of a host; the CAW refuses the policy",
    });
  });

  it("named routes, wildcards under a domain and a variable host match the wrap of their GAP file", () => {
    for (const id of ["named/docs-api", "named/below-example", "named/model-gateway"]) {
      expect(entry(report, "egress_route", id)).toMatchObject({ status: "MATCHED", wrap: "alpha", reason: null, source });
    }
  });

  it("a deny route is not an entry", () => {
    expect(report.entries.some((e) => e.id === "named/deny-rest")).toBe(false);
  });

  it("an egress policy whose unmatched is not deny is unmatched", () => {
    expect(entry(report, "egress_route", "loose")).toMatchObject({
      status: "UNMATCHED",
      reason: "unmatched is allow so a destination with no route would pass; the CAW refuses the policy",
    });
    expect(entry(report, "egress_route", "loose/docs-api")).toMatchObject({ status: "MATCHED", wrap: "alpha" });
  });

  it("every route of a GAP file whose instruction document declares no wrap is unmatched", () => {
    expect(entry(report, "egress_route", "stray/docs-api")).toMatchObject({
      status: "UNMATCHED",
      reason: "the GAP file declares no wrap",
      source: "AEP-Components/wrap-coverage/tests/fixtures/gap-egress-no-wrap/egress-no-wrap.gap",
    });
  });

  it("the egress summary counts every route once", () => {
    expect(report.summary).toEqual({ entries: 9, matched: 4, unmatched: 5 });
  });

  it("the egress policies of the reference profiles are covered", () => {
    const shipped = buildCoverage(
      { kind: "aep.wrap-coverage.inventory", version: 1, name: "reference", gap_dirs: [REFERENCE_GAP], lattice: null, ucb_manifests: [], credentials: [], tools: [] },
      ROOT,
    );
    const routes = shipped.entries.filter((e) => e.kind === "egress_route");
    expect(routes.length).toBeGreaterThan(0);
    for (const e of routes) expect(e, e.id).toMatchObject({ status: "MATCHED", wrap: "caw" });
    expect(routes.map((e) => e.id)).toContain("model-gateway/model-gateway");
  });

  it("routeHostProblem follows the host rules of the GAP compiler and the CAW", () => {
    expect(routeHostProblem("docs.example.com")).toBeNull();
    expect(routeHostProblem("*.example.com")).toBeNull();
    expect(routeHostProblem("${AEP_MODEL_GATEWAY_HOST}")).toBeNull();
    expect(routeHostProblem("*")).toBe("catch-all route lets any host through");
    expect(routeHostProblem("*.*")).toBe("catch-all route lets any host through");
    expect(routeHostProblem("*.com")).toBe("catch-all route lets every name under .com through");
    expect(routeHostProblem("10.0.0.1")).toBe("the route names an address instead of a host");
    expect(routeHostProblem("example.0x7f")).toBe("the route names an address instead of a host");
    expect(routeHostProblem("[::1]")).toBe("the route names an address instead of a host");
    expect(routeHostProblem("Docs.Example.com")).toBe("the host Docs.Example.com is not a lower case host name");
    expect(routeHostProblem("localhost")).toBe("the host localhost is not a lower case host name");
    expect(routeHostProblem("")).toBe("the route names no host");
  });

  it("egressEntries reads only documents of the kind aep.caw.egress_policy", () => {
    const docs = parseDocuments("address:\n  domain: d\n  id: i\nmetadata:\n  wrap: w\n---\nkind: aep.caw.profile\nprofile_id: p\n", "inline");
    expect(egressEntries(docs, "inline")).toEqual([]);
  });

  it("no code of the report reads the policy format of the Go CAW", () => {
    const code = readFileSync(REPORT_SOURCE, "utf8");
    for (const key of ["network_rules", "unmatched_egress", "http_services", "mcp_rules", "NEUTRALIZED"]) {
      expect(code, key).not.toContain(key);
    }
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
  it("multi-document GAP files declare one wrap per document and a profile document declares none", () => {
    const text = "metadata:\n  wrap: one\n  agent_permission:\n    - agent_id: a\n      action: x\n---\nkind: aep.caw.profile\n---\n";
    const docs = parseDocuments(text, "inline");
    expect(docs).toHaveLength(2);
    const table = addWrapsFromDocuments(new Map(), docs, "inline");
    expect([...table.keys()]).toEqual(["one"]);
    expect(findWrapFor(table, "a", "x")).toBe("one");
    expect(findWrapFor(table, "a", "y")).toBeNull();
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

  it("an inventory with the key caw of the retired Go CAW is rejected", () => {
    expect(() => loadInventory(fixture("invalid/caw-key.yaml"))).toThrow(/retired Go CAW/);
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
    expect(run.stdout).toMatch(/wrap coverage: \d+ entries, \d+ matched, 0 unmatched\n$/);
  });

  it("the CLI exits 1 when an entry is unmatched", () => {
    const run = runCli([fixture("egress.yaml")]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("UNMATCHED egress_route open/any-host catch-all route lets any host through; the CAW refuses the policy");
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
    expect(parsed.summary).toEqual({ entries: 5, matched: 3, unmatched: 2 });
    expect(Object.keys(parsed.entries[0]).sort()).toEqual(["id", "kind", "reason", "source", "status", "wrap"]);
  });
});
