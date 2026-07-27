import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { CANVAS_SKIP_COMPONENT_IDS } from "../../AEP-Components/cca/lib/component-catalog.mjs";

export const GRAPH_FILE = "composer-lite-graph.json";
const LEGACY_GRAPH_FILE = "wasm-composer-graph.json";

const EMPTY_GRAPH = () => ({
  version: "2.8.0",
  composer: "composer-lite",
  updated_at: null,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, scale: 1 },
});

export function starterGraph() {
  return {
    ...EMPTY_GRAPH(),
    nodes: [
      {
        id: "lattice-hub",
        type: "lattice",
        label: "Action Lattice Hub",
        x: 360,
        y: 220,
        data: {
          catalog_id: "builtin-lattice",
          aep_id: "NT-00002",
          channel_id: "lattice-channel-default",
          lattice_id: "dynaep-action-lattice",
          contract_id: "dynaep-action-lattice",
          trust_score: 900,
          pad_stage: "warn",
          notes: "",
        },
      },
      {
        id: "dock-validation",
        type: "dock_validation",
        label: "AEP Validation Engine Dock",
        x: 120,
        y: 140,
        data: {
          contract_id: "dynaep-action-lattice",
          trust_score: 800,
          notes: "",
        },
      },
      {
        id: "dock-inference",
        type: "dock_inference",
        label: "Inference Dock",
        x: 120,
        y: 320,
        data: {
          contract_id: "dynaep-action-lattice",
          trust_score: 800,
          notes: "",
        },
      },
      {
        id: "agent-primary",
        type: "agent",
        label: "Agent",
        x: 620,
        y: 220,
        data: {
          contract_id: "dynaep-action-lattice",
          trust_score: 700,
          notes: "",
        },
      },
    ],
    edges: [
      {
        id: "e-validation-lattice",
        from: "dock-validation",
        to: "lattice-hub",
        kind: "validation",
        flow: "to",
      },
      {
        id: "e-inference-lattice",
        from: "dock-inference",
        to: "lattice-hub",
        kind: "inference",
        flow: "to",
      },
      {
        id: "e-lattice-agent",
        from: "lattice-hub",
        to: "agent-primary",
        kind: "action",
        flow: "to",
      },
    ],
    viewport: { x: 40, y: 40, scale: 0.85 },
  };
}

export function graphPath(dataDir) {
  return join(dataDir, GRAPH_FILE);
}

function legacyGraphPath(dataDir) {
  return join(dataDir, LEGACY_GRAPH_FILE);
}

function normalizeGraphNode(node) {
  if (
    node?.type === "dock_validation"
    && (!node.label || node.label === "Validation Dock")
  ) {
    return { ...node, label: "AEP Validation Engine Dock" };
  }
  return node;
}

export function sanitizeGraph(graph) {
  if (!graph || typeof graph !== "object") return graph;
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const nodes = rawNodes
    .filter((node) => {
      if (!node?.id) return false;
      if (node.type === "dynaep") return false;
      const registryId = node.data?.registry_id ?? node.data?.component_id;
      if (registryId && CANVAS_SKIP_COMPONENT_IDS.has(registryId)) return false;
      return true;
    })
    .map(normalizeGraphNode);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(graph.edges) ? graph.edges : []).filter(
    (edge) => edge?.from && edge?.to && nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );
  return { ...graph, nodes, edges };
}

export function loadGraph(dataDir) {
  const path = graphPath(dataDir);
  const legacy = legacyGraphPath(dataDir);
  const source = existsSync(path) ? path : existsSync(legacy) ? legacy : null;
  if (!source) {
    return starterGraph();
  }
  try {
    const parsed = JSON.parse(readFileSync(source, "utf8"));
    const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
    const graph = sanitizeGraph({
      ...EMPTY_GRAPH(),
      ...parsed,
      composer: "composer-lite",
      nodes: rawNodes,
      edges: rawEdges,
    });
    if (!graph.nodes.length && !graph.edges.length) {
      return starterGraph();
    }
    if (graph.nodes.length < rawNodes.length || graph.edges.length < rawEdges.length) {
      saveGraph(dataDir, graph);
    }
    return graph;
  } catch {
    return starterGraph();
  }
}

export function saveGraph(dataDir, graph) {
  const path = graphPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const record = {
    ...graph,
    version: "2.8.0",
    composer: "composer-lite",
    updated_at: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows */
  }
  return record;
}

export function validateGraph(graph) {
  if (!graph || typeof graph !== "object") {
    throw new Error("graph must be an object");
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("graph requires nodes[] and edges[]");
  }
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node?.id || typeof node.id !== "string") {
      throw new Error("each node requires string id");
    }
    if (!node.type || typeof node.type !== "string") {
      throw new Error(`node ${node.id} requires type`);
    }
    if (typeof node.x !== "number" || typeof node.y !== "number") {
      throw new Error(`node ${node.id} requires numeric x,y`);
    }
    ids.add(node.id);
  }
  for (const edge of graph.edges) {
    if (!edge?.id || !edge.from || !edge.to) {
      throw new Error("each edge requires id, from, to");
    }
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new Error(`edge ${edge.id} references unknown node`);
    }
  }
  return true;
}

export function mergePalette(base, extensions = []) {
  const seen = new Set(
    base.map((item) => item.registry_id ?? item.catalog_id ?? item.type),
  );
  const merged = [...base];
  for (const item of extensions) {
    if (!item?.type) continue;
    const key = item.registry_id ?? item.catalog_id ?? item.type;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.filter(
    (item) =>
      item.type !== "wasm_policy"
      && !CANVAS_SKIP_COMPONENT_IDS.has(item.registry_id),
  );
}

export const NODE_PALETTE = [
  {
    type: "agent",
    label: "Agent",
    short: "AG",
    color: "#3de8ff",
    description: "Autonomous agent node with trust tier",
  },
  {
    type: "lattice",
    label: "Action Lattice Hub",
    short: "AL",
    color: "#3de8ff",
    shape: "funnel",
    aep_id: "NT-00002",
    catalog_id: "builtin-lattice",
    description: "dynAEP Action Lattice PAD router (funnel hub)",
  },
  {
    type: "dock_validation",
    label: "AEP Validation Engine Dock",
    short: "VD",
    color: "#4af2c8",
    description: "AEP Validation Engine dock on the Lattice Channel",
  },
  {
    type: "dock_inference",
    label: "Inference Dock",
    short: "ID",
    color: "#7aa7ff",
    description: "Inference engine dock for LLM routing",
  },
  {
    type: "connector",
    label: "Connector",
    short: "CN",
    color: "#38bdf8",
    shape: "diamond",
    aep_id: "NT-00006",
    catalog_id: "builtin-connector",
    description: "Bridge for applications and services connected to AEP",
  },
  {
    type: "ucb",
    label: "UCB Secured Dock",
    short: "UCB",
    color: "#a78bfa",
    shape: "diamond",
    aep_id: "NT-UCB-8412",
    catalog_id: "ucb",
    port: 8412,
    description: "Universal Connect Bridge for non-AEP agent protocols (LangGraph, MCP, AutoGen)",
  },
  {
    type: "data_input",
    label: "Storage Import",
    short: "IN",
    color: "#22d3ee",
    shape: "rect",
    aep_id: "NT-00008",
    storage_backend: "local",
    description: "Import payloads from a storage backend",
  },
  {
    type: "data_output",
    label: "Storage Export",
    short: "OUT",
    color: "#f472b6",
    shape: "rect",
    aep_id: "NT-00009",
    storage_backend: "local",
    description: "Export payloads to a storage backend",
  },
  {
    type: "dock_regulation",
    label: "Regulation Dock",
    short: "RD",
    color: "#fbbf24",
    description: "Regulation module dock for LRP governance",
  },
  {
    type: "regulation",
    label: "Regulation Pack",
    short: "RP",
    color: "#f59e0b",
    description: "LRP regulation or compliance component",
  },
  {
    type: "component",
    label: "AEP Component",
    short: "CP",
    color: "#94a3b8",
    description: "Generic AEP protocol component node",
  },
];