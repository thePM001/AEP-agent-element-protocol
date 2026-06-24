/** WASM Composer canvas engine - nodes, edges, pan/zoom. */

import {
  hitPortAt,
  portConnectWorldPosition,
  portLocalPosition,
  portWorldPosition,
  projectPortAngle,
} from "./port-geometry.js";
import { bindTooltips } from "./lite-tooltip.js";

const AGENTSTREAM_CONNECTOR_ID = "conn-agentstream";
const DEFAULT_STORAGE_BACKEND = "local";

const state = {
  graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, scale: 1 } },
  palette: [],
  integrations: { agentstream: { connected: false, online: false } },
  mode: "select",
  selectedId: null,
  selectedEdgeId: null,
  connectFrom: null,
  connectDrag: null,
  connectTargetId: null,
  hoverPort: null,
  portDrag: null,
  drag: null,
  pan: null,
  emptyGesture: null,
  spacePan: false,
  hoverLatticeStage: null,
  pendingStageClick: null,
  dragMoved: false,
  blastOverlay: {
    enabled: false,
    intentId: null,
    highlightedNodeIds: new Set(),
    componentIds: [],
  },
};

const EDGE_FLOW = { TO: "to", FROM: "from" };

const STORAGE_BACKEND_LABELS = {
  local: "Local Buffer",
  hcs: "HCS",
  agentstream: "Agentstream",
  surrealdb: "Surreal DB",
  google_drive: "Google Drive",
};

const STORAGE_BACKEND_CONNECTORS = {
  hcs: "conn-hcs",
  agentstream: "conn-agentstream",
  surrealdb: "conn-surrealdb",
  google_drive: "conn-google-drive",
};

const PAN_THRESHOLD = 4;

let onLatticeStageClick = null;
const PORT_DRAG_THRESHOLD = 5;
const viewportListeners = new Set();

const NODE_LAYOUT = {
  default: { width: 168, height: 72, shape: "card" },
  lattice: { width: 210, height: 140, shape: "funnel", short: "AL" },
  storage: { width: 176, height: 56, shape: "rect" },
  connector: { width: 148, height: 72, shape: "diamond" },
  agentstreamRing: { width: 200, height: 120, shape: "ring", short: "AS" },
};

const LATTICE_STAGE_LABELS = ["WARN", "SOFT", "HARD"];
const LATTICE_STAGE_KEYS = ["warn", "soft", "hard"];
const LATTICE_STAGE_CLASS = ["stage-warn", "stage-soft", "stage-hard"];
const LATTICE_STAGE_COLORS = ["#8edcff", "#3de8ff", "#1a8fff"];

const $ = (sel) => document.querySelector(sel);

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function paletteItemFor(nodeOrType) {
  const node = typeof nodeOrType === "object" ? nodeOrType : null;
  const type = node?.type ?? nodeOrType;
  const data = node?.data ?? {};
  const keys = [data.catalog_id, data.registry_id, type].filter(Boolean);
  for (const key of keys) {
    const hit = state.palette.find(
      (p) => p.catalog_id === key || p.registry_id === key || p.type === key,
    );
    if (hit) return hit;
  }
  return state.palette.find((p) => p.type === type) ?? null;
}

function nodeColor(typeOrNode) {
  const item = paletteItemFor(typeOrNode);
  return item?.color ?? "#3de8ff";
}

function nodeTypeLabel(node) {
  const item = paletteItemFor(node);
  if (item?.short) return item.short;
  if (item?.label) return item.label.slice(0, 8).toUpperCase();
  return String(node?.type || "NODE").slice(0, 8).toUpperCase();
}

function nodeTypeHtml(node) {
  return `<div class="node-type">${escapeHtml(nodeTypeLabel(node))}</div>`;
}

export function isAgentstreamConnected() {
  return Boolean(state.integrations?.agentstream?.connected);
}

export function isAgentstreamNode(node) {
  if (!node) return false;
  const data = node.data || {};
  if (data.render_mode === "agentstream_ring") return true;
  if (data.hub_connector_id === AGENTSTREAM_CONNECTOR_ID) return true;
  if (node.type === "connector" && data.storage_backend === "agentstream") return true;
  return node.type === "connector" && String(node.label || "").toLowerCase().includes("agentstream");
}

function resolveLatticeScale(data = {}) {
  const raw = Number(data?.lattice_scale);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(2.6, Math.max(0.65, raw));
}

function nodeLayout(node) {
  if (isAgentstreamNode(node)) return NODE_LAYOUT.agentstreamRing;
  const type = node?.type;
  if (type === "lattice") {
    const scale = resolveLatticeScale(node?.data);
    return {
      ...NODE_LAYOUT.lattice,
      width: Math.round(NODE_LAYOUT.lattice.width * scale),
      height: Math.round(NODE_LAYOUT.lattice.height * scale),
    };
  }
  if (type === "data_input" || type === "data_output") return NODE_LAYOUT.storage;
  if (type === "connector") return NODE_LAYOUT.connector;
  return NODE_LAYOUT.default;
}

function defaultNodeData(type) {
  if (type === "lattice") {
    return {
      catalog_id: "builtin-lattice",
      aep_id: "NT-00002",
      channel_id: "lattice-channel-default",
      lattice_id: "dynaep-action-lattice",
      contract_id: "dynaep-action-lattice",
      trust_score: 900,
      pad_stage: "warn",
      notes: "",
    };
  }
  if (type === "data_input") {
    return {
      aep_id: "NT-00008",
      storage_backend: DEFAULT_STORAGE_BACKEND,
      storage_role: "input",
      contract_id: "dynaep-action-lattice",
      trust_score: 700,
      notes: "",
    };
  }
  if (type === "data_output") {
    return {
      aep_id: "NT-00009",
      storage_backend: DEFAULT_STORAGE_BACKEND,
      storage_role: "output",
      contract_id: "dynaep-action-lattice",
      trust_score: 700,
      notes: "",
    };
  }
  if (type === "agent") {
    return {
      agent_template_id: "default-agent-v1",
      channel_id: "agent-channel-default",
      pad_stage: "warn",
      contract_id: "dynaep-action-lattice",
      trust_score: 750,
      notes: "",
    };
  }
  if (type === "dock_validation") {
    return {
      validation_url: "",
      fail_closed: true,
      contract_id: "dynaep-action-lattice",
      trust_score: 800,
      notes: "",
    };
  }
  if (type === "dock_inference") {
    return {
      inference_provider: "openrouter",
      model_id: "openrouter/auto",
      base_url: "",
      contract_id: "dynaep-action-lattice",
      trust_score: 750,
      notes: "",
    };
  }
  if (type === "connector") {
    return {
      catalog_id: "builtin-connector",
      aep_id: "NT-00006",
      integration_hub: "composer-lite",
      hub_binding: "optional",
      integration_kind: "application",
      application_name: "",
      service_key: "",
      hub_connector_id: "",
      service_url: "",
      auth_mode: "api_key",
      contract_id: "dynaep-action-lattice",
      trust_score: 700,
      notes: "",
    };
  }
  if (type === "component") {
    return {
      contract_id: "dynaep-action-lattice",
      trust_score: 700,
      notes: "",
      component: {
        registry_id: "",
        catalog_id: "",
        version: "0.0.0",
      },
    };
  }
  if (type === "regulation" || type === "dock_regulation") {
    return {
      contract_id: "dynaep-action-lattice",
      trust_score: 700,
      notes: "",
      regulation: {
        mode: "warn",
        policy_id: "aep.regulation",
        policy_version: "1.0.0",
        scope: "stage",
      },
    };
  }
  if (type === "ucb") {
    return {
      catalog_id: "ucb",
      contract_id: "dynaep-action-lattice",
      trust_score: 700,
      notes: "",
      ucb: {
        bridge_id: "aep.ucb",
        mode: "attach",
      },
    };
  }
  if (type === "wasm_policy") {
    return {
      contract_id: "dynaep-action-lattice",
      trust_score: 700,
      notes: "",
      wasm_policy: { enabled: true },
    };
  }
  return { contract_id: "dynaep-action-lattice", trust_score: 700, notes: "" };
}

function storageBackendLabel(backend) {
  return STORAGE_BACKEND_LABELS[backend] || backend || "Storage";
}

function inferEdgeKind(fromId, toId) {
  const from = state.graph.nodes.find((n) => n.id === fromId);
  const to = state.graph.nodes.find((n) => n.id === toId);
  if (!from || !to) return "action";
  const types = new Set([from.type, to.type]);
  if (types.has("data_input") || types.has("data_output")) {
    return "integrate";
  }
  if (types.has("connector")) return "integrate";
  if (types.has("dock_validation") || types.has("dock_inference")) {
    if (types.has("lattice")) return "action";
    return "policy";
  }
  if (types.has("agent") && types.has("lattice")) return "communicate";
  return "action";
}

function portWorldPos(node, kind) {
  return portWorldPosition(node, nodeLayout(node), kind);
}

function portConnectPos(node, kind) {
  return portConnectWorldPosition(node, nodeLayout(node), kind);
}

function applyPortPositions(el, node) {
  const layout = nodeLayout(node);
  for (const kind of ["in", "out"]) {
    const btn = el.querySelector(`.port-${kind}`);
    if (!btn) continue;
    const pos = portLocalPosition(node, layout, kind);
    btn.style.left = `${pos.x}px`;
    btn.style.top = `${pos.y}px`;
  }
}

function createEdge(fromId, toId, kind, flow = EDGE_FLOW.TO) {
  if (!fromId || !toId || fromId === toId) return null;
  if (state.graph.edges.some((e) => e.from === fromId && e.to === toId)) return null;
  const edge = {
    id: uid("e"),
    from: fromId,
    to: toId,
    kind: kind || inferEdgeKind(fromId, toId),
    flow: flow === EDGE_FLOW.FROM ? EDGE_FLOW.FROM : EDGE_FLOW.TO,
  };
  state.graph.edges.push(edge);
  renderNodes();
  notifyGraphChange("connect", { from: fromId, to: toId, kind: edge.kind });
  return edge;
}

function purgeAgentstreamNodes() {
  const removeIds = new Set(state.graph.nodes.filter((n) => isAgentstreamNode(n)).map((n) => n.id));
  if (!removeIds.size) return false;
  state.graph.nodes = state.graph.nodes.filter((n) => !removeIds.has(n.id));
  state.graph.edges = state.graph.edges.filter(
    (e) => !removeIds.has(e.from) && !removeIds.has(e.to),
  );
  if (removeIds.has(state.selectedId)) {
    state.selectedId = null;
    window.dispatchEvent(new CustomEvent("wasm-composer:select", { detail: { nodeId: null } }));
  }
  return true;
}

function normalizeStorageBackends() {
  let changed = false;
  for (const node of state.graph.nodes) {
    if (node.type !== "data_input" && node.type !== "data_output") continue;
    if (node.data?.storage_backend !== "agentstream") continue;
    if (isAgentstreamConnected()) continue;
    node.data = { ...node.data, storage_backend: DEFAULT_STORAGE_BACKEND };
    changed = true;
  }
  return changed;
}

function ensureAgentstreamRingNode() {
  if (!isAgentstreamConnected()) return null;
  let ring = state.graph.nodes.find((n) => isAgentstreamNode(n));
  const lattice = state.graph.nodes.find((n) => n.type === "lattice");
  const x = lattice ? lattice.x + 280 : 420;
  const y = lattice ? lattice.y + 40 : 200;
  if (!ring) {
    ring = {
      id: uid("agentstream"),
      type: "connector",
      label: "Agentstream",
      x,
      y,
      data: {
        hub_connector_id: AGENTSTREAM_CONNECTOR_ID,
        storage_backend: "agentstream",
        render_mode: "agentstream_ring",
        integration_hub: "composer-lite",
        hub_binding: "paid",
        ring_scale: 1,
        contract_id: "dynaep-action-lattice",
        trust_score: 700,
      },
    };
    state.graph.nodes.push(ring);
  } else {
    ring.label = ring.label || "Agentstream";
    ring.data = {
      ...ring.data,
      hub_connector_id: AGENTSTREAM_CONNECTOR_ID,
      storage_backend: "agentstream",
      render_mode: "agentstream_ring",
      hub_binding: "paid",
    };
  }
  return ring;
}

export function syncAgentstreamGraph() {
  let changed = false;
  if (!isAgentstreamConnected()) {
    changed = purgeAgentstreamNodes() || changed;
    changed = normalizeStorageBackends() || changed;
    if (changed) renderNodes();
    return changed;
  }
  const ring = ensureAgentstreamRingNode();
  if (ring) changed = true;
  for (const node of state.graph.nodes) {
    if (
      (node.type === "data_input" || node.type === "data_output")
      && node.data?.storage_backend === "agentstream"
    ) {
      linkStorageToBackend(node, { quiet: true });
    }
  }
  if (changed) renderNodes();
  return changed;
}

export function setIntegrations(integrations = {}) {
  state.integrations = {
    agentstream: {
      connected: false,
      online: false,
      ...(integrations?.agentstream || {}),
    },
  };
  syncAgentstreamGraph();
  window.dispatchEvent(
    new CustomEvent("wasm-composer:integrations", { detail: { integrations } }),
  );
}

function linkStorageToBackend(node, options = {}) {
  const backend = node.data?.storage_backend || DEFAULT_STORAGE_BACKEND;
  if (backend === "agentstream" && !isAgentstreamConnected()) {
    if (node.data?.storage_backend === "agentstream") {
      node.data = { ...node.data, storage_backend: DEFAULT_STORAGE_BACKEND };
    }
    return;
  }
  const connectorId = STORAGE_BACKEND_CONNECTORS[backend];
  if (!connectorId && backend !== "agentstream") return;

  let connector = null;
  if (backend === "agentstream") {
    connector = ensureAgentstreamRingNode();
  } else {
    connector = state.graph.nodes.find(
      (n) =>
        n.type === "connector"
        && !isAgentstreamNode(n)
        && (n.data?.hub_connector_id === connectorId || n.data?.storage_backend === backend),
    );
    if (!connector) {
      connector = addNode(
        "connector",
        storageBackendLabel(backend),
        node.x + 140,
        node.y,
        {
          hub_connector_id: connectorId,
          storage_backend: backend,
          integration_hub: "composer-lite",
          hub_binding: "always",
        },
        { skipStorageLink: true, skipNotify: true },
      );
    }
  }
  if (!connector) return;
  const linked = state.graph.edges.some(
    (e) => (e.from === node.id && e.to === connector.id) || (e.from === connector.id && e.to === node.id),
  );
  if (!linked) createEdge(node.id, connector.id, "integrate");
  if (!options.quiet) notifyGraphChange("integrate", { nodeId: node.id, backend });
}

function notifyViewportChange() {
  for (const fn of viewportListeners) fn();
}

function applyViewport() {
  const world = $("#canvas-world");
  const vp = state.graph.viewport ?? { x: 0, y: 0, scale: 1 };
  world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`;
  notifyViewportChange();
}

const EDGE_PALETTE = {
  flowTo: {
    glow: "#F0E878",
    core: "#FFF8C8",
    outer: "rgba(255, 255, 255, 0.22)",
    rim: "rgba(212, 200, 74, 0.62)",
  },
  flowFrom: {
    glow: "#FB5079",
    core: "#FFD4DE",
    outer: "rgba(255, 255, 255, 0.18)",
    rim: "rgba(251, 80, 121, 0.58)",
  },
};

function normalizeEdgeFlow(edge) {
  const flow = String(edge?.flow || "").toLowerCase();
  return flow === EDGE_FLOW.FROM ? EDGE_FLOW.FROM : EDGE_FLOW.TO;
}

function edgePalette(edge) {
  return normalizeEdgeFlow(edge) === EDGE_FLOW.FROM ? EDGE_PALETTE.flowFrom : EDGE_PALETTE.flowTo;
}

function bezierMidpoint(x1, y1, x2, y2) {
  const scale = state.graph.viewport?.scale || 1;
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 40 * scale };
}

function bezierPath(x1, y1, x2, y2) {
  const { x: mx, y: my } = bezierMidpoint(x1, y1, x2, y2);
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

function bezierPoint(a, b, t) {
  const { x: mx, y: my } = bezierMidpoint(a.x, a.y, b.x, b.y);
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * mx + t * t * b.x,
    y: u * u * a.y + 2 * u * t * my + t * t * b.y,
  };
}

function hitNodeAt(wx, wy) {
  const hits = [];
  const pad = 22;
  for (let i = state.graph.nodes.length - 1; i >= 0; i--) {
    const node = state.graph.nodes[i];
    const layout = nodeLayout(node);
    if (
      wx >= node.x - pad
      && wx <= node.x + layout.width + pad
      && wy >= node.y - pad
      && wy <= node.y + layout.height + pad
    ) {
      hits.push(node);
    }
  }
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];
  return hits.reduce((best, node) => {
    const bl = nodeLayout(best);
    const nl = nodeLayout(node);
    return bl.width * bl.height < nl.width * nl.height ? best : node;
  });
}

function hitEdgeAt(wx, wy) {
  const scale = state.graph.viewport?.scale || 1;
  const threshold = 24 / scale;
  const thresholdSq = threshold * threshold;
  let best = null;
  let bestDist = thresholdSq;
  for (let i = state.graph.edges.length - 1; i >= 0; i--) {
    const edge = state.graph.edges[i];
    const from = state.graph.nodes.find((n) => n.id === edge.from);
    const to = state.graph.nodes.find((n) => n.id === edge.to);
    if (!from || !to) continue;
    const endpoints = edgeEndpoints(from, to, edge);
    for (let t = 0; t <= 1; t += 0.04) {
      const p = bezierPoint(endpoints.from, endpoints.to, t);
      const dist = (wx - p.x) ** 2 + (wy - p.y) ** 2;
      if (dist <= bestDist) {
        bestDist = dist;
        best = edge;
      }
    }
  }
  return best;
}

function portGlyph(kind) {
  return kind === "out" ? ">" : "<";
}

function portButtonHtml(kind) {
  const glyph = portGlyph(kind);
  const tip = kind === "out"
    ? "OUTGOING PORT > CLICK OR DRAG TO CONNECT"
    : "INCOMING PORT < DROP CONNECTION HERE";
  const label = kind === "out" ? "Outgoing port, drag to connect" : "Incoming port, connect here";
  return `<button type="button" class="port port-${kind}" data-port="${kind}" data-lite-tip="${tip}" aria-label="${label}">
    <span class="port-halo" aria-hidden="true"></span>
    <span class="port-ring port-ring-3" aria-hidden="true"></span>
    <span class="port-ring port-ring-2" aria-hidden="true"></span>
    <span class="port-ring port-ring-1" aria-hidden="true"></span>
    <span class="port-disc" aria-hidden="true"></span>
    <span class="port-glyph" aria-hidden="true">${glyph}</span>
  </button>`;
}

function portLinked(nodeId, kind) {
  if (!nodeId) return false;
  if (kind === "out") return state.graph.edges.some((e) => e.from === nodeId);
  return state.graph.edges.some((e) => e.to === nodeId);
}

function findPortAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY)?.closest?.(".port[data-port]");
  if (el) {
    const nodeEl = el.closest(".graph-node");
    if (nodeEl?.dataset.nodeId) {
      return { nodeId: nodeEl.dataset.nodeId, kind: el.dataset.port, el };
    }
  }
  const world = screenToWorld(clientX, clientY);
  const scale = state.graph.viewport?.scale || 1;
  const hit = hitPortAt(state.graph.nodes, nodeLayout, world.x, world.y, scale);
  if (!hit) return null;
  return { nodeId: hit.nodeId, kind: hit.kind, el: null };
}

function syncPortStates() {
  document.querySelectorAll(".port[data-port]").forEach((el) => {
    const nodeId = el.closest(".graph-node")?.dataset.nodeId;
    const kind = el.dataset.port;
    el.classList.toggle("port-in", kind === "in");
    el.classList.toggle("port-out", kind === "out");
    el.classList.toggle("is-hover", state.hoverPort?.nodeId === nodeId && state.hoverPort?.kind === kind);
    el.classList.toggle("is-source", state.connectDrag?.fromId === nodeId && kind === "out");
    el.classList.toggle("is-target", state.connectTargetId === nodeId && kind === "in");
    el.classList.toggle("is-linked", portLinked(nodeId, kind));
  });
}

function ensureEdgeDefs(svg) {
  if (svg.querySelector("#edge-defs")) return;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.id = "edge-defs";
  defs.innerHTML = `
    <filter id="edge-glow-soft" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="3.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="edge-glow-strong" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;
  svg.prepend(defs);
}

function appendGlowEdgeGroup(svg, d, edge, selected) {
  const palette = edgePalette(edge);
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.classList.add("edge-group");
  g.dataset.edgeId = edge.id;
  g.dataset.flow = normalizeEdgeFlow(edge);
  const layers = [
    { class: "edge-layer edge-layer-outer", stroke: palette.outer, width: 7, filter: "url(#edge-glow-strong)" },
    { class: "edge-layer edge-layer-rim", stroke: palette.rim, width: 5, filter: "url(#edge-glow-soft)" },
    { class: "edge-layer edge-layer-mid", stroke: palette.glow, width: 3, filter: "url(#edge-glow-soft)" },
    { class: "edge-layer edge-layer-core", stroke: palette.core, width: 1.6 },
    { class: "edge-layer edge-hit", stroke: palette.core, width: 12, hit: true },
  ];
  for (const layer of layers) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    const selectedCls = selected && (layer.hit || layer.class.includes("edge-layer-core")) ? " selected" : "";
    path.setAttribute("class", `${layer.class}${selectedCls}`);
    path.setAttribute("stroke", layer.stroke);
    path.setAttribute("stroke-width", String(layer.width));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    if (layer.filter) path.setAttribute("filter", layer.filter);
    if (layer.hit) {
      path.dataset.edgeId = edge.id;
      path.setAttribute("stroke-opacity", "0.001");
    }
    g.appendChild(path);
  }
  svg.appendChild(g);
}

function appendGlowPreview(svg, d) {
  const palette = EDGE_PALETTE.flowTo;
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.classList.add("edge-preview-group");
  g.setAttribute("pointer-events", "none");
  const layers = [
    { class: "edge-layer edge-preview-outer", stroke: palette.rim, width: 6, dash: "8 6" },
    { class: "edge-layer edge-preview-core", stroke: palette.core, width: 2.4, dash: "8 6" },
  ];
  for (const layer of layers) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", layer.class);
    path.setAttribute("stroke", layer.stroke);
    path.setAttribute("stroke-width", String(layer.width));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("pointer-events", "none");
    if (layer.dash) path.setAttribute("stroke-dasharray", layer.dash);
    path.setAttribute("filter", "url(#edge-glow-soft)");
    g.appendChild(path);
  }
  svg.appendChild(g);
}

function nodeCenter(node) {
  const layout = nodeLayout(node);
  if (layout.shape === "funnel") {
    return { x: node.x + layout.width / 2, y: node.y + layout.height / 2 };
  }
  return { x: node.x + layout.width / 2, y: node.y + layout.height / 2 };
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getLatticeStageBands(width, height) {
  const hw = width / 2;
  const hh = height / 2;
  const tiers = LATTICE_STAGE_LABELS.length;
  const gap = Math.max(3, hh * 0.028);
  const topReserve = hh * 0.3;
  const span = hh * 2 - topReserve;
  const bands = [];
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const t2 = (i + 1) / tiers;
    const y1 = -hh + topReserve + i * (span / tiers);
    const y2 = y1 + span / tiers - gap;
    const w1 = hw * (1 - t * 0.64);
    const w2 = hw * (1 - t2 * 0.64);
    bands.push({
      index: i,
      key: LATTICE_STAGE_KEYS[i],
      label: LATTICE_STAGE_LABELS[i],
      color: LATTICE_STAGE_COLORS[i],
      points: [
        [hw - w1, hh + y1],
        [hw + w1, hh + y1],
        [hw + w2, hh + y2],
        [hw - w2, hh + y2],
      ],
      cx: hw,
      cy: hh + (y1 + y2) / 2,
    });
  }
  return bands;
}

function pointsAttr(points) {
  return points.map((p) => p.map((v) => Math.round(v * 10) / 10).join(",")).join(" ");
}

function clearLatticeStageHover() {
  if (!state.hoverLatticeStage) return;
  state.hoverLatticeStage = null;
  document.querySelectorAll(".funnel-stage-band.is-hovered").forEach((el) => {
    el.classList.remove("is-hovered");
  });
  $("#canvas-stage")?.classList.remove("lattice-stage-hover");
}

function setLatticeStageHover(nodeId, stageIndex) {
  if (state.drag || state.pan) {
    clearLatticeStageHover();
    return;
  }
  const prev = state.hoverLatticeStage;
  if (prev?.nodeId === nodeId && prev?.stageIndex === stageIndex) return;
  document.querySelectorAll(".funnel-stage-band.is-hovered").forEach((el) => {
    el.classList.remove("is-hovered");
  });
  state.hoverLatticeStage = nodeId == null ? null : { nodeId, stageIndex };
  if (nodeId != null && Number.isInteger(stageIndex)) {
    const band = document.querySelector(
      `.graph-node[data-node-id="${nodeId}"] .funnel-stage-band[data-stage="${stageIndex}"]`,
    );
    band?.classList.add("is-hovered");
    $("#canvas-stage")?.classList.add("lattice-stage-hover");
  } else {
    $("#canvas-stage")?.classList.remove("lattice-stage-hover");
  }
}

function renderLatticeNode(el, node, layout) {
  const bands = getLatticeStageBands(layout.width, layout.height);
  const hover = state.hoverLatticeStage?.nodeId === node.id ? state.hoverLatticeStage.stageIndex : null;
  const activeStage = node.data?.pad_stage;
  const stageSvg = bands
    .map((band) => {
      const hovered = hover === band.index;
      const active = activeStage === band.key;
      const cls = [
        "funnel-stage-band",
        LATTICE_STAGE_CLASS[band.index],
        hovered ? "is-hovered" : "",
        active ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `
        <g class="${cls}" data-stage="${band.index}" data-stage-key="${band.key}">
          <polygon class="funnel-stage-fill" points="${pointsAttr(band.points)}" />
          <text class="funnel-stage-label" x="${band.cx}" y="${band.cy}" text-anchor="middle" dominant-baseline="middle">${band.label}</text>
        </g>
      `;
    })
    .join("");

  el.classList.add("shape-funnel", "lattice-hub");
  el.style.width = `${layout.width}px`;
  el.style.minHeight = `${layout.height}px`;
  el.innerHTML = `
    ${portButtonHtml("in")}
    ${portButtonHtml("out")}
    <div class="lattice-node-head">
      ${nodeTypeHtml(node)}
      <div class="node-label">${escapeHtml(node.label ?? "Action Lattice Hub")}</div>
    </div>
    <div class="funnel-shell">
      <svg class="funnel-stages-svg" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true">
        ${stageSvg}
      </svg>
    </div>
  `;
}

function renderCardNode(el, node) {
  el.innerHTML = `
    ${portButtonHtml("in")}
    ${portButtonHtml("out")}
    ${nodeTypeHtml(node)}
    <div class="node-label">${escapeHtml(node.label ?? node.type)}</div>
  `;
}

function renderStorageNode(el, node, layout) {
  const backend = node.data?.storage_backend ? storageBackendLabel(node.data.storage_backend) : "";
  el.classList.add("shape-rect", "storage-node");
  el.style.width = `${layout.width}px`;
  el.style.minHeight = `${layout.height}px`;
  el.innerHTML = `
    ${portButtonHtml("in")}
    ${portButtonHtml("out")}
    <div class="storage-node-role">${node.type === "data_output" ? "EXPORT" : "IMPORT"}</div>
    ${nodeTypeHtml(node)}
    <div class="node-label">${escapeHtml(node.label ?? node.type)}</div>
    ${backend ? `<div class="storage-node-backend">${escapeHtml(backend)}</div>` : ""}
  `;
}

function renderConnectorNode(el, node, layout) {
  el.classList.add("shape-diamond", "connector-node");
  el.style.width = `${layout.width}px`;
  el.style.minHeight = `${layout.height}px`;
  el.innerHTML = `
    ${portButtonHtml("in")}
    ${portButtonHtml("out")}
    <div class="connector-shell">
      <div class="connector-node-glyph">${escapeHtml(nodeTypeLabel(node))}</div>
      <div class="node-label">${escapeHtml(node.label ?? "Integration Hub")}</div>
      <div class="node-type node-type-sub">${escapeHtml(String(node.type || "connector").toUpperCase())}</div>
    </div>
  `;
}

function renderAgentstreamRingNode(el, node, layout) {
  const w = layout.width;
  const h = layout.height;
  const cx = w / 2;
  const cy = h / 2;
  const outerRx = w * 0.46;
  const outerRy = h * 0.44;
  const innerRx = outerRx * 0.86;
  const innerRy = outerRy * 0.86;
  el.classList.add("shape-ring", "agentstream-ring");
  el.style.width = `${w}px`;
  el.style.minHeight = `${h}px`;
  el.dataset.renderMode = "agentstream_ring";
  el.innerHTML = `
    ${portButtonHtml("in")}
    ${portButtonHtml("out")}
    <svg class="agentstream-ring-svg" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <defs>
        <radialGradient id="as-ring-fill-${node.id}" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stop-color="#C45C2C" stop-opacity="0.92" />
          <stop offset="45%" stop-color="#D96B2E" stop-opacity="0.98" />
          <stop offset="100%" stop-color="#F08A4A" stop-opacity="0.75" />
        </radialGradient>
        <filter id="as-ring-glow-${node.id}" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path class="agentstream-ring-body" fill="url(#as-ring-fill-${node.id})" filter="url(#as-ring-glow-${node.id})"
        d="M ${cx + outerRx} ${cy}
           A ${outerRx} ${outerRy} 0 1 1 ${cx - outerRx} ${cy}
           A ${outerRx} ${outerRy} 0 1 1 ${cx + outerRx} ${cy}
           M ${cx + innerRx} ${cy}
           A ${innerRx} ${innerRy} 0 1 0 ${cx - innerRx} ${cy}
           A ${innerRx} ${innerRy} 0 1 0 ${cx + innerRx} ${cy} Z" />
      <ellipse class="agentstream-ring-inner-stroke" cx="${cx}" cy="${cy}" rx="${innerRx}" ry="${innerRy}" fill="none" />
    </svg>
    <div class="agentstream-ring-label">${escapeHtml(node.label ?? "Agentstream")}</div>
    <div class="agentstream-ring-kicker">PAID CONNECTOR</div>
  `;
}

function edgeEndpoints(fromNode, toNode, edge) {
  const flow = edge?.flow === EDGE_FLOW.FROM ? EDGE_FLOW.FROM : EDGE_FLOW.TO;
  if (flow === EDGE_FLOW.FROM) {
    return {
      from: portConnectPos(toNode, "out"),
      to: portConnectPos(fromNode, "in"),
    };
  }
  return {
    from: portConnectPos(fromNode, "out"),
    to: portConnectPos(toNode, "in"),
  };
}

function renderEdges() {
  const svg = $("#edges-layer");
  if (!svg) return;
  ensureEdgeDefs(svg);
  svg.querySelectorAll(":scope > .edge-group, :scope > .edge-preview-group").forEach((el) => el.remove());
  for (const edge of state.graph.edges) {
    const from = state.graph.nodes.find((n) => n.id === edge.from);
    const to = state.graph.nodes.find((n) => n.id === edge.to);
    if (!from || !to) continue;
    const { from: a, to: b } = edgeEndpoints(from, to, edge);
    appendGlowEdgeGroup(svg, bezierPath(a.x, a.y, b.x, b.y), edge, edge.id === state.selectedEdgeId);
  }
  if (state.connectDrag) {
    appendGlowPreview(
      svg,
      bezierPath(state.connectDrag.fromX, state.connectDrag.fromY, state.connectDrag.toX, state.connectDrag.toY),
    );
  }
}

function renderNodes() {
  const layer = $("#nodes-layer");
  layer.innerHTML = "";
  for (const node of state.graph.nodes) {
    const layout = nodeLayout(node);
    const el = document.createElement("div");
    let cls = `graph-node${node.id === state.selectedId ? " selected" : ""}`;
    if (state.blastOverlay.enabled) {
      cls += state.blastOverlay.highlightedNodeIds.has(node.id)
        ? " blast-hit"
        : " blast-dim";
    }
    el.className = cls;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.setProperty("--node-accent", nodeColor(node.type));
    el.dataset.nodeId = node.id;
    el.dataset.nodeType = node.type;
    if (isAgentstreamNode(node)) {
      renderAgentstreamRingNode(el, node, layout);
    } else if (layout.shape === "funnel") {
      renderLatticeNode(el, node, layout);
    } else if (layout.shape === "rect") {
      renderStorageNode(el, node, layout);
    } else if (layout.shape === "diamond") {
      renderConnectorNode(el, node, layout);
    } else {
      renderCardNode(el, node);
    }
    applyPortPositions(el, node);
    layer.appendChild(el);
  }
  bindTooltips(layer);
  renderEdges();
  syncPortStates();
  updateStats();
  notifyViewportChange();
}

function updateStats() {
  const nodes = $("#stat-nodes");
  const edges = $("#stat-edges");
  const mode = $("#stat-mode");
  if (nodes) nodes.textContent = `${state.graph.nodes.length} nodes`;
  if (edges) edges.textContent = `${state.graph.edges.length} edges`;
  if (mode) mode.textContent = `mode: ${state.mode}`;
}

function notifyGraphChange(kind, detail = {}) {
  window.dispatchEvent(new CustomEvent("wasm-composer:graph-change", { detail: { kind, ...detail } }));
}

export function selectNode(id) {
  state.selectedId = id;
  state.selectedEdgeId = null;
  renderNodes();
  window.dispatchEvent(new CustomEvent("wasm-composer:select", { detail: { nodeId: id } }));
}

function placementOffset(type) {
  const layout = nodeLayout({ type });
  return { x: layout.width / 2, y: layout.height / 2 };
}

function addNode(type, label, x, y, dataPatch = {}, options = {}) {
  const paletteItem = paletteItemFor({ type, data: dataPatch });
  const node = {
    id: uid("n"),
    type,
    label: label ?? paletteItem?.label ?? type,
    x: Math.round(x),
    y: Math.round(y),
    data: { ...defaultNodeData(type), ...dataPatch },
  };
  state.graph.nodes.push(node);
  renderNodes();
  selectNode(node.id);
  if (!options.skipNotify) {
    notifyGraphChange("place", { nodeId: node.id, type: node.type, label: node.label });
  }
  if ((type === "data_input" || type === "data_output") && !options.skipStorageLink) {
    linkStorageToBackend(node);
  }
  return node;
}

export function placeNodeAtCenter(type, label, dataPatch = {}) {
  const stage = $("#canvas-stage");
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  const center = screenToWorld(rect.left + rect.clientWidth / 2, rect.top + rect.clientHeight / 2);
  const off = placementOffset(type);
  return addNode(type, label, center.x - off.x, center.y - off.y, dataPatch);
}

export function placeNodeAt(type, clientX, clientY, label, dataPatch = {}) {
  const pos = screenToWorld(clientX, clientY);
  const off = placementOffset(type);
  return addNode(type, label, pos.x - off.x, pos.y - off.y, dataPatch);
}

export function placeNodeAtWorld(type, wx, wy, label, dataPatch = {}) {
  const off = placementOffset(type);
  return addNode(type, label, wx - off.x, wy - off.y, dataPatch);
}

export function centerOnNode(nodeId) {
  const node = state.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const layout = nodeLayout(node);
  centerOnWorld(node.x + layout.width / 2, node.y + layout.height / 2);
}

export function updateNodeById(nodeId, patch = {}) {
  const node = state.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  if (patch.label !== undefined) node.label = patch.label;
  if (patch.data) node.data = { ...node.data, ...patch.data };
  renderNodes();
  if (state.selectedId === nodeId) {
    window.dispatchEvent(new CustomEvent("wasm-composer:select", { detail: { nodeId } }));
  }
  notifyGraphChange("update", { nodeId, type: node.type, label: node.label });
}

export function getPalette() {
  return state.palette;
}

export function getSelectedEdgeId() {
  return state.selectedEdgeId;
}

export function getNodeById(id) {
  return state.graph.nodes.find((n) => n.id === id) ?? null;
}

export function deleteEdge(edgeId) {
  if (!edgeId) return;
  state.graph.edges = state.graph.edges.filter((e) => e.id !== edgeId);
  if (state.selectedEdgeId === edgeId) state.selectedEdgeId = null;
  renderNodes();
  notifyGraphChange("delete", { edgeId });
}

export function removeEdgesForNode(nodeId) {
  if (!nodeId) return;
  const before = state.graph.edges.length;
  state.graph.edges = state.graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  if (state.selectedEdgeId && !state.graph.edges.some((e) => e.id === state.selectedEdgeId)) {
    state.selectedEdgeId = null;
  }
  if (state.graph.edges.length !== before) {
    renderNodes();
    notifyGraphChange("delete", { nodeId });
  }
}

export function selectEdge(edgeId) {
  state.selectedEdgeId = edgeId || null;
  if (edgeId) state.selectedId = null;
  renderNodes();
  window.dispatchEvent(new CustomEvent("wasm-composer:select", { detail: { nodeId: null } }));
}

export function setEdgeKind(edgeId, kind) {
  const edge = state.graph.edges.find((e) => e.id === edgeId);
  if (!edge || edge.kind === kind) return;
  edge.kind = kind;
  renderNodes();
  notifyGraphChange("update", { edgeId, kind });
}

export function setEdgeFlow(edgeId, flow) {
  const edge = state.graph.edges.find((e) => e.id === edgeId);
  if (!edge) return;
  const next = flow === EDGE_FLOW.FROM ? EDGE_FLOW.FROM : EDGE_FLOW.TO;
  if (normalizeEdgeFlow(edge) === next) return;
  edge.flow = next;
  renderNodes();
  notifyGraphChange("update", { edgeId, flow: next });
}

export function getEdgesForNode(nodeId) {
  return state.graph.edges
    .filter((e) => e.from === nodeId || e.to === nodeId)
    .map((e) => {
      const outbound = e.from === nodeId;
      const peerId = outbound ? e.to : e.from;
      const peer = state.graph.nodes.find((n) => n.id === peerId);
      return {
        id: e.id,
        kind: e.kind || "action",
        peerId,
        peerLabel: peer?.label || peer?.type || peerId,
        direction: outbound ? "out" : "in",
      };
    });
}

export function duplicateNode(nodeId) {
  const src = state.graph.nodes.find((n) => n.id === nodeId);
  if (!src) return null;
  const data = src.data ? JSON.parse(JSON.stringify(src.data)) : defaultNodeData(src.type);
  return addNode(src.type, `${src.label || src.type} Copy`, src.x + 80, src.y + 56, data);
}

export function beginConnectFrom(nodeId) {
  beginConnectDrag(nodeId);
}

function cancelConnectDrag() {
  state.connectDrag = null;
  state.connectFrom = null;
  state.connectTargetId = null;
  const stage = $("#canvas-stage");
  stage?.classList.remove("connecting", "connect-drag", "connect-mode", "port-drag");
  renderEdges();
  syncPortStates();
}

function beginConnectDrag(fromId) {
  const node = state.graph.nodes.find((n) => n.id === fromId);
  if (!node) return;
  const from = portWorldPos(node, "out");
  state.connectDrag = {
    fromId,
    fromX: from.x,
    fromY: from.y,
    toX: from.x,
    toY: from.y,
    sticky: true,
  };
  state.connectFrom = fromId;
  state.connectTargetId = null;
  const stage = $("#canvas-stage");
  stage?.classList.add("connecting", "connect-drag", "connect-mode");
  renderEdges();
  syncPortStates();
}

function resolveConnectFinishTarget(clientX, clientY, fromId) {
  const portHit = findPortAt(clientX, clientY);
  if (portHit) {
    if (portHit.nodeId === fromId) return null;
    if (portHit.kind === "out") return null;
    return portHit.nodeId;
  }
  const world = screenToWorld(clientX, clientY);
  const node = hitNodeAt(world.x, world.y);
  if (!node || node.id === fromId) return null;
  return node.id;
}

function tryFinishConnection(clientX, clientY) {
  if (!state.connectDrag) return false;
  const fromId = state.connectDrag.fromId;
  const toId = resolveConnectFinishTarget(clientX, clientY, fromId);
  if (!toId) return false;
  const edge = createEdge(fromId, toId);
  if (!edge) return false;
  cancelConnectDrag();
  return true;
}

function portSnapTarget(clientX, clientY, fromId) {
  const toId = resolveConnectFinishTarget(clientX, clientY, fromId);
  if (toId) {
    state.connectTargetId = toId;
    const node = state.graph.nodes.find((n) => n.id === toId);
    if (node) {
      syncPortStates();
      return portWorldPos(node, "in");
    }
  }
  state.connectTargetId = null;
  syncPortStates();
  const pos = screenToWorld(clientX, clientY);
  return { x: pos.x, y: pos.y };
}

export function deleteNode(nodeId) {
  if (!nodeId) return;
  const removed = state.graph.nodes.find((n) => n.id === nodeId);
  state.graph.nodes = state.graph.nodes.filter((n) => n.id !== nodeId);
  state.graph.edges = state.graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  if (state.selectedId === nodeId) {
    state.selectedId = null;
    window.dispatchEvent(new CustomEvent("wasm-composer:select", { detail: { nodeId: null } }));
  }
  renderNodes();
  notifyGraphChange("delete", { nodeId, type: removed?.type, label: removed?.label });
}

function removeSelection() {
  if (state.selectedEdgeId) {
    deleteEdge(state.selectedEdgeId);
  } else if (state.selectedId) {
    deleteNode(state.selectedId);
  }
}

function screenToWorld(clientX, clientY) {
  const stage = $("#canvas-stage").getBoundingClientRect();
  const vp = state.graph.viewport ?? { x: 0, y: 0, scale: 1 };
  return {
    x: (clientX - stage.left - vp.x) / vp.scale,
    y: (clientY - stage.top - vp.y) / vp.scale,
  };
}

function fitView() {
  if (!state.graph.nodes.length) {
    state.graph.viewport = { x: 40, y: 40, scale: 1 };
    applyViewport();
    return;
  }
  const bounds = state.graph.nodes.map((n) => {
    const layout = nodeLayout(n);
    return {
      x1: n.x,
      y1: n.y,
      x2: n.x + layout.width,
      y2: n.y + layout.height,
    };
  });
  const minX = Math.min(...bounds.map((b) => b.x1)) - 40;
  const minY = Math.min(...bounds.map((b) => b.y1)) - 40;
  const maxX = Math.max(...bounds.map((b) => b.x2)) + 40;
  const maxY = Math.max(...bounds.map((b) => b.y2)) + 40;
  const stage = $("#canvas-stage");
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const scale = Math.min(1.2, Math.min(sw / (maxX - minX), sh / (maxY - minY)));
  state.graph.viewport = {
    x: (sw - (maxX - minX) * scale) / 2 - minX * scale,
    y: (sh - (maxY - minY) * scale) / 2 - minY * scale,
    scale,
  };
  applyViewport();
}

function isTypingTarget(el) {
  return el && (el.matches("input, textarea, select, [contenteditable]") || el.closest(".neo-select"));
}

function setupSpacePan(stage) {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !isTypingTarget(e.target)) {
      if (state.connectDrag) {
        e.preventDefault();
        cancelConnectDrag();
        return;
      }
    }
    if (e.code !== "Space" || e.repeat || isTypingTarget(e.target)) return;
    e.preventDefault();
    state.spacePan = true;
    stage?.classList.add("space-pan");
  });
  window.addEventListener("keyup", (e) => {
    if (e.code !== "Space") return;
    state.spacePan = false;
    stage?.classList.remove("space-pan");
  });
}

function setupInteractions() {
  const stage = $("#canvas-stage");
  setupSpacePan(stage);

  stage.addEventListener("dragover", (ev) => ev.preventDefault());
  stage.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const raw = ev.dataTransfer.getData("application/x-wasm-node");
    if (!raw) return;
    const item = JSON.parse(raw);
    const pos = screenToWorld(ev.clientX, ev.clientY);
    const off = placementOffset(item.type);
    addNode(item.type, item.label, pos.x - off.x, pos.y - off.y, item.data || {});
  });

  document.querySelectorAll(".tool[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool[data-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.mode = btn.dataset.mode;
      state.connectFrom = null;
      if (state.connectDrag) cancelConnectDrag();
      updateStats();
    });
  });

  $("#btn-delete")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("wasm-composer:delete-request"));
  });
  $("#btn-fit")?.addEventListener("click", fitView);

  stage.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;

    if (state.connectDrag?.sticky) {
      ev.preventDefault();
      ev.stopPropagation();
      if (tryFinishConnection(ev.clientX, ev.clientY)) return;
      const portHit = findPortAt(ev.clientX, ev.clientY);
      const nodeId = ev.target.closest(".graph-node")?.dataset?.nodeId || portHit?.nodeId;
      if (nodeId === state.connectDrag.fromId) return;
      cancelConnectDrag();
      return;
    }

    const nodeEl = ev.target.closest(".graph-node");
    const port = ev.target.closest(".port");
    const stageBand = ev.target.closest(".funnel-stage-band");

    if (stageBand && nodeEl?.classList.contains("lattice-hub")) {
      const nodeId = nodeEl.dataset.nodeId;
      const stageKey = stageBand.dataset.stageKey;
      const stageIndex = Number(stageBand.dataset.stage);
      const node = state.graph.nodes.find((n) => n.id === nodeId);
      state.pendingStageClick = { nodeId, stageIndex, stageKey };
      state.dragMoved = false;
      setLatticeStageHover(nodeId, stageIndex);
      selectNode(nodeId);
      window.dispatchEvent(
        new CustomEvent("wasm-composer:stage-select", {
          detail: { nodeId, stageIndex, stageKey },
        }),
      );
      if (!port && node) {
        state.drag = {
          id: nodeId,
          ox: ev.clientX,
          oy: ev.clientY,
          nx: node.x,
          ny: node.y,
        };
        stage.setPointerCapture(ev.pointerId);
      }
      return;
    }

    if (state.mode === "pan" || state.spacePan || ev.button === 1) {
      state.emptyGesture = null;
      state.pan = { x: ev.clientX, y: ev.clientY, vx: state.graph.viewport.x, vy: state.graph.viewport.y };
      stage.classList.add("panning");
      stage.setPointerCapture(ev.pointerId);
      return;
    }

    if (port && nodeEl && state.mode !== "pan" && !state.spacePan) {
      ev.preventDefault();
      ev.stopPropagation();
      const nodeId = nodeEl.dataset.nodeId;
      const kind = port.dataset.port;
      if (kind === "out" && !ev.shiftKey) {
        beginConnectDrag(nodeId);
        stage.setPointerCapture(ev.pointerId);
        return;
      }
      state.portDrag = {
        nodeId,
        kind,
        ox: ev.clientX,
        oy: ev.clientY,
        moved: false,
      };
      stage.classList.add("port-drag");
      stage.setPointerCapture(ev.pointerId);
      return;
    }

    if (state.mode === "connect" && nodeEl) {
      ev.preventDefault();
      ev.stopPropagation();
      const nodeId = nodeEl.dataset.nodeId;
      if (state.connectDrag?.fromId === nodeId) return;
      if (state.connectDrag?.fromId) {
        tryFinishConnection(ev.clientX, ev.clientY);
      } else {
        beginConnectDrag(nodeId);
      }
      stage.setPointerCapture(ev.pointerId);
      return;
    }

    if (nodeEl) {
      const nodeId = nodeEl.dataset.nodeId;
      state.pendingStageClick = null;
      state.dragMoved = false;
      selectNode(nodeId);
      const node = state.graph.nodes.find((n) => n.id === nodeId);
      state.drag = {
        id: nodeId,
        ox: ev.clientX,
        oy: ev.clientY,
        nx: node.x,
        ny: node.y,
      };
      stage.setPointerCapture(ev.pointerId);
      return;
    }

    const edgeHit = ev.target.closest(".edge-hit, path.edge-hit");
    if (edgeHit?.dataset.edgeId) {
      state.selectedEdgeId = edgeHit.dataset.edgeId;
      state.selectedId = null;
      renderNodes();
      window.dispatchEvent(new CustomEvent("wasm-composer:select", { detail: { nodeId: null } }));
      return;
    }

    state.selectedId = null;
    state.selectedEdgeId = null;
    renderNodes();
    window.dispatchEvent(new CustomEvent("wasm-composer:select", { detail: { nodeId: null } }));
    state.emptyGesture = { ox: ev.clientX, oy: ev.clientY, pointerId: ev.pointerId };
    stage.setPointerCapture(ev.pointerId);
  });

  stage.addEventListener("pointermove", (ev) => {
    if (state.portDrag) {
      const dist = Math.hypot(ev.clientX - state.portDrag.ox, ev.clientY - state.portDrag.oy);
      if (dist >= PORT_DRAG_THRESHOLD) {
        state.portDrag.moved = true;
        const node = state.graph.nodes.find((n) => n.id === state.portDrag.nodeId);
        if (node) {
          const layout = nodeLayout(node);
          const world = screenToWorld(ev.clientX, ev.clientY);
          const angle = projectPortAngle(node, layout, world.x, world.y);
          node.data = { ...node.data, port_angle: angle };
          const nodeEl = document.querySelector(`.graph-node[data-node-id="${node.id}"]`);
          if (nodeEl) applyPortPositions(nodeEl, node);
        }
      }
      return;
    }

    if (state.connectDrag) {
      const snap = portSnapTarget(ev.clientX, ev.clientY, state.connectDrag.fromId);
      state.connectDrag.toX = snap.x;
      state.connectDrag.toY = snap.y;
      renderEdges();
      syncPortStates();
      return;
    }

    const hover = findPortAt(ev.clientX, ev.clientY);
    const nextHover = hover ? { nodeId: hover.nodeId, kind: hover.kind } : null;
    if (nextHover?.nodeId !== state.hoverPort?.nodeId || nextHover?.kind !== state.hoverPort?.kind) {
      state.hoverPort = nextHover;
      syncPortStates();
    }

    if (state.emptyGesture && !state.pan && !state.drag) {
      const dx = ev.clientX - state.emptyGesture.ox;
      const dy = ev.clientY - state.emptyGesture.oy;
      if (Math.hypot(dx, dy) >= PAN_THRESHOLD) {
        state.pan = {
          x: ev.clientX,
          y: ev.clientY,
          vx: state.graph.viewport.x,
          vy: state.graph.viewport.y,
        };
        state.emptyGesture = null;
        stage.classList.add("panning");
      }
    }

    if (!state.pan && !state.drag) {
      const band = ev.target.closest(".funnel-stage-band");
      if (band) {
        const nodeEl = band.closest(".graph-node");
        setLatticeStageHover(nodeEl?.dataset.nodeId ?? null, Number(band.dataset.stage));
      } else if (!ev.target.closest(".graph-node.shape-funnel")) {
        clearLatticeStageHover();
      }
    }

    if (state.pan) {
      const dx = ev.clientX - state.pan.x;
      const dy = ev.clientY - state.pan.y;
      state.graph.viewport.x = state.pan.vx + dx;
      state.graph.viewport.y = state.pan.vy + dy;
      applyViewport();
      return;
    }
    if (state.drag) {
      if (Math.hypot(ev.clientX - state.drag.ox, ev.clientY - state.drag.oy) >= PAN_THRESHOLD) {
        state.dragMoved = true;
      }
      const vp = state.graph.viewport ?? { scale: 1 };
      const dx = (ev.clientX - state.drag.ox) / vp.scale;
      const dy = (ev.clientY - state.drag.oy) / vp.scale;
      const node = state.graph.nodes.find((n) => n.id === state.drag.id);
      if (node) {
        node.x = Math.round(state.drag.nx + dx);
        node.y = Math.round(state.drag.ny + dy);
        renderNodes();
      }
    }
  });

  stage.addEventListener("pointerup", (ev) => {
    if (state.portDrag) {
      const { nodeId, moved } = state.portDrag;
      const node = state.graph.nodes.find((n) => n.id === nodeId);
      if (node && moved) {
        notifyGraphChange("update", { nodeId, type: node.type, label: node.label });
      }
      state.portDrag = null;
      stage.classList.remove("port-drag");
    } else if (state.connectDrag?.sticky) {
      tryFinishConnection(ev.clientX, ev.clientY);
    }
    if (state.pendingStageClick && !state.dragMoved) {
      const { nodeId, stageIndex, stageKey } = state.pendingStageClick;
      const node = state.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        node.data = { ...node.data, pad_stage: stageKey };
        renderNodes();
        onLatticeStageClick?.(node, stageIndex);
      }
      window.dispatchEvent(
        new CustomEvent("wasm-composer:stage-click", {
          detail: { nodeId, stageIndex, stageKey },
        }),
      );
    }
    if (state.drag) {
      const node = state.graph.nodes.find((n) => n.id === state.drag.id);
      if (node && (node.x !== state.drag.nx || node.y !== state.drag.ny)) {
        notifyGraphChange("move", { nodeId: node.id, x: node.x, y: node.y });
      }
    }
    state.pendingStageClick = null;
    state.dragMoved = false;
    state.drag = null;
    state.pan = null;
    state.emptyGesture = null;
    stage.classList.remove("panning");
  });

  stage.addEventListener("pointerleave", () => {
    if (!state.drag) clearLatticeStageHover();
  });

  stage.addEventListener(
    "contextmenu",
    (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (state.connectDrag) {
        cancelConnectDrag();
        return;
      }
      const world = screenToWorld(ev.clientX, ev.clientY);
      const edge = hitEdgeAt(world.x, world.y);
      const node = hitNodeAt(world.x, world.y);
      const target = edge && (!node || ev.altKey)
        ? { edge, node: null }
        : node
          ? { edge: null, node }
          : edge
            ? { edge, node: null }
            : { edge: null, node: null };
      window.dispatchEvent(
        new CustomEvent("wasm-composer:context-menu", {
          detail: {
            clientX: ev.clientX,
            clientY: ev.clientY,
            world,
            node: target.node,
            edge: target.edge,
          },
        }),
      );
    },
    true,
  );

  stage.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const vp = state.graph.viewport ?? { x: 0, y: 0, scale: 1 };
      const delta = ev.deltaY > 0 ? 0.92 : 1.08;
      const next = Math.min(2.5, Math.max(0.35, vp.scale * delta));
      const rect = stage.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      state.graph.viewport = {
        x: mx - ((mx - vp.x) * next) / vp.scale,
        y: my - ((my - vp.y) * next) / vp.scale,
        scale: next,
      };
      applyViewport();
    },
    { passive: false },
  );
}

export function getGraph() {
  return state.graph;
}

export function getSelectedId() {
  return state.selectedId;
}

export function getCanvasMode() {
  return state.mode;
}

export function updateSelectedNode(patch) {
  if (!state.selectedId) return;
  const node = state.graph.nodes.find((n) => n.id === state.selectedId);
  if (!node) return;
  const prevBackend = node.data?.storage_backend;
  Object.assign(node, patch);
  if (patch.data) node.data = { ...node.data, ...patch.data };
  renderNodes();
  notifyGraphChange("update", { nodeId: node.id });
  if (
    (node.type === "data_input" || node.type === "data_output")
    && patch.data?.storage_backend
    && patch.data.storage_backend !== prevBackend
  ) {
    linkStorageToBackend(node);
  }
}

export function setGraph(graph) {
  state.graph = {
    nodes: (graph.nodes ?? []).map((node) => {
      if (node.type === "lattice" && !node.data?.aep_id) {
        return { ...node, data: { ...defaultNodeData("lattice"), ...node.data } };
      }
      if (node.type === "dynaep") {
        return {
          ...node,
          type: "lattice",
          label: node.label ?? "Action Lattice Hub",
          data: { ...defaultNodeData("lattice"), ...node.data, _migrated_from: "dynaep" },
        };
      }
      if (
        node.type === "dock_validation"
        && (!node.label || node.label === "Validation Dock")
      ) {
        return { ...node, label: "AEP Validation Engine Dock" };
      }
      return node;
    }),
    edges: (graph.edges ?? []).map((edge) => ({
      ...edge,
      flow: normalizeEdgeFlow(edge) === EDGE_FLOW.FROM ? EDGE_FLOW.FROM : EDGE_FLOW.TO,
    })),
    viewport: graph.viewport ?? { x: 40, y: 40, scale: 1 },
  };
  syncAgentstreamGraph();
  applyViewport();
  renderNodes();
}

export function setPalette(palette) {
  state.palette = palette;
  window.dispatchEvent(new CustomEvent("wasm-composer:palette", { detail: { palette } }));
}

export function mergeSuggestion(suggestion) {
  if (!suggestion) return { nodesAdded: 0, edgesAdded: 0 };
  let nodesAdded = 0;
  let edgesAdded = 0;
  const existing = new Set(state.graph.nodes.map((n) => n.id));
  for (const node of suggestion.nodes ?? []) {
    if (!existing.has(node.id)) {
      state.graph.nodes.push({
        ...node,
        data: node.data ?? defaultNodeData(node.type),
      });
      nodesAdded += 1;
    }
  }
  const edgeIds = new Set(state.graph.edges.map((e) => e.id));
  for (const edge of suggestion.edges ?? []) {
    if (!edgeIds.has(edge.id)) {
      state.graph.edges.push({
        ...edge,
        flow: normalizeEdgeFlow(edge) === EDGE_FLOW.FROM ? EDGE_FLOW.FROM : EDGE_FLOW.TO,
      });
      edgesAdded += 1;
    }
  }
  renderNodes();
  fitView();
  if (nodesAdded || edgesAdded) {
    const parts = [];
    if (nodesAdded) parts.push(`${nodesAdded} node${nodesAdded === 1 ? "" : "s"}`);
    if (edgesAdded) parts.push(`${edgesAdded} edge${edgesAdded === 1 ? "" : "s"}`);
    notifyGraphChange("plan", {
      label: `Applied CCA plan (+${parts.join(", ")})`,
      nodesAdded,
      edgesAdded,
    });
  }
  return { nodesAdded, edgesAdded };
}

export function getWorldBounds() {
  const pad = 240;
  if (!state.graph.nodes.length) {
    return { minX: -500, minY: -400, width: 1000, height: 800 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of state.graph.nodes) {
    const layout = nodeLayout(node);
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + layout.width);
    maxY = Math.max(maxY, node.y + layout.height);
  }
  return {
    minX: minX - pad,
    minY: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

export function getViewportWorldBounds() {
  const stage = $("#canvas-stage");
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  const tl = screenToWorld(rect.left, rect.top);
  const br = screenToWorld(rect.right, rect.bottom);
  return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
}

export function centerOnWorld(wx, wy) {
  const stage = $("#canvas-stage");
  if (!stage) return;
  const vp = state.graph.viewport ?? { x: 0, y: 0, scale: 1 };
  state.graph.viewport = {
    ...vp,
    x: stage.clientWidth / 2 - wx * vp.scale,
    y: stage.clientHeight / 2 - wy * vp.scale,
  };
  applyViewport();
}

export function onViewportChange(fn) {
  viewportListeners.add(fn);
  return () => viewportListeners.delete(fn);
}

export function getCanvasApi() {
  return {
    getGraph,
    getSelectedId,
    getWorldBounds,
    getViewportWorldBounds,
    centerOnWorld,
    nodeLayout,
    nodeColor,
  };
}

export function setBlastOverlay({ enabled, intentId = null, highlightedNodeIds = [], componentIds = [] } = {}) {
  state.blastOverlay = {
    enabled: Boolean(enabled),
    intentId,
    highlightedNodeIds: new Set(highlightedNodeIds),
    componentIds: [...componentIds],
  };
  $("#canvas-stage")?.classList.toggle("blast-overlay-active", state.blastOverlay.enabled);
  renderNodes();
}

export function clearBlastOverlay() {
  setBlastOverlay({ enabled: false });
}

export function getBlastOverlay() {
  return {
    enabled: state.blastOverlay.enabled,
    intentId: state.blastOverlay.intentId,
    highlightedNodeIds: [...state.blastOverlay.highlightedNodeIds],
    componentIds: [...state.blastOverlay.componentIds],
  };
}

export function setLatticeStageClickHandler(handler) {
  onLatticeStageClick = typeof handler === "function" ? handler : null;
}

export function initCanvas() {
  setupInteractions();
  applyViewport();
  updateStats();
}