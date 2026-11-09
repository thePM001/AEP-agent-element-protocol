import { describe, expect, it } from "vitest";
import {
  ALLOWED_EDGE_KINDS,
  ALLOWED_NODE_TYPES,
  COMPOSER_PROTOCOL_ID,
  COMPOSER_PROTOCOL_VERSION,
  INTERACTION_MATRIX,
  REQUIRED_EDGE_CHANNEL,
  buildComposerProtocolSpec,
  formatComposerProtocolForPrompt,
  validateComposerTopology,
} from "../lib/composer-protocol.mjs";
import { starterGraph } from "../lib/graph-store.mjs";

function n(id, type, data) {
  return data ? { id, type, data } : { id, type };
}

const HUB = n("hub", "lattice");

describe("buildComposerProtocolSpec", () => {
  const spec = buildComposerProtocolSpec();

  it("names the protocol and version", () => {
    expect(spec.id).toBe(COMPOSER_PROTOCOL_ID);
    expect(spec.version).toBe(COMPOSER_PROTOCOL_VERSION);
    expect(spec.node_family).toBe("composer_protocol");
  });

  it("lists every allowed node type with defaults filled", () => {
    expect(spec.node_types.map((t) => t.type).sort()).toEqual([...ALLOWED_NODE_TYPES].sort());
    const agent = spec.node_types.find((t) => t.type === "agent");
    expect(agent).toMatchObject({ aep_id: null, catalog_id: null, shape: "rect" });
    const ucb = spec.node_types.find((t) => t.type === "ucb");
    expect(ucb).toMatchObject({ catalog_id: "ucb", shape: "diamond" });
  });

  it("binds every edge kind to the required lattice channel", () => {
    expect(spec.edge_kinds).toEqual(ALLOWED_EDGE_KINDS.map((kind) => ({ kind, transport: REQUIRED_EDGE_CHANNEL })));
    expect(spec.edge_flows).toEqual(["to", "from"]);
    expect(spec.interactions).toBe(INTERACTION_MATRIX);
    expect(spec.forbidden_canvas_registry_ids).toContain("dynaep-core");
  });
});

describe("validateComposerTopology", () => {
  it("accepts the starter graph", () => {
    const res = validateComposerTopology(starterGraph());
    expect(res).toEqual({
      valid: true,
      errors: [],
      warnings: [],
      protocol_id: COMPOSER_PROTOCOL_ID,
      version: COMPOSER_PROTOCOL_VERSION,
    });
  });

  it("rejects an empty topology and a missing input", () => {
    for (const input of [{ nodes: [] }, undefined]) {
      const res = validateComposerTopology(input);
      expect(res.valid).toBe(false);
      expect(res.errors).toEqual(["composer protocol: topology has no nodes"]);
    }
  });

  it("requires a lattice hub and warns about more than one", () => {
    expect(validateComposerTopology({ nodes: [n("a", "agent")] }).errors).toContain(
      "composer protocol: missing Action Lattice hub (type=lattice)",
    );
    const two = validateComposerTopology({ nodes: [HUB, n("hub2", "lattice")] });
    expect(two.valid).toBe(true);
    expect(two.warnings).toContain("composer protocol: multiple lattice hubs; prefer exactly one funnel hub");
  });

  it("denies forbidden and unknown node types and nodes without id", () => {
    const res = validateComposerTopology({
      nodes: [HUB, n("d", "dynaep"), n("w", "wasm_policy"), n("x", "spaceship"), { type: "agent" }],
    });
    expect(res.valid).toBe(false);
    expect(res.errors).toEqual([
      "composer protocol: forbidden node type dynaep on node d",
      "composer protocol: unknown node type dynaep on node d",
      "composer protocol: forbidden node type wasm_policy on node w",
      "composer protocol: unknown node type wasm_policy on node w",
      "composer protocol: unknown node type spaceship on node x",
      "composer protocol: node missing id",
    ]);
  });

  it("denies runtime registry components drawn as canvas rectangles", () => {
    const res = validateComposerTopology({ nodes: [HUB, n("c", "component", { component_id: "dynaep-core" })] });
    expect(res.errors).toEqual([
      "composer protocol: registry id dynaep-core must not be a canvas rectangle (use lattice hub)",
    ]);
  });

  it("denies edges to unknown nodes, raw http and lattice bypass", () => {
    const nodes = [HUB, n("a", "agent")];
    const res = validateComposerTopology({
      nodes,
      edges: [
        { id: "ghost", from: "a", to: "nope" },
        { from: "nope", to: "a" },
        { id: "raw", from: "a", to: "hub", transport: "raw_http" },
        { id: "byp", from: "hub", to: "a", bypass_lattice: true },
      ],
    });
    expect(res.errors).toEqual([
      "composer protocol: edge ghost references unknown node",
      "composer protocol: edge nope->a references unknown node",
      "composer protocol: edge a->hub must use lattice channels",
      "composer protocol: edge hub->a must use lattice channels",
    ]);
  });

  it("checks edge kinds against the interaction matrix in both directions", () => {
    const nodes = [HUB, n("a", "agent"), n("v", "dock_validation"), n("c", "connector")];
    const ok = validateComposerTopology({
      nodes,
      edges: [
        { id: "1", from: "v", to: "hub", kind: "validation" },
        { id: "2", from: "hub", to: "v", kind: "policy" },
        { id: "3", from: "hub", to: "c" },
        { id: "4", from: "a", to: "a", kind: "communicate" },
      ],
    });
    expect(ok.errors).toEqual([]);
    const bad = validateComposerTopology({
      nodes,
      edges: [
        { id: "5", from: "a", to: "hub", kind: "inference" },
        { id: "6", from: "a", to: "hub", kind: "teleport" },
        { id: "7", from: "c", to: "a", kind: "integrate" },
      ],
    });
    expect(bad.errors).toEqual([
      "composer protocol: edge a(agent)->hub(lattice) kind=inference not permitted",
      "composer protocol: edge a(agent)->hub(lattice) kind=teleport not permitted",
    ]);
  });

  it("denies flows other than to and from", () => {
    const res = validateComposerTopology({
      nodes: [HUB, n("a", "agent")],
      edges: [
        { id: "1", from: "a", to: "hub", flow: "FROM" },
        { id: "2", from: "a", to: "hub", flow: "sideways" },
      ],
    });
    expect(res.errors).toEqual(["composer protocol: edge a->hub flow=sideways not permitted"]);
  });

  it("warns about docks not wired to the hub", () => {
    const res = validateComposerTopology({
      nodes: [HUB, n("v", "dock_validation"), n("r", "dock_regulation")],
      edges: [{ id: "1", from: "hub", to: "r", kind: "policy" }],
    });
    expect(res.valid).toBe(true);
    expect(res.warnings).toEqual(["composer protocol: dock v is not wired to the lattice hub"]);
  });
});

describe("formatComposerProtocolForPrompt", () => {
  it("lists types, kinds, the first interactions and the rules", () => {
    const text = formatComposerProtocolForPrompt();
    const lines = text.split("\n");
    expect(lines[0]).toBe("AEP hyperlattice protocol (hyperlattice composer_protocol node family):");
    expect(lines).toContain(`Allowed edge kinds: ${ALLOWED_EDGE_KINDS.join(", ")}`);
    expect(lines).toContain("Edge flows: to, from");
    expect(lines).toContain("  dock_validation -> lattice: validation|action|policy (default validation)");
    expect(lines.filter((l) => l.startsWith("  ") && l.includes(" -> "))).toHaveLength(14);
    expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(buildComposerProtocolSpec().rules.length);
  });

  it("formats a custom spec", () => {
    const text = formatComposerProtocolForPrompt({
      node_types: [{ type: "agent" }],
      edge_kinds: [{ kind: "action" }],
      edge_flows: ["to"],
      interactions: [{ from: "agent", to: "lattice", kinds: ["action"], default_kind: "action" }],
      rules: ["one rule"],
    });
    expect(text).toBe(
      [
        "AEP hyperlattice protocol (hyperlattice composer_protocol node family):",
        "Allowed node types: agent",
        "Allowed edge kinds: action",
        "Edge flows: to",
        "Interaction matrix (subset):",
        "  agent -> lattice: action (default action)",
        "Rules:",
        "- one rule",
      ].join("\n"),
    );
  });
});
