import {
  getGraph,
  setGraph,
  setPalette,
  getPalette,
  mergeSuggestion,
  initCanvas,
  getSelectedId,
  getSelectedEdgeId,
  getNodeById,
  deleteNode,
  deleteEdge,
  getCanvasApi,
  getCanvasMode,
  onViewportChange,
  selectNode,
  selectEdge,
  placeNodeAtCenter,
  placeNodeAt,
  placeNodeAtWorld,
  updateNodeById,
  getEdgesForNode,
  setEdgeFlow,
  setEdgeKind,
  duplicateNode,
  beginConnectFrom,
  removeEdgesForNode,
  centerOnNode,
  setIntegrations,
  isAgentstreamConnected,

  setLatticeStageClickHandler,
} from "./canvas.js";
import { LatticeContextMenu } from "./context-menu.js";
import { bindTooltips } from "./lite-tooltip.js";
import { initMinimap } from "./minimap.js";
import { confirmDialog, isConfirmOpen } from "./confirm-dialog.js";
import { initCcaPane } from "./cca-pane.js";
import { initLiteInspector } from "./lite-inspector.js";
import { initLiteSettings } from "./lite-settings.js";
import { EditLog, initActionLog } from "./action-log.js";
import { initNodeInventory } from "./node-inventory.js";
import { authFetch } from "./setup-auth.js";
const $ = (sel) => document.querySelector(sel);

let graphReady = false;
let saveTimer = null;
let saveInFlight = false;
let saveQueued = false;

async function api(path, opts = {}) {
  const res = await authFetch(path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 504) {
      throw new Error(
        json.error
          ?? "Gateway timeout (504). The CCA request took too long. Try a shorter message or wait a moment and retry.",
      );
    }
    throw new Error(json.error ?? `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
  }
  return json;
}

function setSyncStatus(text) {
  const el = $("#sync-status");
  if (el) el.textContent = text;
}

function nodeLabel(node) {
  if (!node) return "node";
  const label = node.label?.trim();
  return label ? `${label} (${node.type})` : node.type;
}

async function confirmDeleteSelection() {
  const edgeId = getSelectedEdgeId();
  if (edgeId) {
    deleteEdge(edgeId);
    return;
  }

  const nodeId = getSelectedId();
  if (!nodeId) return;

  const node = getNodeById(nodeId);
  if (!node) return;

  const edgeCount = getGraph().edges.filter((e) => e.from === nodeId || e.to === nodeId).length;
  const edgeNote = edgeCount
    ? ` This removes ${edgeCount} connected edge${edgeCount === 1 ? "" : "s"}.`
    : "";

  const ok = await confirmDialog({
    title: "DELETE NODE",
    body: `Delete ${nodeLabel(node)} from the canvas?${edgeNote}`,
    confirmText: "DELETE",
    cancelText: "CANCEL",
  });

  if (ok) deleteNode(nodeId);
}

function isTypingTarget(el) {
  return el && (el.matches("input, textarea, select, [contenteditable]") || el.closest(".neo-select"));
}

const editLog = new EditLog();
let restoringHistory = false;

function applyGraphSnapshot(graph) {
  restoringHistory = true;
  setGraph(graph);
  restoringHistory = false;
  schedulePersist();
  actionLog.notifyGraphChange();
}

function performUndo() {
  const snapshot = editLog.undo(getGraph);
  if (!snapshot) return;
  applyGraphSnapshot(snapshot);
}

function performRedo() {
  const snapshot = editLog.redo(getGraph);
  if (!snapshot) return;
  applyGraphSnapshot(snapshot);
}

const actionLog = initActionLog($("#composer-action-log"), {
  history: editLog,
  getNodes: () => getGraph().nodes,
  getSelectedId,
  getPalette,
  onSelectNode: selectNode,
  onUndo: performUndo,
  onRedo: performRedo,
});

let inventory = null;
let stagePolicyPanel = null;


function storageBackendChoices() {
  const choices = [
    { id: "local", label: "Local Buffer" },
    { id: "hcs", label: "HCS" },
    { id: "surrealdb", label: "Surreal DB" },
    { id: "google_drive", label: "Google Drive" },
  ];
  if (isAgentstreamConnected()) {
    choices.splice(2, 0, { id: "agentstream", label: "Agentstream" });
  }
  return choices;
}

const contextMenu = new LatticeContextMenu({
  onAction: (action, payload) => handleContextAction(action, payload),
});

function buildContextMenuItems(ctx) {
  const { node, edge, world } = ctx;
  if (node) {
    const links = getEdgesForNode(node.id);
    const items = [
      { id: "node.duplicate", label: "Duplicate Node", shortcut: "D", payload: { nodeId: node.id } },
      { id: "node.connect", label: "Connect from > port", shortcut: "C", payload: { nodeId: node.id } },
    ];
    if (node.type === "lattice") {
      items.unshift({
        id: "node.stage-policies",
        label: "Stage Policies (WARN / SOFT / HARD)…",
        payload: { nodeId: node.id },
      });
      items.push({ id: "node.focus-hub", label: "Focus Action Lattice", payload: { nodeId: node.id } });
    }
    if (node.type === "data_input" || node.type === "data_output") {
      items.push("sep");
      for (const backend of storageBackendChoices()) {
        items.push({
          id: "node.set-database",
          label: `Database: ${backend.label}`,
          payload: { nodeId: node.id, backend: backend.id },
          disabled: node.data?.storage_backend === backend.id,
        });
      }
    }
    if (links.length) {
      items.push("sep");
      items.push({
        id: "node.disconnect-all",
        label: `Remove All Links (${links.length})`,
        danger: true,
        payload: { nodeId: node.id },
      });
      for (const link of links) {
        const arrow = link.direction === "out" ? "→" : "←";
        items.push({
          id: "edge.delete",
          label: `Remove Link ${arrow} ${link.peerLabel}`,
          danger: true,
          payload: { edgeId: link.id },
        });
      }
    }
    items.push("sep");
    items.push({
      id: "node.delete",
      label: "Delete Node",
      shortcut: "Del",
      danger: true,
      payload: { nodeId: node.id },
    });
    return items;
  }
  if (edge) {
    const from = getGraph().nodes.find((n) => n.id === edge.from);
    const to = getGraph().nodes.find((n) => n.id === edge.to);
    const label = from && to ? `${from.label} → ${to.label}` : "connection";
    const flow = String(edge.flow || "to").toLowerCase();
    return [
      { id: "edge.inspect", label: `Selected: ${label}`, disabled: true },
      "sep",
      {
        id: "edge.flow-to",
        label: `Yellow: > ${from?.label || "?"} → < ${to?.label || "?"}`,
        payload: { edgeId: edge.id, flow: "to" },
        disabled: flow !== "from",
      },
      {
        id: "edge.flow-from",
        label: `Red: > ${to?.label || "?"} → < ${from?.label || "?"}`,
        payload: { edgeId: edge.id, flow: "from" },
        disabled: flow === "from",
      },
      "sep",
      {
        id: "edge.kind-action",
        label: "Set Kind: Action",
        payload: { edgeId: edge.id, kind: "action" },
        disabled: edge.kind === "action",
      },
      {
        id: "edge.kind-policy",
        label: "Set Kind: Policy",
        payload: { edgeId: edge.id, kind: "policy" },
        disabled: edge.kind === "policy",
      },
      {
        id: "edge.kind-communicate",
        label: "Set Kind: Communicate",
        payload: { edgeId: edge.id, kind: "communicate" },
        disabled: edge.kind === "communicate",
      },
      {
        id: "edge.kind-integrate",
        label: "Set Kind: Integrate",
        payload: { edgeId: edge.id, kind: "integrate" },
        disabled: edge.kind === "integrate",
      },
      "sep",
      {
        id: "edge.delete",
        label: "Remove Connection",
        shortcut: "Del",
        danger: true,
        payload: { edgeId: edge.id },
      },
    ];
  }
  return [
    { id: "canvas.add-lattice", label: "Add Action Lattice Hub", payload: { x: world.x, y: world.y } },
    { id: "canvas.open-inventory", label: "Create Node…", payload: {} },
    "sep",
    { id: "canvas.add-agent", label: "Add Agent", payload: { x: world.x, y: world.y } },
    { id: "canvas.add-validation-dock", label: "Add AEP Validation Engine Dock", payload: { x: world.x, y: world.y } },
    { id: "canvas.add-inference-dock", label: "Add Inference Dock", payload: { x: world.x, y: world.y } },
    { id: "canvas.add-connector", label: "Add Connector", payload: { x: world.x, y: world.y } },
    { id: "canvas.add-data-input", label: "Add Storage Import", payload: { x: world.x, y: world.y } },
    { id: "canvas.add-data-output", label: "Add Storage Export", payload: { x: world.x, y: world.y } },
  ];
}

function openContextMenu(ctx = {}) {
  if (!ctx.clientX && !ctx.clientY) return;
  if (contextMenu.isOpen()) contextMenu.hide();
  const items = buildContextMenuItems(ctx);
  if (!items.length) return;
  const meta = { target: ctx.node ? "node" : ctx.edge ? "edge" : "canvas" };
  if (ctx.edge) {
    selectEdge(ctx.edge.id);
  } else if (ctx.node) {
    selectNode(ctx.node.id);
  } else {
    selectEdge(null);
    selectNode(null);
  }
  contextMenu.show(ctx.clientX, ctx.clientY, items, meta);
}

async function handleContextAction(action, payload = {}) {
  if (action === "node.stage-policies") {
    const node = getNodeById(payload.nodeId);
    if (!node || node.type !== "lattice") return;
    selectNode(node.id);
    stagePolicyPanel?.open(node.id, 0);
    return;
  }
  if (action === "node.duplicate") {
    duplicateNode(payload.nodeId);
    return;
  }
  if (action === "node.connect") {
    beginConnectFrom(payload.nodeId);
    return;
  }
  if (action === "node.delete") {
    selectNode(payload.nodeId);
    await confirmDeleteSelection();
    return;
  }
  if (action === "node.set-database") {
    const node = getNodeById(payload.nodeId);
    if (!node) return;
    const backend = storageBackendChoices().find((item) => item.id === payload.backend);
    if (!backend) return;
    const role = node.type === "data_input" ? "Input" : "Output";
    updateNodeById(payload.nodeId, {
      label: node.label?.includes(backend.label) ? node.label : `${backend.label} ${role}`,
      data: {
        storage_backend: backend.id,
        storage_role: node.type === "data_input" ? "input" : "output",
      },
    });
    selectNode(payload.nodeId);
    return;
  }
  if (action === "node.focus-hub") {
    selectNode(payload.nodeId);
    centerOnNode(payload.nodeId);
    return;
  }
  if (action === "node.disconnect-all") {
    const node = getNodeById(payload.nodeId);
    const count = getEdgesForNode(payload.nodeId).length;
    if (!node || !count) return;
    const ok = await confirmDialog({
      title: "REMOVE ALL LINKS",
      body: `Remove ${count} connection${count === 1 ? "" : "s"} from ${nodeLabel(node)}?`,
      confirmText: "REMOVE",
      cancelText: "CANCEL",
    });
    if (ok) {
      removeEdgesForNode(payload.nodeId);
    }
    return;
  }
  if (action === "edge.delete") {
    deleteEdge(payload.edgeId);
    return;
  }
  if (action.startsWith("edge.kind-")) {
    setEdgeKind(payload.edgeId, payload.kind);
    return;
  }
  if (action.startsWith("edge.flow-")) {
    setEdgeFlow(payload.edgeId, payload.flow);
    return;
  }
  if (action === "canvas.open-inventory") {
    inventory?.togglePanel(true);
    return;
  }
  if (action === "canvas.add-lattice") {
    placeNodeAtWorld("lattice", payload.x, payload.y);
    return;
  }
  if (action === "canvas.add-agent") {
    placeNodeAtWorld("agent", payload.x, payload.y);
    return;
  }
  if (action === "canvas.add-validation-dock") {
    placeNodeAtWorld("dock_validation", payload.x, payload.y, "AEP Validation Engine Dock");
    return;
  }
  if (action === "canvas.add-inference-dock") {
    placeNodeAtWorld("dock_inference", payload.x, payload.y, "Inference Dock");
    return;
  }
  if (action === "canvas.add-connector") {
    placeNodeAtWorld("connector", payload.x, payload.y, "Connector", {
      integration_kind: "application",
      hub_binding: "optional",
    });
    return;
  }
  if (action === "canvas.add-data-input") {
    placeNodeAtWorld("data_input", payload.x, payload.y, "Storage Import", { storage_backend: "local" });
    return;
  }
  if (action === "canvas.add-data-output") {
    placeNodeAtWorld("data_output", payload.x, payload.y, "Storage Export", { storage_backend: "local" });
    return;
  }
}

function deployPayload(payload, clientX, clientY) {
  if (!payload?.type) return;
  if (clientX != null && clientY != null) {
    placeNodeAt(payload.type, clientX, clientY, payload.label, payload.data || {});
  } else {
    placeNodeAtCenter(payload.type, payload.label, payload.data || {});
  }
}

function graphChangeLabel(detail = {}) {
  const { kind, type, label, nodeId } = detail;
  const name = label || type || nodeId || "node";
  switch (kind) {
    case "place":
      return `Placed ${name}`;
    case "delete":
      return `Deleted ${name}`;
    case "move":
      return `Moved ${name}`;
    case "connect":
      return "Connected nodes";
    case "update":
      return `Updated ${name}`;
    case "plan":
      return detail.label || "Applied CCA plan";
    case "integrate":
      return "Linked storage backend";
    default:
      return "Canvas edit";
  }
}

function schedulePersist() {
  if (!graphReady) return;
  if (saveTimer) clearTimeout(saveTimer);
  setSyncStatus("syncing…");
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistGraph().catch(() => {});
  }, 600);
}

async function persistGraph() {
  if (!graphReady) return;
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  const graph = getGraph();
  saveInFlight = true;
  try {
    await api("api/graph", {
      method: "PUT",
      body: JSON.stringify({ ...graph, plan_sync: true }),
    });
    setSyncStatus("synced");
  } catch (err) {
    setSyncStatus(`sync error`);
    console.warn("graph persist failed:", err.message);
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      schedulePersist();
    }
  }
}

window.addEventListener("wasm-composer:graph-change", (ev) => {
  if (restoringHistory) return;
  const text = graphChangeLabel(ev.detail);
  editLog.recordChange(ev.detail?.kind || "edit", text, getGraph());
  actionLog.notifyGraphChange();
  schedulePersist();
});

window.addEventListener("wasm-composer:palette", (ev) => {
  inventory?.setPalette(ev.detail?.palette ?? getPalette());
});

window.addEventListener("wasm-composer:stage-click", (ev) => {
  const { nodeId, stageIndex } = ev.detail || {};
  if (nodeId != null) stagePolicyPanel?.open(nodeId, stageIndex);
});

window.addEventListener("wasm-composer:select", () => {
  actionLog.notifyGraphChange();
});

window.addEventListener("wasm-composer:delete-request", () => {
  confirmDeleteSelection();
});

window.addEventListener("wasm-composer:context-menu", (ev) => {
  openContextMenu(ev.detail || {});
});

document.addEventListener("keydown", (e) => {
  if (isTypingTarget(e.target)) return;
  if (isConfirmOpen()) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) performRedo();
    else performUndo();
    return;
  }
  if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    performRedo();
    return;
  }
  if (e.key !== "Backspace" && e.key !== "Delete") return;
  if (!getSelectedEdgeId() && !getSelectedId()) return;
  e.preventDefault();
  confirmDeleteSelection();
});

async function loadIntegrations({ quiet = false } = {}) {
  try {
    const res = await api("api/integrations");
    setIntegrations(res);
    return res;
  } catch (err) {
    setIntegrations({ agentstream: { connected: false, online: false } });
    if (!quiet) console.warn("integrations probe unavailable:", err.message);
    return null;
  }
}

async function loadAll() {
  const [paletteResult, graphResult] = await Promise.all([
    api("api/palette"),
    api("api/graph"),
  ]);
  setPalette(paletteResult.palette);
  setGraph(graphResult);
  await loadIntegrations({ quiet: true });
}

function exportGraph() {
  const blob = new Blob([JSON.stringify(getGraph(), null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "composer-lite-graph.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function buildCcaContext() {
  const graph = getGraph();
  const nodeId = getSelectedId();
  const edgeId = getSelectedEdgeId();
  const node = nodeId ? getNodeById(nodeId) : null;
  const edge = edgeId ? graph.edges.find((e) => e.id === edgeId) : null;
  const policyOpen = document.getElementById("lattice-stage-policy-panel")?.classList.contains("open");
  const policyStage = policyOpen
    ? document.querySelector(".stage-policy-stage-tab.active")?.textContent?.trim()
    : null;
  return {
    surface: "composer-lite",
    mode: getCanvasMode(),
    selectedNode: node
      ? { id: node.id, type: node.type, label: node.label, data: node.data, x: node.x, y: node.y }
      : null,
    selectedEdge: edge
      ? { id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, flow: edge.flow }
      : null,
    policyStage,
  };
}

const ccaPane = initCcaPane({
  getContext: buildCcaContext,
  async onSend(message, history, extras = {}) {
    const result = await api("api/cca/chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        graph: getGraph(),
        history,
        context: extras.context ?? buildCcaContext(),
        attachments: extras.attachments ?? [],
      }),
    });
    return result;
  },
  async onApplySuggestion(result) {
    if (result?.suggestion) mergeSuggestion(result.suggestion);
    if (result?.plan?.plan_version) {
      await api("api/cca/plan", {
        method: "PUT",
        body: JSON.stringify(result.plan),
      });
    }
  },
});

window.composerCcaPane = ccaPane;

$("#btn-export")?.addEventListener("click", exportGraph);

const minimap = initMinimap($("#canvas-minimap"), getCanvasApi(), { workspaceName: "Composer Lite" });
onViewportChange(() => minimap.scheduleDraw());

initCanvas();
bindTooltips(document);

const blockUrls = (document.documentElement.dataset.sidebarBlocks || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

initLiteInspector({
  getGraph,
  getSelectedId,
  getSelectedEdgeId,
  getNodeById,
  getPalette,
  updateNodeById,
  selectNode,
  blockUrls,
});
initLiteSettings();
stagePolicyPanel = window.initLitePolicyPanel?.({
  getGraph,
  updateNodeById,
  onFocusCca: (prompt) => ccaPane.focusComposer(prompt),
  onOpen: () => {
    inventory?.togglePanel(false);
    document.body.classList.add("policy-overlay-open");
  },
  onClose: () => {
    document.body.classList.remove("policy-overlay-open");
  },
}) ?? null;
setLatticeStageClickHandler((node, stageIndex) => {
  if (!node || node.type !== "lattice") return;
  selectNode(node.id);
  stagePolicyPanel?.open(node, stageIndex);
});
const canvasStage = $("#canvas-stage");
inventory = initNodeInventory({
  slotGrid: $("#quickslot-grid"),
  panel: $("#node-inventory"),
  toggleBtn: $("#inventory-toggle"),

  catalogList: $("#inventory-catalog"),
  searchInput: $("#inventory-search"),
  createForm: $("#inventory-create-form"),
  pickerPanel: $("#quickslot-picker"),
  pickerGrid: $("#quickslot-picker-grid"),
  pickerCloseBtn: $("#quickslot-picker-close"),
  pickerInventoryBtn: $("#quickslot-picker-inventory"),
  onDeploy: (payload, clientX, clientY) => deployPayload(payload, clientX, clientY),
  onArm: () => canvasStage?.classList.add("armed-place"),
  onDisarm: () => canvasStage?.classList.remove("armed-place"),
});
$("#inventory-close")?.addEventListener("click", () => inventory?.togglePanel(false));

loadAll()
  .then(() => {
    graphReady = true;
    editLog.setBaseline(getGraph());
    inventory.init(getPalette());
    setSyncStatus("synced");
    setInterval(() => {
      loadIntegrations({ quiet: true });
    }, 30000);
    canvasStage?.addEventListener("pointerup", (ev) => {
      const payload = inventory?.getArmedPayload();
      if (!payload) return;
      if (ev.target.closest(".port, .graph-node, .funnel-stage-band")) return;
      deployPayload(payload, ev.clientX, ev.clientY);
      inventory.disarm();
    });
  })
  .catch((err) => setSyncStatus(`load failed`));