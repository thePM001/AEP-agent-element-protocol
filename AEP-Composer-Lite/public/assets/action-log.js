/** Action log + canvas object finder (Composer Lite, blue chrome). */

const KIND_ICONS = {
  boot: "◆",
  place: "+",
  move: "↔",
  connect: "⟷",
  delete: "−",
  update: "✎",
  plan: "◈",
  undo: "↩",
  redo: "↪",
  edit: "•",
};

const MAX_UNDO = 50;

function cloneGraph(graph) {
  return JSON.parse(JSON.stringify(graph));
}

const OBJECT_CATEGORIES = [
  { id: "agents", label: "Agents", types: ["agent"] },
  { id: "lattice", label: "Lattice", types: ["lattice"] },
  { id: "docks", label: "Docks", types: ["dock_validation", "dock_inference"] },
  { id: "storage", label: "Storage", types: ["data_input", "data_output"] },
  { id: "integrations", label: "Integrations", types: ["connector"] },
  { id: "other", label: "Other", types: [] },
];

const TYPE_TO_CATEGORY = OBJECT_CATEGORIES.reduce((acc, cat) => {
  for (const type of cat.types) acc[type] = cat.id;
  return acc;
}, {});

const TYPE_LABELS = {
  agent: "Agent",
  lattice: "Action Lattice Hub",
  dock_validation: "AEP Validation Engine Dock",
  dock_inference: "Inference Dock",
  data_input: "Storage Import",
  data_output: "Storage Export",
  connector: "Connector",
};

export class EditLog {
  constructor() {
    this.entries = [{ label: "Canvas ready", kind: "boot", isCurrent: true }];
    this.undoStack = [];
    this.redoStack = [];
    this.baseline = null;
  }

  setBaseline(graph) {
    this.baseline = cloneGraph(graph);
    this.undoStack = [];
    this.redoStack = [];
  }

  _pushEntry(kind, label) {
    for (const entry of this.entries) entry.isCurrent = false;
    this.entries.push({ kind, label, isCurrent: true });
    if (this.entries.length > 120) this.entries.splice(1, this.entries.length - 100);
  }

  recordChange(kind, label, graphAfter) {
    if (!this.baseline) {
      this.baseline = cloneGraph(graphAfter);
      this._pushEntry(kind, label);
      return;
    }
    this.undoStack.push({
      kind,
      label,
      graph: cloneGraph(this.baseline),
    });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.baseline = cloneGraph(graphAfter);
    this._pushEntry(kind, label);
  }

  getTimeline() {
    return this.entries;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo(getGraph) {
    if (!this.canUndo()) return null;
    const current = cloneGraph(getGraph());
    const prev = this.undoStack.pop();
    this.redoStack.push({
      kind: prev.kind,
      label: prev.label,
      graph: current,
    });
    this.baseline = cloneGraph(prev.graph);
    this._pushEntry("undo", `Undid: ${prev.label}`);
    return prev.graph;
  }

  redo(getGraph) {
    if (!this.canRedo()) return null;
    const current = cloneGraph(getGraph());
    const next = this.redoStack.pop();
    this.undoStack.push({
      kind: next.kind,
      label: next.label,
      graph: current,
    });
    this.baseline = cloneGraph(next.graph);
    this._pushEntry("redo", `Redid: ${next.label}`);
    return next.graph;
  }
}

function typeLabel(type) {
  return TYPE_LABELS[type] || type;
}

function nodeLabel(node, palette) {
  const label = String(node?.label || "").trim();
  if (label) return label;
  const item = palette?.find((p) => p.type === node?.type);
  return item?.label || typeLabel(node?.type) || "Node";
}

function nodeTypeColor(node, palette) {
  const item = palette?.find((p) => p.type === node?.type);
  return item?.color || "#3de8ff";
}

export class ComposerActionLog {
  constructor(root, options = {}) {
    this.root = root;
    this.history = options.history;
    this.getNodes = options.getNodes || (() => []);
    this.getSelectedId = options.getSelectedId || (() => null);
    this.getPalette = options.getPalette || (() => []);
    this.onSelectNode = options.onSelectNode || (() => {});
    this.onUndo = options.onUndo || null;
    this.onRedo = options.onRedo || null;

    this.listEl = root.querySelector("#action-log-list");
    this.currentEl = root.querySelector("#action-log-current");
    this.countEl = root.querySelector("#action-log-count");
    this.panelEl = root.querySelector("#action-log-panel");
    this.titleEl = root.querySelector(".action-log-title");
    this.historyViewEl = root.querySelector("#action-log-view-history");
    this.objectsViewEl = root.querySelector("#action-log-view-objects");
    this.objectsListEl = root.querySelector("#action-log-objects-list");
    this.objectsFilterEl = root.querySelector("#action-log-objects-filter");
    this.objectsBtn = root.querySelector("#action-log-objects");
    this.undoBtn = root.querySelector("#action-log-undo");
    this.redoBtn = root.querySelector("#action-log-redo");
    this.toggleBtn = root.querySelector("#action-log-toggle");
    this.collapseBtn = root.querySelector("#action-log-collapse");

    this.expanded = true;
    this.activeTab = "history";
    this._objectsFilter = "";
    this._bind();
    this.render([]);
    this.renderObjects();
  }

  _bind() {
    this.objectsBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setTab(this.activeTab === "objects" ? "history" : "objects");
    });

    this.objectsFilterEl?.addEventListener("input", (e) => {
      this._objectsFilter = String(e.target.value || "").trim().toLowerCase();
      this.renderObjects();
    });

    this.objectsListEl?.addEventListener("click", (e) => {
      const item = e.target.closest("[data-node-id]");
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      this.onSelectNode(item.dataset.nodeId);
      this.renderObjects();
    });

    this.toggleBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.activeTab === "objects") {
        if (!this.expanded) this.setExpanded(true);
        return;
      }
      this.setExpanded(!this.expanded);
    });

    this.collapseBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.activeTab === "objects") {
        this.setTab("history");
        return;
      }
      this.setExpanded(false);
    });

    this.undoBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onUndo?.();
    });

    this.redoBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onRedo?.();
    });

    document.addEventListener("click", (e) => {
      if (!this.expanded || !this.root) return;
      if (this.activeTab === "objects") return;
      if (this.root.contains(e.target)) return;
      this.setExpanded(false);
    });
  }

  setTab(tab) {
    const next = tab === "objects" ? "objects" : "history";
    this.activeTab = next;
    this.root?.classList.toggle("action-log-tab-objects", next === "objects");
    this.root?.classList.toggle("action-log-tab-history", next === "history");
    if (this.historyViewEl) this.historyViewEl.hidden = next !== "history";
    if (this.objectsViewEl) this.objectsViewEl.hidden = next !== "objects";
    if (this.objectsBtn) {
      this.objectsBtn.classList.toggle("active", next === "objects");
      this.objectsBtn.setAttribute("aria-pressed", next === "objects" ? "true" : "false");
    }
    if (this.titleEl) {
      this.titleEl.textContent = next === "objects" ? "Canvas Objects" : "Action Log";
    }
    if (next === "objects") {
      this.setExpanded(true);
      this.renderObjects();
    } else {
      this.render(this.history?.getTimeline?.() || []);
    }
  }

  setExpanded(open) {
    if (this.activeTab === "objects" && !open) open = true;
    this.expanded = !!open;
    this.root?.classList.toggle("action-log-expanded", this.expanded);
    this.root?.classList.toggle("action-log-collapsed", !this.expanded);
    if (this.panelEl) this.panelEl.hidden = !this.expanded;
    if (this.toggleBtn) this.toggleBtn.setAttribute("aria-expanded", this.expanded ? "true" : "false");
    if (this.expanded && this.activeTab === "objects") this.renderObjects();
  }

  _syncSummary(visibleCount = null) {
    if (this.activeTab !== "history") {
      const nodes = this.getNodes() || [];
      const count = Number.isFinite(visibleCount) ? visibleCount : nodes.length;
      if (this.currentEl) this.currentEl.textContent = "Total Elements:";
      if (this.countEl) this.countEl.textContent = String(count);
      return;
    }
    const entries = this.history?.getTimeline?.() || [];
    const current = entries.find((entry) => entry.isCurrent) || entries[entries.length - 1];
    if (this.currentEl) this.currentEl.textContent = current?.label || "No edits yet";
    if (this.countEl) this.countEl.textContent = String(Math.max(0, entries.length - 1));
  }

  _matchesFilter(node, categoryLabel) {
    if (!this._objectsFilter) return true;
    const palette = this.getPalette();
    const hay = [
      nodeLabel(node, palette),
      typeLabel(node.type),
      node.id,
      categoryLabel,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(this._objectsFilter);
  }

  _appendObjectSection(category, groupNodes, selectedId) {
    const palette = this.getPalette();
    const section = document.createElement("section");
    section.className = "action-log-objects-category";
    section.dataset.categoryId = category.id;

    const head = document.createElement("header");
    head.className = "action-log-objects-category-head";
    head.innerHTML = `<span class="action-log-objects-category-label">${category.label}</span><span class="action-log-objects-category-count">${groupNodes.length}</span>`;
    section.appendChild(head);

    const list = document.createElement("div");
    list.className = "action-log-objects-items";

    for (const node of groupNodes) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "action-log-object-item";
      if (node.id === selectedId) btn.classList.add("is-selected");
      btn.dataset.nodeId = node.id;
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", node.id === selectedId ? "true" : "false");

      const typeColor = nodeTypeColor(node, palette);
      const swatch = document.createElement("span");
      swatch.className = "action-log-object-swatch";
      swatch.style.setProperty("--object-type-color", typeColor);

      const copy = document.createElement("div");
      copy.className = "action-log-object-copy";

      const name = document.createElement("span");
      name.className = "action-log-object-name";
      name.textContent = nodeLabel(node, palette);

      const meta = document.createElement("span");
      meta.className = "action-log-object-meta";
      meta.innerHTML = `<span class="action-log-object-type" style="--object-type-color:${typeColor}">${typeLabel(node.type)}</span><span class="action-log-object-id"> · ${node.id}</span>`;

      copy.appendChild(name);
      copy.appendChild(meta);
      btn.appendChild(swatch);
      btn.appendChild(copy);
      list.appendChild(btn);
    }

    section.appendChild(list);
    this.objectsListEl.appendChild(section);
    return groupNodes.length;
  }

  renderObjects() {
    if (!this.objectsListEl) return;
    const nodes = Array.isArray(this.getNodes()) ? this.getNodes() : [];
    const selectedId = this.getSelectedId();
    this.objectsListEl.replaceChildren();

    if (!nodes.length) {
      const empty = document.createElement("p");
      empty.className = "action-log-empty";
      empty.textContent = "No elements on the canvas yet.";
      this.objectsListEl.appendChild(empty);
      this._syncSummary(0);
      return;
    }

    let visibleCount = 0;
    for (const category of OBJECT_CATEGORIES) {
      if (category.id === "other") continue;
      const groupNodes = nodes
        .filter((node) => TYPE_TO_CATEGORY[node.type] === category.id)
        .filter((node) => this._matchesFilter(node, category.label))
        .sort((a, b) => nodeLabel(a, this.getPalette()).localeCompare(nodeLabel(b, this.getPalette())) || a.id.localeCompare(b.id));
      if (!groupNodes.length) continue;
      visibleCount += this._appendObjectSection(category, groupNodes, selectedId);
    }

    const otherCategory = OBJECT_CATEGORIES.find((cat) => cat.id === "other");
    const otherNodes = nodes
      .filter((node) => !TYPE_TO_CATEGORY[node.type])
      .filter((node) => this._matchesFilter(node, otherCategory?.label || "Other"))
      .sort((a, b) => nodeLabel(a, this.getPalette()).localeCompare(nodeLabel(b, this.getPalette())) || a.id.localeCompare(b.id));
    if (otherNodes.length && otherCategory) {
      visibleCount += this._appendObjectSection(otherCategory, otherNodes, selectedId);
    }

    if (!visibleCount) {
      const empty = document.createElement("p");
      empty.className = "action-log-empty";
      empty.textContent = this._objectsFilter ? "No elements match this filter." : "No categorized elements on the canvas yet.";
      this.objectsListEl.appendChild(empty);
    }

    this._syncSummary(visibleCount);
  }

  render(timeline = []) {
    if (this.undoBtn) this.undoBtn.disabled = !this.history?.canUndo?.();
    if (this.redoBtn) this.redoBtn.disabled = !this.history?.canRedo?.();

    if (this.activeTab === "objects") {
      this.renderObjects();
      return;
    }

    const entries = Array.isArray(timeline) ? timeline : [];
    const current = entries.find((entry) => entry.isCurrent) || entries[entries.length - 1];
    if (this.currentEl) this.currentEl.textContent = current?.label || "No edits yet";
    if (this.countEl) this.countEl.textContent = String(Math.max(0, entries.length - 1));

    if (!this.listEl) return;
    this.listEl.replaceChildren();

    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "action-log-empty";
      empty.textContent = "Canvas edits will appear here.";
      this.listEl.appendChild(empty);
      return;
    }

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      const li = document.createElement("li");
      li.className = "action-log-item";
      if (entry.isCurrent) li.classList.add("is-current");
      const icon = KIND_ICONS[entry.kind] || "•";
      li.innerHTML = `<span class="action-log-item-icon" aria-hidden="true">${icon}</span><span class="action-log-item-label">${entry.label}</span>`;
      this.listEl.appendChild(li);
    }
  }

  notifyGraphChange() {
    if (this.activeTab === "objects") this.renderObjects();
    else this.render(this.history?.getTimeline?.() || []);
  }
}

export function initActionLog(root, options) {
  return new ComposerActionLog(root, options);
}