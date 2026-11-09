import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  HYPERLATTICE_TOPOLOGY,
  applyHyperlatticeOverrides,
  assertHyperlatticeBoot,
  buildHyperlatticeConfig,
  buildHyperlatticeView,
  detectActionLatticeCycles,
  loadActionLatticeRegistry,
  loadComposerCcaLatticeRegistry,
  mergeActionLatticeRegistries,
  validateHyperlattice,
  validateHyperlatticeOnBoot,
} from "../lib/hyperlattice.mjs";
import { buildBridgeConfigFromDynaep, listDynaepObserverSpecs } from "../lib/dynaep-bridge-config.mjs";
import { COMPOSER_CCA_LATTICE_REGISTRY } from "../lib/paths.mjs";
import { saveGraph } from "../lib/graph-store.mjs";
import { buildPolicyLatticeView } from "../lib/policy-lattice.mjs";

const REGISTRY = "AEP-Components/dynAEP/registries/aep-lattice.yaml";
const LATTICE_POLICY = "AEP-Components/dynAEP/policies/lattice-policy.rego";

const BASE_YAML = `aep_version: "2.9"
dynaep_version: "1.0"
lattice_revision: 4
actions:
  agent:register:
    label: Register
    category: lifecycle
  agent:ready:
    parents: [agent:register]
    trust_floor: 2
  agent:propose_action:
    parents: [agent:ready]
`;

const OPTIONAL_YAML = `actions:
  agent:ready:
    label: Ready from optional
    parents: [agent:register]
  cca:reply:
    parents: [agent:ready]
`;

let root;

function put(rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

/** The policy view lists the shipped reference policies; the temp repo carries a copy of each name. */
function seedReferencePolicies() {
  for (const p of buildPolicyLatticeView().reference_policies) put(p.path, "{}\n");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aep-"));
  seedReferencePolicies();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("action registries", () => {
  it("parses action nodes with defaults", () => {
    put(REGISTRY, BASE_YAML);
    const reg = loadActionLatticeRegistry(root);
    expect(reg.path).toBe(REGISTRY);
    expect(reg.aep_version).toBe("2.9");
    expect(reg.lattice_revision).toBe(4);
    expect(reg.action_count).toBe(3);
    expect(reg.action_nodes[0]).toEqual({
      node_family: "event",
      action_path: "agent:register",
      label: "Register",
      category: "lifecycle",
      parents: [],
      children: [],
      trust_floor: 1,
    });
    expect(reg.action_nodes[1]).toMatchObject({ label: "agent:ready", category: "unknown", trust_floor: 2 });
  });

  it("throws for a missing registry", () => {
    expect(() => loadActionLatticeRegistry(root, "nope.yaml")).toThrow("hyperlattice: missing action registry nope.yaml");
  });

  it("returns an empty optional registry when the file is absent", () => {
    const reg = loadComposerCcaLatticeRegistry(root);
    expect(reg).toEqual({
      path: COMPOSER_CCA_LATTICE_REGISTRY,
      aep_version: null,
      dynaep_version: null,
      lattice_revision: null,
      action_nodes: [],
      action_count: 0,
    });
  });

  it("merges the optional registry over the base and lets it win on collision", () => {
    put(REGISTRY, BASE_YAML);
    put(COMPOSER_CCA_LATTICE_REGISTRY, OPTIONAL_YAML);
    const merged = mergeActionLatticeRegistries(loadActionLatticeRegistry(root), loadComposerCcaLatticeRegistry(root));
    expect(merged.action_count).toBe(4);
    expect(merged.composer_cca_registry).toBe(COMPOSER_CCA_LATTICE_REGISTRY);
    expect(merged.lattice_revision).toBe(4);
    expect(merged.action_nodes.find((n) => n.action_path === "agent:ready").label).toBe("Ready from optional");
  });
});

describe("detectActionLatticeCycles", () => {
  it("finds no cycle in a partial order", () => {
    expect(
      detectActionLatticeCycles([
        { action_path: "a", parents: [] },
        { action_path: "b", parents: ["a"] },
        { action_path: "c", parents: ["a", "b", "missing"] },
      ]),
    ).toEqual([]);
  });

  it("reports a cycle with its path", () => {
    const cycles = detectActionLatticeCycles([
      { action_path: "a", parents: ["c"] },
      { action_path: "b", parents: ["a"] },
      { action_path: "c", parents: ["b"] },
    ]);
    expect(cycles).toEqual([["a", "c", "b", "a"]]);
  });

  it("reports a self loop", () => {
    expect(detectActionLatticeCycles([{ action_path: "a", parents: ["a"] }])).toEqual([["a", "a"]]);
  });
});

describe("validateHyperlattice", () => {
  it("accepts an empty view", () => {
    expect(validateHyperlattice({})).toEqual({ valid: true, errors: [], cycle_count: 0 });
  });

  it("collects unknown parents, cycles, missing policy files and unbound canvas contracts", () => {
    put("present.gap", "x: 1\n");
    const res = validateHyperlattice({
      repo_root: root,
      event_nodes: [
        { action_path: "a", parents: ["b"] },
        { action_path: "b", parents: ["a", "ghost"] },
      ],
      gap_policy_nodes: [{ path: "present.gap" }, { path: "absent.gap" }],
      channel_bindings: [{ contract_id: "dynaep-action-lattice" }],
      canvas_nodes: [
        { id: "n1", contract_id: "dynaep-action-lattice" },
        { id: "n2", contract_id: "rogue" },
        { id: "n3" },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.cycle_count).toBe(1);
    expect(res.errors).toEqual([
      "unknown parent ghost for action_path b",
      "action_path cycle: a -> b -> a",
      "missing GAP policy node file: absent.gap",
      "canvas node n2 contract_id rogue not in hyperlattice channel_bindings",
    ]);
  });

  it("does not check policy files without a repo root", () => {
    expect(validateHyperlattice({ gap_policy_nodes: [{ path: "absent.gap" }] }).valid).toBe(true);
  });
});

describe("buildHyperlatticeView on a temp repo", () => {
  it("builds one mechanism with event, protocol and binding nodes", () => {
    put(REGISTRY, BASE_YAML);
    const view = buildHyperlatticeView({ repoRoot: root });
    expect(view.topology).toBe(HYPERLATTICE_TOPOLOGY);
    expect(view.mechanism).toBe("one");
    expect(view.kernel_contract).toBe("dynaep-action-lattice");
    expect(view.node_counts.event).toBe(3);
    expect(view.node_counts.canvas).toBe(0);
    expect(view.node_counts.composer_protocol).toBe(view.composer_protocol.node_types.length);
    expect(view.epscom.id).toBe("correctwriting-en");
    expect(view.cca_gap_policies).toEqual([]);
    expect(view.validation).toEqual({ valid: true, errors: [], cycle_count: 0 });
  });

  it("folds composer topology errors into the view validation", () => {
    put(REGISTRY, BASE_YAML);
    const view = buildHyperlatticeView({
      repoRoot: root,
      composerGraph: { nodes: [{ id: "a", type: "agent", data: { contract_id: "dynaep-action-lattice" } }], edges: [] },
    });
    expect(view.canvas_nodes).toEqual([
      {
        node_family: "canvas",
        id: "a",
        type: "agent",
        contract_id: "dynaep-action-lattice",
        lattice_id: null,
        channel_id: null,
      },
    ]);
    expect(view.composer_topology_validation.valid).toBe(false);
    expect(view.validation.valid).toBe(false);
    expect(view.validation.errors).toContain("composer protocol: missing Action Lattice hub (type=lattice)");
  });

  it("reports reference policy files missing from the repo root", () => {
    put(REGISTRY, BASE_YAML);
    const [first] = buildPolicyLatticeView().reference_policies;
    rmSync(join(root, first.path));
    const view = buildHyperlatticeView({ repoRoot: root });
    expect(view.validation.errors).toEqual([`missing GAP policy node file: ${first.path}`]);
  });

  it("reports a cycle in the registry", () => {
    put(REGISTRY, "actions:\n  a:\n    parents: [b]\n  b:\n    parents: [a]\n");
    const view = buildHyperlatticeView({ repoRoot: root });
    expect(view.validation.valid).toBe(false);
    expect(view.validation.cycle_count).toBe(1);
  });
});

describe("validateHyperlatticeOnBoot", () => {
  it("is valid with the registry and lattice policy present", () => {
    put(REGISTRY, BASE_YAML);
    put(LATTICE_POLICY, "package dynaep.lattice\n");
    const res = assertHyperlatticeBoot({ base_node: { lrps: ["gdpr"] } }, root);
    expect(res.valid).toBe(true);
    expect(res.topology).toBe(HYPERLATTICE_TOPOLOGY);
    expect(res.lattice_policy_path).toBe(LATTICE_POLICY);
    expect(res.node_counts.channel_bindings).toBeGreaterThan(1);
  });

  it("denies a missing lattice policy, a missing configured registry and a missing hyperlattice section", () => {
    put(REGISTRY, BASE_YAML);
    const res = validateHyperlatticeOnBoot(
      { policy_sections: { dynaep: { lattice_registry: "missing.yaml" } } },
      root,
    );
    expect(res.valid).toBe(false);
    expect(res.errors).toEqual([
      "hyperlattice: missing lattice_registry missing.yaml",
      `hyperlattice: missing lattice-policy.rego at ${LATTICE_POLICY}`,
      "hyperlattice: policy_sections.hyperlattice missing on Base Node config",
    ]);
    expect(() => assertHyperlatticeBoot({}, root)).toThrow(/Hyperlattice boot validation failed: hyperlattice: missing lattice-policy\.rego/);
  });

  it("uses a custom lattice policy path from the config", () => {
    put(REGISTRY, BASE_YAML);
    put("custom.rego", "package x\n");
    const res = validateHyperlatticeOnBoot(
      { hyperlattice: { dynaep: { bridge: { rego: { separate_policy_paths: { lattice: "custom.rego" } } } } } },
      root,
    );
    expect(res.valid).toBe(true);
    expect(res.lattice_policy_path).toBe("custom.rego");
  });

  it("checks stored canvas contract bindings when a data dir is given", () => {
    put(REGISTRY, BASE_YAML);
    put(LATTICE_POLICY, "package dynaep.lattice\n");
    const dataDir = join(root, "data");
    saveGraph(dataDir, {
      nodes: [
        { id: "hub", type: "lattice", x: 0, y: 0, data: { contract_id: "dynaep-action-lattice" } },
        { id: "a", type: "agent", x: 0, y: 0, data: { contract_id: "rogue" } },
      ],
      edges: [],
    });
    const res = validateHyperlatticeOnBoot({}, root, { dataDir });
    expect(res.valid).toBe(false);
    expect(res.errors).toEqual(["canvas node a contract_id rogue not in hyperlattice channel_bindings"]);
    expect(res.node_counts.canvas).toBe(2);
  });

  it("boot recomputes structural validation only, so composer topology warnings do not block boot", () => {
    put(REGISTRY, BASE_YAML);
    put(LATTICE_POLICY, "package dynaep.lattice\n");
    const dataDir = join(root, "data");
    saveGraph(dataDir, { nodes: [{ id: "a", type: "agent", x: 0, y: 0 }], edges: [] });
    const res = validateHyperlatticeOnBoot({}, root, { dataDir });
    expect(res.valid).toBe(true);
    expect(res.node_counts.canvas).toBe(1);
  });
});

describe("buildHyperlatticeConfig and applyHyperlatticeOverrides", () => {
  const policySystem = {
    hierarchy: [{ label: "SYSTEM" }, { label: "SANDBOX" }],
    mandatory_gap: "AEP-Policy-System/lattice-channel-mandatory.gap",
    reference_policies: [{ path: "AEP-Policy-System/reference/writing.gap" }],
    yaml_presets: [{ path: "AEP-Policy-System/presets/a.yaml" }],
  };
  const dynaep = {
    root: "AEP-Components/dynAEP",
    kernel_contract: "dynaep-action-lattice",
    lattice_registry: REGISTRY,
    lattice_config: { governance: "filter_all", hook: "mle", agent_interest_enabled: true },
    produce_command: "",
    observers: [{ id: "webhook", entry: "AEP-Components/dynAEP/observers/webhook/index.ts" }],
  };

  it("derives the policy lattice and dynaep sections from context", () => {
    const cfg = buildHyperlatticeConfig({ user_intent: "listen on a webhook" }, { policy_system: policySystem, dynaep });
    expect(cfg).toMatchObject({
      topology: HYPERLATTICE_TOPOLOGY,
      mechanism: "one",
      enabled: true,
      kernel_contract: "dynaep-action-lattice",
      lattice_registry: REGISTRY,
      composer_cca_registry: COMPOSER_CCA_LATTICE_REGISTRY,
      governance_mode: "filter_all",
      validation_hook: "mle",
      gap: null,
      regulation_lrps: null,
    });
    expect(cfg.policy_lattice).toEqual({
      enabled: true,
      hierarchy: ["SYSTEM", "SANDBOX"],
      mandatory_gap: "AEP-Policy-System/lattice-channel-mandatory.gap",
      reference_policy_paths: ["AEP-Policy-System/reference/writing.gap"],
      yaml_presets: ["AEP-Policy-System/presets/a.yaml"],
    });
    expect(cfg.dynaep.observers.webhook).toMatchObject({ enabled: true, adapter: "webhook" });
  });

  it("keeps explicit overrides from the plan", () => {
    const plan = {
      policy_overrides: {
        policy_lattice: { enabled: false },
        dynaep: { lattice_registry: "custom.yaml", governance_mode: "observe", validation_hook: "none" },
        gap: { enabled: true },
        regulation_lrps: ["gdpr"],
      },
    };
    const cfg = buildHyperlatticeConfig(plan, { policy_system: policySystem, dynaep });
    expect(cfg.policy_lattice).toEqual({ enabled: false });
    expect(cfg.lattice_registry).toBe("custom.yaml");
    expect(cfg.governance_mode).toBe("observe");
    expect(cfg.validation_hook).toBe("none");
    expect(cfg.gap).toEqual({ enabled: true });
    expect(cfg.regulation_lrps).toEqual(["gdpr"]);
  });

  it("writes the config onto the plan", () => {
    const plan = {};
    applyHyperlatticeOverrides(plan, { policy_system: policySystem, dynaep });
    expect(plan.policy_overrides.hyperlattice.topology).toBe(HYPERLATTICE_TOPOLOGY);
    expect(plan.policy_overrides.hyperlattice.dynaep.observers).toBeUndefined();
  });
});

describe("dynaep bridge config", () => {
  it("returns null when disabled or without a registry", () => {
    expect(buildBridgeConfigFromDynaep(undefined, root)).toBeNull();
    expect(buildBridgeConfigFromDynaep({ enabled: false, lattice_registry: REGISTRY }, root)).toBeNull();
    expect(buildBridgeConfigFromDynaep({ enabled: true }, root)).toBeNull();
  });

  it("throws when the registry file is missing", () => {
    expect(() => buildBridgeConfigFromDynaep({ enabled: true, lattice_registry: REGISTRY }, root)).toThrow(
      /dynAEP lattice registry not found/,
    );
  });

  it("builds defaults and resolves paths against the repo root", () => {
    put(REGISTRY, BASE_YAML);
    const cfg = buildBridgeConfigFromDynaep({ enabled: true, lattice_registry: REGISTRY }, root);
    expect(cfg.lattice).toEqual({
      registry: join(root, REGISTRY),
      composer_cca_registry: undefined,
      governance: "filter_all",
      agent_interest_enabled: true,
      hook: "mle",
    });
    expect(cfg.validation).toEqual({ mode: "strict", jit_on_every_delta: true });
    expect(cfg.rego.separatePolicyPaths.lattice).toBe(join(root, LATTICE_POLICY));
    expect(cfg.hyperlattice).toEqual({
      lattice_policy_path: join(root, LATTICE_POLICY),
      gap_writing_lint: true,
      mode: "strict",
    });
  });

  it("honours bridge settings and an existing optional registry", () => {
    put(REGISTRY, BASE_YAML);
    put(COMPOSER_CCA_LATTICE_REGISTRY, OPTIONAL_YAML);
    const cfg = buildBridgeConfigFromDynaep(
      {
        enabled: true,
        bridge: {
          lattice: { registry: join(root, REGISTRY), governance: "observe", hook: "none", agent_interest_enabled: false },
          validation: { mode: "lenient" },
          rego: { evaluation: "live", decision_cache_size: 10 },
        },
      },
      root,
    );
    expect(cfg.lattice.registry).toBe(join(root, REGISTRY));
    expect(cfg.lattice.composer_cca_registry).toBe(join(root, COMPOSER_CCA_LATTICE_REGISTRY));
    expect(cfg.lattice.governance).toBe("observe");
    expect(cfg.lattice.hook).toBe("none");
    expect(cfg.lattice.agent_interest_enabled).toBe(false);
    expect(cfg.rego.evaluation).toBe("live");
    expect(cfg.rego.decisionCacheSize).toBe(10);
    expect(cfg.hyperlattice.mode).toBe("lenient");
  });

  it("lists only enabled observer specs", () => {
    expect(listDynaepObserverSpecs({})).toEqual([]);
    expect(
      listDynaepObserverSpecs({ observers: { webhook: { enabled: true, port: 9000 }, sse: { enabled: false } } }),
    ).toEqual([{ id: "webhook", enabled: true, port: 9000 }]);
  });
});
