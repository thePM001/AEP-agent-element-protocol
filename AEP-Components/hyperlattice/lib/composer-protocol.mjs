#!/usr/bin/env node

/**
 * Canonical AEP Composer Lite protocol: allowed node types and lattice interactions.
 * Encoded into the CCA hyperlattice so the setup agent cannot ship ungoverned topology.
 */

import { NODE_PALETTE } from "../../../AEP-Composer-Lite/lib/graph-store.mjs";
import { CANVAS_SKIP_COMPONENT_IDS } from "../../../AEP-Components/cca/lib/component-catalog.mjs";

export const COMPOSER_PROTOCOL_VERSION = "2.8.0";
export const COMPOSER_PROTOCOL_ID = "aep.composer-lite.protocol.v1";

/** Edge kinds permitted on Composer Lite canvas (AEP lattice channel semantics). */
export const ALLOWED_EDGE_KINDS = [
  "action",
  "policy",
  "communicate",
  "integrate",
  "validation",
  "inference",
];

export const ALLOWED_EDGE_FLOWS = ["to", "from"];

/**
 * Lite canvas node types (wasm_policy excluded from Lite catalog by design).
 * @type {Set<string>}
 */
export const ALLOWED_NODE_TYPES = new Set(
  NODE_PALETTE.map((p) => p.type).filter((t) => t !== "wasm_policy"),
);

/** Registry/runtime components that must never appear as duplicate canvas rectangles. */
export const FORBIDDEN_CANVAS_REGISTRY_IDS = CANVAS_SKIP_COMPONENT_IDS;

/** Mandatory lattice transport for all governed edges. */
export const REQUIRED_EDGE_CHANNEL = "lattice-channel-default";

/**
 * Allowed (fromType -> toType) interactions and default edge kind.
 * Mirrors canvas inferEdgeKind() and AEP 2.8 wiring conventions.
 */
export const INTERACTION_MATRIX = [
  { from: "dock_validation", to: "lattice", kinds: ["validation", "action", "policy"], default_kind: "validation" },
  { from: "dock_inference", to: "lattice", kinds: ["inference", "action", "policy"], default_kind: "inference" },
  { from: "dock_regulation", to: "lattice", kinds: ["policy", "action"], default_kind: "policy" },
  { from: "lattice", to: "agent", kinds: ["action", "communicate"], default_kind: "communicate" },
  { from: "agent", to: "lattice", kinds: ["action", "communicate"], default_kind: "communicate" },
  { from: "lattice", to: "connector", kinds: ["action", "integrate"], default_kind: "integrate" },
  { from: "connector", to: "lattice", kinds: ["action", "integrate"], default_kind: "integrate" },
  { from: "lattice", to: "ucb", kinds: ["action", "integrate"], default_kind: "integrate" },
  { from: "ucb", to: "lattice", kinds: ["action", "integrate"], default_kind: "integrate" },
  { from: "lattice", to: "data_input", kinds: ["integrate", "action"], default_kind: "integrate" },
  { from: "data_input", to: "lattice", kinds: ["integrate", "action"], default_kind: "integrate" },
  { from: "lattice", to: "data_output", kinds: ["integrate", "action"], default_kind: "integrate" },
  { from: "data_output", to: "lattice", kinds: ["integrate", "action"], default_kind: "integrate" },
  { from: "lattice", to: "regulation", kinds: ["policy", "action"], default_kind: "policy" },
  { from: "regulation", to: "lattice", kinds: ["policy", "action"], default_kind: "policy" },
  { from: "lattice", to: "component", kinds: ["action", "integrate", "policy"], default_kind: "action" },
  { from: "component", to: "lattice", kinds: ["action", "integrate", "policy"], default_kind: "action" },
  { from: "dock_validation", to: "agent", kinds: ["policy"], default_kind: "policy" },
  { from: "dock_inference", to: "agent", kinds: ["policy"], default_kind: "policy" },
  { from: "agent", to: "agent", kinds: ["communicate"], default_kind: "communicate" },
];

const interactionLookup = new Map();
for (const row of INTERACTION_MATRIX) {
  interactionLookup.set(`${row.from}->${row.to}`, row);
}

function inferDefaultEdgeKind(fromType, toType) {
  const row = interactionLookup.get(`${fromType}->${toType}`);
  if (row) return row.default_kind;
  const reverse = interactionLookup.get(`${toType}->${fromType}`);
  if (reverse) return reverse.default_kind;
  if (
    ALLOWED_NODE_TYPES.has(fromType)
    && ALLOWED_NODE_TYPES.has(toType)
    && (fromType.includes("dock_") || toType.includes("dock_"))
  ) {
    return "policy";
  }
  if (fromType === "data_input" || fromType === "data_output" || toType === "data_input" || toType === "data_output") {
    return "integrate";
  }
  if (fromType === "connector" || toType === "connector" || fromType === "ucb" || toType === "ucb") {
    return "integrate";
  }
  if ((fromType === "agent" && toType === "lattice") || (fromType === "lattice" && toType === "agent")) {
    return "communicate";
  }
  return "action";
}

function edgeKindAllowed(fromType, toType, kind) {
  const k = kind || inferDefaultEdgeKind(fromType, toType);
  if (!ALLOWED_EDGE_KINDS.includes(k)) return false;
  const row = interactionLookup.get(`${fromType}->${toType}`);
  if (row) return row.kinds.includes(k);
  const reverse = interactionLookup.get(`${toType}->${fromType}`);
  if (reverse) return reverse.kinds.includes(k);
  return ALLOWED_EDGE_KINDS.includes(k);
}

/**
 * Build hyperlattice-encoded composer protocol specification.
 */
export function buildComposerProtocolSpec() {
  return {
    id: COMPOSER_PROTOCOL_ID,
    version: COMPOSER_PROTOCOL_VERSION,
    composer: "composer-lite",
    node_family: "composer_protocol",
    node_types: NODE_PALETTE.filter((p) => p.type !== "wasm_policy").map((p) => ({
      type: p.type,
      label: p.label,
      aep_id: p.aep_id ?? null,
      catalog_id: p.catalog_id ?? p.registry_id ?? null,
      description: p.description ?? null,
      shape: p.shape ?? "rect",
    })),
    edge_kinds: ALLOWED_EDGE_KINDS.map((kind) => ({ kind, transport: REQUIRED_EDGE_CHANNEL })),
    edge_flows: [...ALLOWED_EDGE_FLOWS],
    interactions: INTERACTION_MATRIX,
    forbidden_canvas_registry_ids: [...FORBIDDEN_CANVAS_REGISTRY_IDS],
    rules: [
      "One Action Lattice funnel hub (type=lattice) is the PAD router; never duplicate dynaep-core as a component rectangle.",
      "All inter-node edges use lattice channels; raw_http and bypass_lattice are forbidden.",
      "Docks (dock_validation, dock_inference, dock_regulation) wire toward the lattice hub.",
      "Agents attach to the lattice hub via communicate or action edges.",
      "UCB, connector and storage nodes use integrate edges through the hub.",
      "wasm_policy is not in the Lite catalog; use lattice stage policies instead.",
      "CCA plans and graph suggestions must pass validateComposerTopology before apply.",
    ],
  };
}

/**
 * Validate a Composer graph or ImplementationPlan topology against AEP protocol rules.
 * @param {object} graphOrPlan - { nodes, edges } or plan.topology
 */
export function validateComposerTopology(graphOrPlan) {
  const errors = [];
  const warnings = [];
  const nodes = graphOrPlan?.nodes ?? [];
  const edges = graphOrPlan?.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  if (!nodes.length) {
    errors.push("composer protocol: topology has no nodes");
    return { valid: false, errors, warnings, protocol_id: COMPOSER_PROTOCOL_ID };
  }

  const latticeHubs = nodes.filter((n) => n.type === "lattice");
  if (!latticeHubs.length) {
    errors.push("composer protocol: missing Action Lattice hub (type=lattice)");
  } else if (latticeHubs.length > 1) {
    warnings.push("composer protocol: multiple lattice hubs; prefer exactly one funnel hub");
  }

  for (const node of nodes) {
    if (!node?.id) {
      errors.push("composer protocol: node missing id");
      continue;
    }
    if (node.type === "dynaep" || node.type === "wasm_policy") {
      errors.push(`composer protocol: forbidden node type ${node.type} on node ${node.id}`);
    }
    if (!ALLOWED_NODE_TYPES.has(node.type)) {
      errors.push(`composer protocol: unknown node type ${node.type} on node ${node.id}`);
    }
    const registryId = node.data?.registry_id ?? node.data?.component_id;
    if (registryId && FORBIDDEN_CANVAS_REGISTRY_IDS.has(registryId)) {
      errors.push(
        `composer protocol: registry id ${registryId} must not be a canvas rectangle (use lattice hub)`,
      );
    }
  }

  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      errors.push(`composer protocol: edge ${edge.id ?? `${edge.from}->${edge.to}`} references unknown node`);
      continue;
    }
    if (edge.transport === "raw_http" || edge.bypass_lattice === true) {
      errors.push(`composer protocol: edge ${edge.from}->${edge.to} must use lattice channels`);
    }
    const kind = edge.kind ?? inferDefaultEdgeKind(from.type, to.type);
    if (!edgeKindAllowed(from.type, to.type, kind)) {
      errors.push(
        `composer protocol: edge ${edge.from}(${from.type})->${edge.to}(${to.type}) kind=${kind ?? "none"} not permitted`,
      );
    }
    const flow = String(edge.flow ?? "to").toLowerCase();
    if (!ALLOWED_EDGE_FLOWS.includes(flow)) {
      errors.push(`composer protocol: edge ${edge.from}->${edge.to} flow=${flow} not permitted`);
    }
  }

  const dockTypes = new Set(["dock_validation", "dock_inference", "dock_regulation"]);
  for (const dock of nodes.filter((n) => dockTypes.has(n.type))) {
    const wired = edges.some(
      (e) =>
        (e.from === dock.id && byId.get(e.to)?.type === "lattice")
        || (e.to === dock.id && byId.get(e.from)?.type === "lattice"),
    );
    if (!wired) {
      warnings.push(`composer protocol: dock ${dock.id} is not wired to the lattice hub`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    protocol_id: COMPOSER_PROTOCOL_ID,
    version: COMPOSER_PROTOCOL_VERSION,
  };
}

/** Compact protocol summary for CCA system prompts. */
export function formatComposerProtocolForPrompt(spec = buildComposerProtocolSpec()) {
  const types = spec.node_types.map((n) => n.type).join(", ");
  const kinds = spec.edge_kinds.map((k) => k.kind).join(", ");
  const interactionLines = spec.interactions
    .slice(0, 14)
    .map((i) => `  ${i.from} -> ${i.to}: ${i.kinds.join("|")} (default ${i.default_kind})`);
  return [
    "AEP Composer Lite protocol (hyperlattice composer_protocol node family):",
    `Allowed node types: ${types}`,
    `Allowed edge kinds: ${kinds}`,
    `Edge flows: ${spec.edge_flows.join(", ")}`,
    "Interaction matrix (subset):",
    ...interactionLines,
    "Rules:",
    ...spec.rules.map((r) => `- ${r}`),
  ].join("\n");
}