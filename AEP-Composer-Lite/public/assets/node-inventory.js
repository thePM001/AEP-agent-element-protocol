import { initNeoSelect } from "./neo-select.js";

const STORAGE_CATALOG = "composer-lite-node-catalog";
const EXCLUDED_NODE_TYPES = new Set(["wasm_policy"]);
const STORAGE_SLOTS = "composer-lite-quick-slots";
const SLOT_COUNT = 9;
const MIME = "application/x-composer-lite-catalog-id";

const KIND_ORDER = ["component", "regulation", "ucb", "connector", "daemon", "protocol", "bridge", "compliance", "wasm", "tooling", "template", "other"];
const KIND_LABELS = {
  component: "Components",
  regulation: "Regulation",
  ucb: "UCB",
  connector: "Connectors",
  daemon: "Daemons",
  protocol: "Protocols",
  bridge: "Bridges",
  compliance: "Compliance",
  wasm: "WASM",
  tooling: "Tooling",
  template: "Templates",
  other: "Other",
};

const SHAPES_BY_BASE = {
  agent: ["hex", "circle", "square"],
  lattice: ["funnel", "hex", "square"],
  policy: ["square", "circle", "hex"],
  gap: ["triangle", "square", "hex"],
  connector: ["diamond", "circle", "hex"],
  ucb: ["diamond", "circle", "hex"],
  engine: ["square", "hex", "circle"],
  dock_validation: ["square", "hex", "circle"],
  dock_inference: ["square", "hex", "circle"],
  dock_regulation: ["square", "hex", "circle"],
  data_input: ["rect"],
  data_output: ["rect"],
  component: ["card", "square", "hex"],
  regulation: ["square", "triangle", "hex"],
};

const DEFAULT_SLOT_TYPES = [
  "agent",
  "lattice",
  "dock_validation",
  "regulation",
  "connector",
  "ucb",
  "data_input",
  "data_output",
];

const LatticeShapePicker = {
  shapesForBase(baseType) {
    return SHAPES_BY_BASE[baseType] || ["card", "circle"];
  },

  previewSvg(shape, color = "#3de8ff") {
    const fill = color;
    const stroke = "rgba(216, 236, 255, 0.92)";
    switch (shape) {
      case "funnel":
        return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14L11 16H7Z" fill="${fill}" stroke="${stroke}" stroke-width="1"/></svg>`;
      case "rect":
      case "card":
        return `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="6" width="14" height="8" rx="1.5" fill="${fill}" stroke="${stroke}" stroke-width="1"/></svg>`;
      case "square":
        return `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="1.5" fill="${fill}" stroke="${stroke}" stroke-width="1"/></svg>`;
      case "diamond":
        return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3l7 7-7 7-7-7z" fill="${fill}" stroke="${stroke}" stroke-width="1"/></svg>`;
      case "triangle":
        return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4l8 13H2Z" fill="${fill}" stroke="${stroke}" stroke-width="1"/></svg>`;
      case "hex":
        return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3l6.5 4v6L10 17l-6.5-4V7Z" fill="${fill}" stroke="${stroke}" stroke-width="1"/></svg>`;
      default:
        return `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="${fill}" stroke="${stroke}" stroke-width="1"/></svg>`;
    }
  },

  render(container, options = {}) {
    if (!container) return "";
    const { baseType, value, color = "#3de8ff", onChange = null, compact = false } = options;
    const shapes = this.shapesForBase(baseType);
    const current = value && shapes.includes(value) ? value : shapes[0];
    container.innerHTML = shapes
      .map((shape) => {
        const active = shape === current;
        return `<button type="button" class="shape-picker-btn${active ? " active" : ""}${compact ? " compact" : ""}" data-shape="${shape}" aria-label="${shape}" aria-pressed="${active ? "true" : "false"}" title="${shape.toUpperCase()}">${this.previewSvg(shape, color)}</button>`;
      })
      .join("");
    container.querySelectorAll(".shape-picker-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const shape = btn.dataset.shape;
        container.querySelectorAll(".shape-picker-btn").forEach((el) => {
          el.classList.toggle("active", el === btn);
          el.setAttribute("aria-pressed", el === btn ? "true" : "false");
        });
        onChange?.(shape);
      });
    });
    return current;
  },
};

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked */
  }
}

function uid() {
  return `preset-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultShapeForType(type) {
  if (type === "lattice") return "funnel";
  if (type === "connector" || type === "ucb") return "diamond";
  if (type === "data_input" || type === "data_output") return "rect";
  return "card";
}

function paletteEntryId(item) {
  return String(item?.catalog_id || item?.registry_id || `builtin-${item?.type || "component"}`).trim();
}

function isExcludedPaletteItem(item) {
  const type = String(item?.type || item?.baseType || "").trim();
  return EXCLUDED_NODE_TYPES.has(type);
}

function mountNeoSelect(container, name, options, { onChange } = {}) {
  if (!container || !options.length) return null;
  const esc = (s) => String(s ?? "").replace(/"/g, "&quot;");
  const initial = options[0];
  container.innerHTML = `
    <div class="neo-select" data-neo-select>
      <input type="hidden" name="${esc(name)}" value="${esc(initial.value)}">
      <button type="button" class="neo-select-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="neo-select-value">${esc(initial.label)}</span>
        <span class="neo-select-chevron" aria-hidden="true"></span>
      </button>
      <div class="neo-select-menu" role="listbox">
        ${options.map((o, i) => `<button type="button" role="option" data-value="${esc(o.value)}" aria-selected="${i === 0 ? "true" : "false"}" class="neo-select-option${i === 0 ? " selected" : ""}"><span class="neo-select-option-label">${esc(o.label)}</span></button>`).join("")}
      </div>
    </div>`;
  const root = container.querySelector(".neo-select");
  const api = initNeoSelect(root);
  const hidden = root?.querySelector('input[type="hidden"]');
  if (onChange && hidden) hidden.addEventListener("change", onChange);
  return api;
}

function paletteToCatalogEntry(item) {
  const type = String(item?.type || "component").trim();
  const id = paletteEntryId(item);
  return {
    id,
    builtin: true,
    baseType: type,
    type,
    name: item.label || id,
    short: item.short || String(item.label || id).slice(0, 2).toUpperCase(),
    color: item.color || "#3de8ff",
    shape: item.shape || defaultShapeForType(type),
    aep_id: item.aep_id,
    registry_id: item.registry_id,
    catalog_id: item.catalog_id || id,
    kind: item.kind || type,
    engine_kind: item.engine_kind,
    storage_backend: item.storage_backend,
    description: item.description,
    source: item.source,
  };
}

function matchesSearch(entry, query) {
  if (!query) return true;
  const haystack = [
    entry.name,
    entry.baseType,
    entry.type,
    entry.registry_id,
    entry.catalog_id,
    entry.kind,
    entry.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function normalizeKind(kind) {
  const value = String(kind || "component").trim().toLowerCase();
  return KIND_LABELS[value] ? value : "other";
}

class LiteInventory {
  constructor(options = {}) {
    this.slotGrid = options.slotGrid;
    this.panel = options.panel;
    this.toggleBtn = options.toggleBtn;
    this.catalogList = options.catalogList;
    this.searchInput = options.searchInput;
    this.createForm = options.createForm;
    this.pickerPanel = options.pickerPanel;
    this.pickerGrid = options.pickerGrid;
    this.pickerCloseBtn = options.pickerCloseBtn;
    this.pickerInventoryBtn = options.pickerInventoryBtn;
    this.onDeploy = options.onDeploy || (() => {});
    this.onArm = options.onArm || (() => {});
    this.onDisarm = options.onDisarm || (() => {});
    this.palette = [];
    this.catalog = [];
    this.slots = [];
    this.open = false;
    this.assignMode = null;
    this.armedCatalogId = null;
    this.armedPayload = null;
    this.pickerSlotIndex = null;
    this.editingPresetId = null;
    this.searchQuery = "";
    this._syncCreateForm = null;
    this._builtinShapeOverrides = {};
    this._bound = false;
  }

  init(palette = []) {
    this.setPalette(palette);
    if (!this._bound) {
      this._bindToggle();
      this._bindCreateForm();
      this._bindQuickPicker();
      this._bindGlobalDismiss();
      this._bindHotkeys();
      this._bindCanvasDrop();
      this._bound = true;
    }
    this._loadSlots();
    this._renderSlots();
    this._renderCatalog();
  }

  setPalette(palette = []) {
    this.palette = (Array.isArray(palette) ? palette : []).filter((item) => !isExcludedPaletteItem(item));
    this._rebuildCatalog();
    this._populateBaseTypes();
    if (this.open) this._renderCatalog();
  }

  _rebuildCatalog() {
    const custom = loadJson(STORAGE_CATALOG, []);
    const builtins = this.palette.map((item) => paletteToCatalogEntry(item));
    const byId = new Map();
    for (const item of builtins) byId.set(item.id, item);
    for (const item of custom) {
      if (!item?.id || item.builtin) continue;
      byId.set(item.id, { ...item, builtin: false });
    }
    this.catalog = [...byId.values()]
      .filter((entry) => !EXCLUDED_NODE_TYPES.has(entry.baseType) && !EXCLUDED_NODE_TYPES.has(entry.type))
      .sort((a, b) => {
      if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
    for (const preset of this.catalog.filter((c) => !c.builtin)) {
      /* presets stay client-side */
    }
  }

  _defaultSlotIds() {
    const ids = [];
    for (const type of DEFAULT_SLOT_TYPES) {
      const match =
        this.catalog.find((c) => c.baseType === type && c.builtin)
        || this.catalog.find((c) => c.baseType === type);
      if (match) ids.push(match.id);
    }
    while (ids.length < SLOT_COUNT) ids.push(null);
    return ids.slice(0, SLOT_COUNT);
  }

  _loadSlots() {
    const defaults = this._defaultSlotIds();
    const saved = loadJson(STORAGE_SLOTS, null);
    this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => {
      const id = saved?.[i] ?? defaults[i] ?? null;
      return id && this.getEntry(id) ? id : defaults[i] && this.getEntry(defaults[i]) ? defaults[i] : null;
    });
    this._persistSlots();
  }

  _persistCatalog() {
    saveJson(STORAGE_CATALOG, this.catalog.filter((c) => !c.builtin));
  }

  _persistSlots() {
    saveJson(STORAGE_SLOTS, this.slots);
  }

  getEntry(id) {
    return this.catalog.find((c) => c.id === id) || null;
  }

  catalogShape(entry) {
    if (!entry) return "card";
    if (!entry.builtin) return entry.shape || "card";
    return this._builtinShapeOverrides[entry.id] || entry.shape || defaultShapeForType(entry.baseType);
  }

  setCatalogShape(entryId, shape, entry) {
    if (!entryId || !entry) return;
    if (entry.builtin) {
      this._builtinShapeOverrides[entryId] = shape;
      this._renderCatalog();
      if (this.armedCatalogId === entryId) this.arm(entryId);
      return;
    }
    const next = this.updatePreset(entryId, { shape });
    if (next && this.armedCatalogId === entryId) this.arm(entryId);
  }

  toDeployPayload(entry) {
    if (!entry) return null;
    const type = entry.baseType || entry.type;
    const shape = this.catalogShape(entry);
    const data = {
      catalog_id: entry.catalog_id || entry.id,
      visual: { color: entry.color, shape },
    };
    if (entry.registry_id) data.registry_id = entry.registry_id;
    if (entry.aep_id) data.aep_id = entry.aep_id;
    if (entry.kind) data.kind = entry.kind;

    if (type === "component" || entry.registry_id) {
      data.component = {
        registry_id: entry.registry_id || entry.catalog_id || entry.id,
        catalog_id: entry.catalog_id || entry.id,
        version: "0.0.0",
      };
    }
    if (type === "regulation" || type === "dock_regulation") {
      data.regulation = {
        mode: "warn",
        policy_id: entry.registry_id || entry.catalog_id || "aep.regulation",
        policy_version: "1.0.0",
        scope: "stage",
      };
    }
    if (type === "ucb") {
      data.ucb = {
        bridge_id: entry.registry_id || "aep.ucb",
        mode: "attach",
      };
    }
    if (type === "connector") {
      data.integration_hub = "composer-lite";
      data.hub_binding = "optional";
      data.integration_kind = "application";
    }
    if (type === "data_input" || type === "data_output") {
      data.storage_backend = entry.storage_backend || "local";
      data.storage_role = type === "data_input" ? "input" : "output";
    }
    if (entry.engine_kind) data.engine_kind = entry.engine_kind;

    return {
      type,
      label: type === "lattice" ? "" : entry.name,
      data,
    };
  }

  _resolveShapeForBase(baseType, shape) {
    const allowed = LatticeShapePicker.shapesForBase(baseType);
    const pick = String(shape || "").trim();
    if (pick && allowed.includes(pick)) return pick;
    return allowed[0] || "card";
  }

  createPreset({ name, baseType, color, shape, engineKind, storageBackend, id }) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const entry = {
      id: id || uid(),
      builtin: false,
      baseType,
      type: baseType,
      name: trimmed,
      short: trimmed.slice(0, 2).toUpperCase(),
      color: color || "#3de8ff",
      shape: this._resolveShapeForBase(baseType, shape),
    };
    if (baseType === "engine" && engineKind) entry.engine_kind = engineKind;
    if (baseType === "data_input" || baseType === "data_output") {
      entry.storage_backend = storageBackend || "local";
    }
    const existing = this.catalog.findIndex((c) => c.id === entry.id);
    if (existing >= 0) this.catalog[existing] = entry;
    else this.catalog.push(entry);
    this._persistCatalog();
    this._renderCatalog();
    return entry;
  }

  updatePreset(id, updates) {
    const entry = this.getEntry(id);
    if (!entry || entry.builtin) return null;
    const next = { ...entry };
    if (updates.name) {
      next.name = String(updates.name).trim();
      next.short = next.name.slice(0, 2).toUpperCase();
    }
    if (updates.baseType) {
      next.baseType = updates.baseType;
      next.type = updates.baseType;
    }
    if (updates.color) next.color = updates.color;
    if (updates.shape) next.shape = this._resolveShapeForBase(next.baseType, updates.shape);
    if (updates.baseType && !updates.shape) {
      next.shape = this._resolveShapeForBase(next.baseType, next.shape);
    }
    if (updates.engineKind) next.engine_kind = updates.engineKind;
    if (updates.storageBackend) next.storage_backend = updates.storageBackend;
    const idx = this.catalog.findIndex((c) => c.id === id);
    if (idx >= 0) this.catalog[idx] = next;
    this._persistCatalog();
    this._renderCatalog();
    this._renderSlots();
    return next;
  }

  deletePreset(id) {
    const entry = this.getEntry(id);
    if (!entry || entry.builtin) return;
    this.catalog = this.catalog.filter((c) => c.id !== id);
    this.slots = this.slots.map((slotId) => (slotId === id ? null : slotId));
    if (this.armedCatalogId === id) this.disarm();
    this._persistCatalog();
    this._persistSlots();
    this._renderSlots();
    this._renderCatalog();
  }

  assignSlot(index, catalogId) {
    if (index < 0 || index >= SLOT_COUNT) return;
    if (catalogId && !this.getEntry(catalogId)) return;
    this.slots[index] = catalogId;
    this._persistSlots();
    this._renderSlots();
    this.assignMode = null;
    this.panel?.classList.remove("assign-mode");
  }

  arm(catalogId) {
    const entry = this.getEntry(catalogId);
    if (!entry) return;
    this.armedCatalogId = catalogId;
    this.armedPayload = this.toDeployPayload(entry);
    this.assignMode = null;
    this.panel?.classList.remove("assign-mode");
    this.onArm(this.armedPayload);
    this._renderSlots();
    this._renderCatalog();
  }

  disarm() {
    this.armedCatalogId = null;
    this.armedPayload = null;
    this.onDisarm();
    this._renderSlots();
    this._renderCatalog();
  }

  getArmedPayload() {
    return this.armedPayload;
  }

  beginAssign(catalogId) {
    if (!this.getEntry(catalogId)) return;
    this.assignMode = catalogId;
    this.disarm();
    this.panel?.classList.add("assign-mode");
    this._renderCatalog();
  }

  togglePanel(force) {
    this.open = typeof force === "boolean" ? force : !this.open;
    if (this.panel) {
      this.panel.classList.toggle("open", this.open);
      if (this.open) {
        this.panel.hidden = false;
        this.panel.removeAttribute("hidden");
        this._renderCatalog();
        this.searchInput?.focus();
      } else {
        this.panel.classList.remove("open");
        this.panel.hidden = true;
        this.panel.setAttribute("hidden", "");
      }
    }
    this.toggleBtn?.setAttribute("aria-expanded", this.open ? "true" : "false");
    this.toggleBtn?.classList.toggle("active", this.open);
    if (this.open) this._syncCreateForm?.();
    if (!this.open) {
      this.assignMode = null;
      this.panel?.classList.remove("assign-mode");
      this._clearCreateFormEdit();
    }
  }

  openQuickPicker(slotIndex) {
    if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return;
    this.pickerSlotIndex = slotIndex;
    if (this.pickerPanel) {
      this.pickerPanel.hidden = false;
      this.pickerPanel.classList.add("open");
    }
    const title = this.pickerPanel?.querySelector("#quickslot-picker-title");
    if (title) title.textContent = `Assign Quick Slot ${slotIndex + 1}`;
    this._renderQuickPicker();
  }

  closeQuickPicker(clearSlot = true) {
    if (clearSlot) this.pickerSlotIndex = null;
    if (this.pickerPanel) {
      this.pickerPanel.hidden = true;
      this.pickerPanel.classList.remove("open");
    }
  }

  _prefillCreateForm(entry, { edit = false } = {}) {
    const form = this.createForm;
    if (!form || !entry) return;
    this.togglePanel(true);
    const nameInput = form.querySelector('[name="name"]');
    const colorInput = form.querySelector('[name="color"]');
    const submitBtn = document.getElementById("inventory-create-submit");
    if (edit) {
      this.editingPresetId = entry.id;
      if (nameInput) nameInput.value = entry.name || "";
      if (submitBtn) submitBtn.textContent = "UPDATE PRESET";
    } else {
      this._clearCreateFormEdit();
      if (nameInput) {
        nameInput.value = "";
        nameInput.placeholder = `${entry.name} variant`;
      }
      if (submitBtn) submitBtn.textContent = "CREATE PRESET";
    }
    this._baseTypeSelect?.setValue?.(entry.baseType);
    if (colorInput) colorInput.value = entry.color || "#3de8ff";
    if (entry.storage_backend) this._storageBackendSelect?.setValue?.(entry.storage_backend);
    this._syncCreateForm?.(entry.shape);
    nameInput?.focus();
  }

  _clearCreateFormEdit() {
    this.editingPresetId = null;
    const submitBtn = document.getElementById("inventory-create-submit");
    if (submitBtn) submitBtn.textContent = "CREATE PRESET";
  }

  _setPanelOpenState() {
    this.togglePanel(this.open);
  }

  _bindToggle() {
    this.toggleBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePanel();
    });
    this.searchInput?.addEventListener("input", (e) => {
      this.searchQuery = String(e.target?.value || "");
      this._renderCatalog();
    });
  }

  _bindGlobalDismiss() {
    document.addEventListener("click", (e) => {
      const pickerOpen = this.pickerPanel && !this.pickerPanel.hidden;
      if (pickerOpen) {
        const inPicker = this.pickerPanel?.contains(e.target);
        const onEmptySlot = e.target.closest?.(".quickslot.empty");
        if (!inPicker && !onEmptySlot) this.closeQuickPicker();
      }
      if (!this.open) return;
      const inPanel = this.panel?.contains(e.target);
      const onToggle = this.toggleBtn?.contains(e.target);
      if (!inPanel && !onToggle) this.togglePanel(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.pickerPanel && !this.pickerPanel.hidden) {
          this.closeQuickPicker();
          return;
        }
        if (this.assignMode) {
          this.assignMode = null;
          this.panel?.classList.remove("assign-mode");
          this._renderCatalog();
          return;
        }
        if (this.armedCatalogId) {
          this.disarm();
          return;
        }
        if (this.open) this.togglePanel(false);
      }
    });
  }

  _bindQuickPicker() {
    this.pickerCloseBtn?.addEventListener("click", () => this.closeQuickPicker());
    this.pickerInventoryBtn?.addEventListener("click", () => {
      this.closeQuickPicker();
      this.togglePanel(true);
    });
  }

  _pickerItemHtml(entry) {
    return `<button type="button" class="quickslot-picker-item" data-catalog-id="${entry.id}" draggable="true" data-lite-tip="${entry.name}" aria-label="${entry.name}" style="--slot-color:${entry.color}">
      <span class="quickslot-picker-core" style="background:${entry.color}"></span>
      <span class="quickslot-picker-glyph">${entry.short || entry.name.slice(0, 2)}</span>
      <span class="quickslot-picker-name">${entry.name}</span>
      <span class="quickslot-picker-meta">${entry.baseType.toUpperCase()} · ${this.catalogShape(entry)}</span>
    </button>`;
  }

  _renderQuickPicker() {
    if (!this.pickerGrid) return;
    this.pickerGrid.innerHTML = this.catalog.map((e) => this._pickerItemHtml(e)).join("");
    this.pickerGrid.querySelectorAll(".quickslot-picker-item").forEach((btn) => {
      const id = btn.dataset.catalogId;
      btn.addEventListener("click", () => {
        if (this.pickerSlotIndex == null) return;
        this.assignSlot(this.pickerSlotIndex, id);
        this.closeQuickPicker();
      });
      btn.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(MIME, id);
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "copy";
      });
    });
  }

  _baseTypeOptions() {
    const seen = new Set();
    const options = [];
    for (const item of this.catalog.filter((c) => c.builtin)) {
      if (seen.has(item.baseType)) continue;
      seen.add(item.baseType);
      options.push({ value: item.baseType, label: item.name });
    }
    return options;
  }

  _populateBaseTypes() {
    const container = document.getElementById("inventory-base-type-select");
    const options = this._baseTypeOptions();
    if (!container || !options.length) return;
    const current = this.createForm?.querySelector('[name="baseType"]')?.value || options[0].value;
    const ordered = [...options].sort((a, b) => (a.value === current ? -1 : b.value === current ? 1 : 0));
    this._baseTypeSelect = mountNeoSelect(container, "baseType", ordered, {
      onChange: () => this._syncCreateForm?.(),
    });
    if (current) this._baseTypeSelect?.setValue?.(current);
  }

  _bindCreateForm() {
    const form = this.createForm;
    if (!form) return;
    const shapePicker = document.getElementById("inventory-shape-picker");
    const shapeInput = form.querySelector('[name="shape"]');
    const colorInput = form.querySelector('[name="color"]');
    const storageField = document.getElementById("inventory-storage-backend-field");
    const storageContainer = document.getElementById("inventory-storage-backend-select");
    this._storageBackendSelect = mountNeoSelect(
      storageContainer,
      "storageBackend",
      [
        { value: "local", label: "Local Buffer" },
        { value: "hcs", label: "HCS" },
        { value: "surrealdb", label: "Surreal DB" },
        { value: "google_drive", label: "Google Drive" },
      ],
    );
    const syncShapes = (preferredShape = null) => {
      const base = form.querySelector('[name="baseType"]')?.value || "lattice";
      if (storageField) storageField.hidden = base !== "data_input" && base !== "data_output";
      if (!shapePicker) return;
      const color = colorInput?.value || "#3de8ff";
      const current = LatticeShapePicker.render(shapePicker, {
        baseType: base,
        value: preferredShape || shapeInput?.value,
        color,
        onChange: (shape) => {
          if (shapeInput) shapeInput.value = shape;
        },
      });
      if (shapeInput) shapeInput.value = current;
    };
    this._syncCreateForm = syncShapes;
    this._populateBaseTypes();
    colorInput?.addEventListener("input", () => syncShapes(shapeInput?.value));
    syncShapes();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        name: fd.get("name"),
        baseType: fd.get("baseType"),
        color: fd.get("color"),
        shape: fd.get("shape"),
        storageBackend: fd.get("storageBackend"),
      };
      let entry = null;
      if (this.editingPresetId) entry = this.updatePreset(this.editingPresetId, payload);
      else entry = this.createPreset(payload);
      if (entry) {
        this._clearCreateFormEdit();
        form.reset();
        syncShapes();
        const colorField = form.querySelector('[name="color"]');
        if (colorField) colorField.value = "#3de8ff";
      }
    });
  }

  _slotHtml(index, catalogId) {
    const entry = catalogId ? this.getEntry(catalogId) : null;
    const armed = this.armedCatalogId && catalogId === this.armedCatalogId;
    const key = index + 1;
    const label = entry ? `[${entry.name}]` : "[empty]";
    if (!entry) {
      return `<button type="button" class="quickslot empty" data-slot="${index}" data-lite-tip="EMPTY SLOT ${key}" aria-label="Empty quick slot ${key}">
        <span class="quickslot-disc" aria-hidden="true"></span>
        <span class="quickslot-label">${label}</span>
      </button>`;
    }
    return `<button type="button" class="quickslot${armed ? " armed" : ""}" data-slot="${index}" data-catalog-id="${entry.id}" draggable="true" data-lite-tip="${entry.name}" aria-label="${entry.name} quick slot ${key}" style="--slot-color:${entry.color}">
      <span class="quickslot-disc" aria-hidden="true">
        <span class="quickslot-core" style="background:${entry.color}"></span>
        <span class="quickslot-glyph">${entry.short || entry.name.slice(0, 2)}</span>
        <span class="quickslot-key">${key}</span>
      </span>
      <span class="quickslot-label">${label}</span>
    </button>`;
  }

  _renderSlots() {
    if (!this.slotGrid) return;
    this.slotGrid.innerHTML = this.slots.map((id, i) => this._slotHtml(i, id)).join("");
    this.slotGrid.querySelectorAll(".quickslot").forEach((btn) => {
      const slot = Number(btn.dataset.slot);
      const catalogId = btn.dataset.catalogId || null;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.assignMode) {
          this.assignSlot(slot, this.assignMode);
          return;
        }
        if (!catalogId) {
          this.openQuickPicker(slot);
          return;
        }
        if (this.armedCatalogId === catalogId) this.disarm();
        else this.arm(catalogId);
      });
      btn.addEventListener("dragstart", (e) => {
        if (!catalogId) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(MIME, catalogId);
        e.dataTransfer.setData("text/plain", catalogId);
        e.dataTransfer.effectAllowed = "copyMove";
      });
      btn.addEventListener("dragover", (e) => {
        e.preventDefault();
        btn.classList.add("drop-target");
      });
      btn.addEventListener("dragleave", () => btn.classList.remove("drop-target"));
      btn.addEventListener("drop", (e) => {
        e.preventDefault();
        btn.classList.remove("drop-target");
        const dropped = e.dataTransfer.getData(MIME) || e.dataTransfer.getData("text/plain");
        if (dropped) this.assignSlot(slot, dropped);
      });
    });
  }

  _catalogCard(entry) {
    const isBuiltin = !!entry.builtin;
    const shape = this.catalogShape(entry);
    const registry = entry.registry_id || entry.catalog_id || entry.id;
    const shapeControl = `<div class="inventory-shape-field">
      <span class="inventory-shape-label">Shape</span>
      <div class="shape-picker shape-picker-catalog" data-shape-picker data-base-type="${entry.baseType}" data-shape-value="${shape}" data-shape-color="${entry.color}"></div>
    </div>`;
    return `<article class="inventory-card" data-catalog-id="${entry.id}" draggable="true">
      <div class="inventory-card-icon" style="--slot-color:${entry.color}">
        <span class="inventory-card-core" style="background:${entry.color}"></span>
        <span class="inventory-card-glyph">${entry.short || entry.name.slice(0, 2)}</span>
      </div>
      <div class="inventory-card-body">
        <div class="inventory-card-name">${entry.name}</div>
        <div class="inventory-card-meta">${entry.baseType.toUpperCase()} · ${registry}</div>
        ${shapeControl}
        <div class="inventory-card-actions">
          <button type="button" class="inventory-action" data-action="slot">TO SLOT</button>
          <button type="button" class="inventory-action" data-action="arm">TO CANVAS</button>
          ${isBuiltin ? '<button type="button" class="inventory-action" data-action="customize">SAVE AS PRESET</button>' : '<button type="button" class="inventory-action" data-action="edit">EDIT</button><button type="button" class="inventory-action danger" data-action="delete">DELETE</button>'}
        </div>
      </div>
    </article>`;
  }

  _renderCatalog() {
    if (!this.catalogList) return;
    const query = this.searchQuery.trim().toLowerCase();
    const filtered = this.catalog.filter((entry) => matchesSearch(entry, query));
    const groups = new Map();
    for (const entry of filtered) {
      const kind = normalizeKind(entry.kind || entry.baseType);
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(entry);
    }

    let html = "";
    let rendered = 0;
    for (const kind of KIND_ORDER) {
      const items = groups.get(kind);
      if (!items?.length) continue;
      html += `<div class="inventory-catalog-section"><h4 class="inventory-section-title">${KIND_LABELS[kind] || kind}</h4><div class="inventory-catalog-grid">`;
      html += items.map((e) => this._catalogCard(e)).join("");
      html += "</div></div>";
      rendered += items.length;
    }

    if (!rendered) {
      html = `<div class="inventory-empty">${query ? "No nodes match your search." : "Registry palette is empty."}</div>`;
    }

    this.catalogList.innerHTML = html;

    const hint = this.panel?.querySelector(".inventory-assign-hint");
    if (hint) {
      hint.textContent = this.assignMode
        ? "Click a quick slot below to assign this node type."
        : "AEP 2.8 catalog · drag to canvas, assign quick slots, or forge presets.";
    }

    this.catalogList.querySelectorAll(".inventory-card").forEach((card) => {
      const id = card.dataset.catalogId;
      const entry = this.getEntry(id);
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(MIME, id);
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "copy";
      });
      card.querySelectorAll(".inventory-action").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === "slot") this.beginAssign(id);
          if (action === "arm") this.arm(id);
          if (action === "delete") this.deletePreset(id);
          if (action === "customize" && entry) this._prefillCreateForm(entry);
          if (action === "edit" && entry) this._prefillCreateForm(entry, { edit: true });
        });
      });
      const picker = card.querySelector("[data-shape-picker]");
      if (picker) {
        LatticeShapePicker.render(picker, {
          baseType: picker.dataset.baseType,
          value: picker.dataset.shapeValue,
          color: picker.dataset.shapeColor,
          compact: true,
          onChange: (shape) => this.setCatalogShape(id, shape, entry),
        });
      }
    });
  }

  _readDragCatalogId(e) {
    return e.dataTransfer.getData(MIME) || e.dataTransfer.getData("text/plain") || "";
  }

  _bindCanvasDrop() {
    const stage = document.getElementById("canvas-stage");
    if (!stage) return;
    stage.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    stage.addEventListener("drop", (e) => {
      e.preventDefault();
      const catalogId = this._readDragCatalogId(e);
      if (!catalogId) return;
      const entry = this.getEntry(catalogId);
      if (!entry) return;
      const payload = this.toDeployPayload(entry);
      this.onDeploy(payload, e.clientX, e.clientY);
      this.disarm();
    });
  }

  _bindHotkeys() {
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea, select")) return;
      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1;
        const catalogId = this.slots[idx];
        if (!catalogId) {
          this.openQuickPicker(idx);
          return;
        }
        if (this.armedCatalogId === catalogId) this.disarm();
        else this.arm(catalogId);
      }
    });
  }
}

export function initNodeInventory(options = {}) {
  const inventory = new LiteInventory(options);
  return {
    init: (palette) => inventory.init(palette),
    setPalette: (palette) => inventory.setPalette(palette),
    togglePanel: (force) => inventory.togglePanel(force),
    getArmedPayload: () => inventory.getArmedPayload(),
    disarm: () => inventory.disarm(),
    arm: (id) => inventory.arm(id),
    close: () => inventory.togglePanel(false),
  };
}