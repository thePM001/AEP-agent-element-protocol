import { describe, expect, it } from "vitest";
import {
  CANVAS_SKIP_COMPONENT_IDS,
  CAW_INTENT_PATTERN,
  DYNAEP_INTENT_PATTERN,
  FULL_STACK_PATTERN,
  GAP_INTENT_PATTERN,
  KERNEL_LATTICE_CONTRACTS,
  PLATFORM_FEATURE_LRP_IDS,
  allSelectableComponentIds,
  buildIntentRulesFromComponents,
  buildPlanComponents,
  buildTopologyFromCatalog,
  componentIdsFromGraph,
  filterRegulationLrps,
  matchIntentFromCatalog,
  resolveComposerNodeType,
} from "../lib/component-catalog.mjs";

const REMOVED_COMPONENTS = [
  "coding-governance",
  "semantic-topology",
  "proxy",
  "fleet",
  "eval",
  "optimization",
  "workflow",
];

const COMPONENTS = [
  {
    id: "connector-postgres",
    name: "Postgres Connector",
    kind: "connector",
    cca: { summary: "Postgres evidence export", use_when: ["postgres database"] },
  },
  {
    id: "connector-slack",
    name: "Slack Connector",
    kind: "connector",
    cca: { summary: "Slack bridge", use_when: ["slack channel"] },
    implementation: { auth_token_env: "SLACK_BOT_TOKEN" },
  },
  {
    id: "ucb",
    name: "Universal Connect Bridge",
    kind: "bridge",
    cca: { summary: "UCB", use_when: ["langgraph agents"] },
  },
  {
    id: "gdpr-pack",
    name: "GDPR Pack",
    kind: "compliance",
    lrp_id: "gdpr",
    cca: { summary: "GDPR", use_when: ["european privacy"], pairs_with: ["evidence-ledger"] },
  },
  {
    id: "mcp-security",
    name: "MCP Security",
    kind: "library",
    capabilities: ["security:prompt-firewall"],
    cca: { summary: "MCP security scan" },
  },
  { id: "session", name: "Session", kind: "library", default_enabled: true },
  { id: "starter-template", name: "Starter", kind: "template", cca: { summary: "tpl" } },
  { id: "cca", name: "CCA", kind: "agent", installed: true },
  { id: "evidence-ledger", name: "Evidence Ledger", kind: "library" },
];

const CATALOG = { lrps: [{ id: "gdpr" }, { id: "hipaa" }] };

function ctx(extra = {}) {
  return { components: COMPONENTS, policy_system: { catalog: CATALOG }, ...extra };
}

describe("catalog constants", () => {
  it("keeps kernel contracts out of the regulation lrp list", () => {
    expect(KERNEL_LATTICE_CONTRACTS).toEqual([
      "epscom-core",
      "dynaep-action-lattice",
      "lattice-channel-default",
    ]);
    for (const id of KERNEL_LATTICE_CONTRACTS) expect(PLATFORM_FEATURE_LRP_IDS.has(id)).toBe(true);
    expect(PLATFORM_FEATURE_LRP_IDS.has("gap-runtime-scanners")).toBe(true);
  });

  it("names no removed component anywhere in the skip set or lrp set", () => {
    for (const id of REMOVED_COMPONENTS) {
      expect(CANVAS_SKIP_COMPONENT_IDS.has(id)).toBe(false);
      expect(PLATFORM_FEATURE_LRP_IDS.has(id)).toBe(false);
    }
  });

  it("intent patterns recognise their phrases", () => {
    expect(FULL_STACK_PATTERN.test("please deploy all of it")).toBe(true);
    expect(FULL_STACK_PATTERN.test("one small connector")).toBe(false);
    expect(CAW_INTENT_PATTERN.test("a containerized agentic sandbox")).toBe(true);
    expect(GAP_INTENT_PATTERN.test("write a .gap policy")).toBe(true);
    expect(GAP_INTENT_PATTERN.test("gapless design")).toBe(false);
    expect(DYNAEP_INTENT_PATTERN.test("a webhook observer")).toBe(true);
  });
});

describe("filterRegulationLrps", () => {
  it("keeps only catalog regulation ids and removes duplicates", () => {
    expect(filterRegulationLrps(["gdpr", "gdpr", "epscom-core", "hipaa"], CATALOG)).toEqual([
      "gdpr",
      "hipaa",
    ]);
  });

  it("returns nothing for a missing catalog or missing ids", () => {
    expect(filterRegulationLrps(["gdpr"], undefined)).toEqual([]);
    expect(filterRegulationLrps(undefined, CATALOG)).toEqual([]);
  });
});

describe("buildIntentRulesFromComponents", () => {
  const rules = buildIntentRulesFromComponents(COMPONENTS);

  it("builds one rule per component with a cca summary", () => {
    expect(rules.map((r) => r.componentId)).toEqual([
      "connector-postgres",
      "connector-slack",
      "ucb",
      "gdpr-pack",
      "mcp-security",
      "starter-template",
    ]);
  });

  it("carries lrps and pairs_with", () => {
    const gdpr = rules.find((r) => r.componentId === "gdpr-pack");
    expect(gdpr.lrps).toEqual(["gdpr"]);
    expect(gdpr.pairs_with).toEqual(["evidence-ledger"]);
    expect(rules.find((r) => r.componentId === "ucb").lrps).toEqual([]);
  });

  it("matches on use_when phrases with flexible spacing and hyphens", () => {
    const pg = rules.find((r) => r.componentId === "connector-postgres");
    expect(pg.pattern.test("I need a Postgres-Database for evidence")).toBe(true);
    expect(pg.pattern.test("I need redis")).toBe(false);
  });

  it("matches on capability segments and the id itself", () => {
    const mcp = rules.find((r) => r.componentId === "mcp-security");
    expect(mcp.pattern.test("add a prompt firewall")).toBe(true);
    expect(mcp.pattern.test("enable mcp-security")).toBe(true);
  });

  it("escapes regex metacharacters in ids and phrases", () => {
    const [rule] = buildIntentRulesFromComponents([
      { id: "a.b", cca: { summary: "x", use_when: ["c++ (fast)"] } },
    ]);
    expect(rule.pattern.test("use c++ (fast) now")).toBe(true);
    expect(rule.pattern.test("axb")).toBe(false);
  });
});

describe("resolveComposerNodeType", () => {
  it("prefers explicit composer node types", () => {
    expect(resolveComposerNodeType({ id: "x", composer_node: { type: "data_input" } })).toBe("data_input");
    expect(resolveComposerNodeType({ id: "x", composer: { node_type: "data_output" } })).toBe("data_output");
  });

  it("maps well known ids and kinds", () => {
    expect(resolveComposerNodeType({ id: "ucb" })).toBe("ucb");
    expect(resolveComposerNodeType({ id: "caw-framework", kind: "agent" })).toBe("component");
    expect(resolveComposerNodeType({ id: "connector-x" })).toBe("connector");
    expect(resolveComposerNodeType({ id: "wasm-policy-node" })).toBe("wasm_policy");
    expect(resolveComposerNodeType({ id: "y", kind: "compliance" })).toBe("regulation");
    expect(resolveComposerNodeType({ id: "y", kind: "agent" })).toBe("agent");
    expect(resolveComposerNodeType({ id: "y", kind: "unknown-kind" })).toBe("component");
  });
});

describe("matchIntentFromCatalog", () => {
  it("always includes default enabled and installed components", () => {
    const res = matchIntentFromCatalog("nothing in particular", ctx());
    expect(res.componentIds.sort()).toEqual(["cca", "session"]);
    expect(res.lrps).toEqual([]);
    expect(res.inferenceOverride).toBeNull();
    expect(res.warnings).toEqual([]);
  });

  it("matches a regulation component, its lrp and its pairs", () => {
    const res = matchIntentFromCatalog("European privacy for our users", ctx());
    expect(res.componentIds).toContain("gdpr-pack");
    expect(res.componentIds).toContain("evidence-ledger");
    expect(res.lrps).toEqual(["gdpr"]);
  });

  it("drops lrps that are not regulation lrps of the catalog", () => {
    const res = matchIntentFromCatalog("European privacy", {
      components: COMPONENTS,
      policy_system: { catalog: { lrps: [] } },
    });
    expect(res.componentIds).toContain("gdpr-pack");
    expect(res.lrps).toEqual([]);
  });

  it("auto enables ucb for connectors with a warning", () => {
    const res = matchIntentFromCatalog("post to a slack channel", ctx());
    expect(res.componentIds).toContain("connector-slack");
    expect(res.componentIds).toContain("ucb");
    expect(res.warnings).toContain("Connectors require UCB: auto-enabled ucb");
  });

  it("does not warn when ucb was already matched", () => {
    const res = matchIntentFromCatalog("slack channel and langgraph agents", ctx());
    expect(res.componentIds).toContain("ucb");
    expect(res.warnings).toEqual([]);
  });

  it("full stack intent selects every non template component and lrp", () => {
    const res = matchIntentFromCatalog("deploy all please", ctx());
    expect(res.componentIds).not.toContain("starter-template");
    for (const c of COMPONENTS.filter((x) => x.kind !== "template")) {
      expect(res.componentIds).toContain(c.id);
    }
    expect(res.lrps).toEqual(["gdpr"]);
  });

  it("local llm intent selects llama.cpp inference", () => {
    const res = matchIntentFromCatalog("run a local llm", ctx());
    expect(res.inferenceOverride.provider).toBe("llama_cpp");
    expect(res.inferenceOverride.model).toBe("llama-3.1-8b");
    expect(res.inferenceOverride.base_url.endsWith(":8080/v1")).toBe(true);
  });

  it("switches local llm to cloud inference on low memory", () => {
    const res = matchIntentFromCatalog("run ollama", ctx({ environment: { constraints: ["memory_below_8gb"] } }));
    expect(res.inferenceOverride).toEqual({
      provider: "openrouter",
      model: "meta-llama/llama-3.1-8b-instruct",
      base_url: "https://openrouter.ai/api/v1",
    });
    expect(res.warnings[0]).toMatch(/Low RAM/);
  });

  it("cloud llm intent selects openrouter and economics", () => {
    const res = matchIntentFromCatalog("use claude via openrouter", ctx());
    expect(res.inferenceOverride.provider).toBe("openrouter");
    expect(res.componentIds).toContain("economics");
  });

  it("conformance intent adds the conformance runner", () => {
    expect(matchIntentFromCatalog("run conformance", ctx()).componentIds).toContain("conformance-runner");
  });

  it("caw intent adds the caw family", () => {
    const ids = matchIntentFromCatalog("an aep-caw coding agent", ctx()).componentIds;
    for (const id of ["caw-framework", "session", "mcp-security", "gap"]) expect(ids).toContain(id);
  });

  it("dynaep intent adds core, typescript and optional python and scanners", () => {
    const ids = matchIntentFromCatalog("action lattice with python and a content scanner", ctx()).componentIds;
    for (const id of ["dynaep-core", "aep-dynaep-typescript", "aep-dynaep-python", "gap-runtime-scanners"]) {
      expect(ids).toContain(id);
    }
    const plain = matchIntentFromCatalog("action lattice", ctx()).componentIds;
    expect(plain).not.toContain("aep-dynaep-python");
    expect(plain).not.toContain("gap-runtime-scanners");
  });

  it("gap intent adds gap, dynaep core, policy engine, the intent ledger and wasm sandbox", () => {
    const ids = matchIntentFromCatalog("gap policy with blast radius in a wasm sandbox", ctx()).componentIds;
    for (const id of ["gap", "dynaep-core", "policy-engine", "intent-ledger", "wasm-policy-sandbox", "wasm-policy-node"]) {
      expect(ids).toContain(id);
    }
  });

  it("never selects a removed component", () => {
    const res = matchIntentFromCatalog(
      "coding governance with semantic topology, a proxy, a fleet, eval, optimization and a workflow",
      ctx(),
    );
    for (const id of REMOVED_COMPONENTS) expect(res.componentIds).not.toContain(id);
  });
});

describe("buildPlanComponents", () => {
  it("returns only enabled components with a reason", () => {
    const out = buildPlanComponents(COMPONENTS, ["gdpr-pack"], "privacy", {});
    expect(out.map((c) => c.id)).toEqual(["gdpr-pack", "session"]);
    expect(out[0].reason).toBe("Matched user intent: privacy");
    expect(out[0].config).toBeUndefined();
  });

  it("builds the postgres connector config from env with defaults", () => {
    const [pg] = buildPlanComponents(COMPONENTS, ["connector-postgres"], "postgres evidence", {
      AEP_POSTGRES_HOST: "db.internal",
      AEP_POSTGRES_PORT: "6543",
    });
    expect(pg.config).toEqual({
      host: "db.internal",
      port: 6543,
      database: "aep_evidence",
      user: "aep",
      ssl_mode: "require",
    });
  });

  it("builds generic connector config with upstream and egress prefix", () => {
    const out = buildPlanComponents(COMPONENTS, ["connector-slack"], "slack", {
      AEP_SLACK_UPSTREAM: "https://slack.example",
    });
    const slack = out.find((c) => c.id === "connector-slack");
    expect(slack.config).toEqual({
      upstream: "https://slack.example",
      auth_token_env: "SLACK_BOT_TOKEN",
      ucb_egress_prefix: "/ucb/v1/egress/slack",
    });
  });

  it("uses the generic connector path for postgres when the intent does not name postgres", () => {
    const [pg] = buildPlanComponents(COMPONENTS, ["connector-postgres"], "evidence", {});
    expect(pg.config).toEqual({
      auth_token_env: "AEP_POSTGRES_TOKEN",
      ucb_egress_prefix: "/ucb/v1/egress/postgres",
    });
  });

  it("truncates the reason to 80 characters of intent", () => {
    const [first] = buildPlanComponents(COMPONENTS, [], "x".repeat(200), {});
    expect(first.reason).toBe(`Matched user intent: ${"x".repeat(80)}`);
  });
});

describe("buildTopologyFromCatalog", () => {
  it("builds the hub, two docks and one agent by default", () => {
    const topo = buildTopologyFromCatalog([], "simple", COMPONENTS);
    expect(topo.nodes.map((n) => n.id)).toEqual([
      "lattice-hub",
      "dock-validation",
      "dock-inference",
      "agent-1",
    ]);
    expect(topo.edges.every((e) => e.to === "lattice-hub")).toBe(true);
  });

  it("adds a regulation dock when a regulation component is enabled", () => {
    const topo = buildTopologyFromCatalog(["gdpr-pack"], "privacy", COMPONENTS);
    expect(topo.nodes.some((n) => n.id === "dock-regulation")).toBe(true);
    expect(topo.edges.some((e) => e.id === "e-reg-hub")).toBe(true);
    const comp = topo.nodes.find((n) => n.id === "comp-gdpr-pack");
    expect(comp.type).toBe("regulation");
  });

  it("caps the agent count at eight", () => {
    const topo = buildTopologyFromCatalog([], "spin up 20 coding agents", COMPONENTS);
    expect(topo.nodes.filter((n) => n.type === "agent")).toHaveLength(8);
    const three = buildTopologyFromCatalog([], "3 agents", COMPONENTS);
    expect(three.nodes.filter((n) => n.type === "agent").map((n) => n.id)).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
    ]);
  });

  it("skips canvas skip ids, unknown ids and agent kind components", () => {
    const topo = buildTopologyFromCatalog(["session", "cca", "nope", "evidence-ledger"], "x", COMPONENTS);
    const compNodes = topo.nodes.filter((n) => n.id.startsWith("comp-"));
    expect(compNodes).toEqual([]);
  });

  it("wires connectors from the hub on the evidence channel and ucb with its port", () => {
    const topo = buildTopologyFromCatalog(["connector-slack", "ucb", "mcp-security"], "x", COMPONENTS);
    const slackEdge = topo.edges.find((e) => e.id === "e-comp-connector-slack-hub");
    expect(slackEdge).toEqual({
      id: "e-comp-connector-slack-hub",
      from: "lattice-hub",
      to: "comp-connector-slack",
      channel: "evidence_export",
    });
    const slack = topo.nodes.find((n) => n.id === "comp-connector-slack");
    expect(slack.data).toMatchObject({ service: "slack", ucb_only: true, component_id: "connector-slack" });
    const ucb = topo.nodes.find((n) => n.id === "comp-ucb");
    expect(ucb.type).toBe("ucb");
    expect(ucb.data.port).toBe(8412);
    const mcpEdge = topo.edges.find((e) => e.id === "e-comp-mcp-security-hub");
    expect(mcpEdge.from).toBe("comp-mcp-security");
    expect(mcpEdge.channel).toBe("lattice-channel-default");
  });

  it("lays out components in rows of four", () => {
    const comps = Array.from({ length: 5 }, (_, i) => ({ id: `lib-${i}`, kind: "library", name: `L${i}` }));
    const topo = buildTopologyFromCatalog(comps.map((c) => c.id), "x", comps);
    const placed = topo.nodes.filter((n) => n.id.startsWith("comp-"));
    expect(placed.map((n) => [n.x, n.y])).toEqual([
      [200, 520],
      [360, 520],
      [520, 520],
      [680, 520],
      [200, 620],
    ]);
  });
});

describe("componentIdsFromGraph", () => {
  it("collects ids from node data and special node types", () => {
    const ids = componentIdsFromGraph(
      {
        nodes: [
          { id: "a", type: "component", data: { component_id: "mcp-security" } },
          { id: "b", type: "regulation", data: { registry_id: "gdpr-pack" } },
          { id: "c", type: "ucb" },
          { id: "d", type: "wasm_policy" },
          { id: "e", type: "connector" },
        ],
      },
      COMPONENTS,
    );
    expect([...ids].sort()).toEqual(
      ["connector-slack", "gdpr-pack", "mcp-security", "ucb", "wasm-policy-node", "wasm-policy-sandbox"].sort(),
    );
  });

  it("returns an empty set for a graph without nodes", () => {
    expect(componentIdsFromGraph({}, COMPONENTS).size).toBe(0);
  });
});

describe("allSelectableComponentIds", () => {
  it("excludes templates", () => {
    const ids = allSelectableComponentIds(COMPONENTS);
    expect(ids).not.toContain("starter-template");
    expect(ids).toHaveLength(COMPONENTS.length - 1);
  });
});
