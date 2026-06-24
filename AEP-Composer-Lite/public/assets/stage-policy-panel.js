/** Lattice stage policy manager popup (Composer Lite) — parity with internal composer. */

import * as Catalog from "./policy-catalog.js";
import { LiteLatticeStore, liteApiBase } from "./lite-lattice-store.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class StagePolicyPanel {
  constructor(root, options = {}) {
    this.root = root;
    this.getGraph = options.getGraph || (() => ({ nodes: [], edges: [] }));
    this.updateNodeData = options.updateNodeData || (() => {});
    this.onFocusCca = options.onFocusCca || (() => {});
    this.onChange = options.onChange || (() => {});
    this.onOpen = options.onOpen || (() => {});
    this.onClose = options.onClose || (() => {});

    this.titleEl = root?.querySelector("#stage-policy-title");
    this.hintEl = root?.querySelector("#stage-policy-hint");
    this.storageEl = root?.querySelector("#stage-policy-storage");
    this.gridEl = root?.querySelector("#stage-policy-grid");
    this.closeBtn = root?.querySelector("#stage-policy-close");
    this.addCategoryBtn = root?.querySelector("#stage-policy-add-category");
    this.createPolicyBtn = root?.querySelector("#stage-policy-create");
    this.importPolicyBtn = root?.querySelector("#stage-policy-import");
    this.ccaBtn = root?.querySelector("#stage-policy-cca");
    this.ingestInput = root?.querySelector("#stage-policy-ingest-input");
    this.ingestBtn = root?.querySelector("#stage-policy-ingest-btn");
    this.emitTracesBtn = root?.querySelector("#stage-policy-emit-traces");
    this.importFile = root?.querySelector("#stage-policy-import-file");
    this.stageTabs = root ? [...root.querySelectorAll(".stage-policy-stage-tab")] : [];

    this._nodeId = null;
    this._stageIndex = 0;
    this._bind();
  }

  _bind() {
    this.closeBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      this.close();
    });
    this.root?.querySelector(".stage-policy-panel")?.addEventListener("click", (e) => e.stopPropagation());
    this.root?.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen()) this.close();
    });

    this.addCategoryBtn?.addEventListener("click", () => {
      const name = window.prompt("Category name");
      if (!name || !this._nodeId) return;
      this._mutateData((data) => Catalog.addCategory(data, this._stageKey(), name));
    });

    this.createPolicyBtn?.addEventListener("click", () => {
      const name = window.prompt("Policy name");
      if (!name || !this._nodeId) return;
      this._mutateData((data) => {
        const stage = Catalog.getStageCatalog(data, this._stageKey());
        const catId = stage.categories[0]?.id;
        if (!catId) return data;
        return Catalog.addPolicy(data, this._stageKey(), catId, { name, source: "user" });
      });
    });

    this.importPolicyBtn?.addEventListener("click", () => this.importFile?.click());
    this.importFile?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !this._nodeId) return;
      try {
        const text = await file.text();
        this._mutateData((data) => {
          const stage = Catalog.getStageCatalog(data, this._stageKey());
          const catId = stage.categories[0]?.id;
          const result = Catalog.importPolicyJson(data, this._stageKey(), catId, text);
          if (result.error) throw new Error(result.error);
          return result.data;
        });
      } catch (err) {
        window.alert(`Import failed: ${err.message}`);
      }
    });

    this.ccaBtn?.addEventListener("click", () => this._openCcaPolicyAssist());
    this.ingestBtn?.addEventListener("click", () => this.ingestInput?.click());
    this.ingestInput?.addEventListener("change", (e) => this._ingestFiles(e));
    this.emitTracesBtn?.addEventListener("click", () => this._emitTraces());

    this.stageTabs.forEach((tab) => {
      tab.addEventListener("click", (e) => {
        e.preventDefault();
        const idx = Number(tab.dataset.stage);
        if (!Number.isInteger(idx) || !this._nodeId) return;
        this._stageIndex = idx;
        this._syncStageTabs();
        this.render();
      });
    });
  }

  _syncStageTabs() {
    this.stageTabs.forEach((tab) => {
      const idx = Number(tab.dataset.stage);
      const active = idx === this._stageIndex;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  isOpen() {
    return this.root?.classList.contains("open") === true;
  }

  _stageKey() {
    return Catalog.STAGE_KEYS[this._stageIndex] || Catalog.STAGE_KEYS[0];
  }

  _stageLabel() {
    return Catalog.STAGE_LABELS[this._stageIndex] || "STAGE";
  }

  _node() {
    if (!this._nodeId) return null;
    return this.getGraph().nodes.find((n) => n.id === this._nodeId) ?? null;
  }

  _commitNode(nodeId, data, label) {
    const patch = { data };
    if (label !== undefined) patch.label = label;
    this.updateNodeData(nodeId, patch);
    this.onChange(this._node());
  }

  _mutateData(mutator) {
    const node = this._node();
    if (!node) return;
    const nextData = mutator({ ...(node.data || {}) });
    const normalized = Catalog.writePolicyCatalog(nextData, Catalog.normalizePolicyCatalog(nextData));
    this._commitNode(node.id, normalized, node.label);
    this.render();
  }

  _storageLinks() {
    const node = this._node();
    if (!node) return { input: null, output: null };
    const graph = this.getGraph();
    return Catalog.resolveLatticeStorageLinks(node.id, graph.nodes, graph.edges);
  }

  open(nodeIdOrNode, stageIndex = 0) {
    const nodeId = typeof nodeIdOrNode === "object" ? nodeIdOrNode?.id : nodeIdOrNode;
    if (!this.root || !nodeId) return;
    this._nodeId = nodeId;
    this._stageIndex = Number(stageIndex) || 0;
    const node = this._node();
    if (node) {
      const normalized = Catalog.writePolicyCatalog(
        node.data || {},
        Catalog.normalizePolicyCatalog(node.data || {}),
      );
      this._commitNode(node.id, normalized, node.label);
    }
    this.root.hidden = false;
    this.root.removeAttribute("hidden");
    this.root.classList.add("open");
    this.onOpen();
    this._syncStageTabs();
    this.render();
  }

  close() {
    if (!this.root) return;
    this.root.hidden = true;
    this.root.setAttribute("hidden", "");
    this.root.classList.remove("open");
    this.onClose();
    this._nodeId = null;
  }

  _assignPolicyToStage(categoryId, policy) {
    const node = this._node();
    if (!node) return;
    const key = this._stageKey();
    const idx = this._stageIndex;
    const stages = Catalog.normalizeLatticeStages(node.data);
    stages[idx] = {
      catalogPolicyId: policy.id,
      categoryId,
      label: policy.name,
      color: Catalog.STAGE_COLORS[idx],
      source: policy.source,
    };
    const nextData = {
      ...Catalog.updatePolicyAssignment(node.data || {}, key, categoryId, policy.id, true),
      stages,
    };
    this._commitNode(node.id, nextData, node.label);
    this.render();
  }

  _openAepCreator(policy) {
    const prompt = [
      `Create an AEP policy for lattice stage ${this._stageLabel()}.`,
      `Policy: ${policy?.name || "new policy"}.`,
      "Return PAD-ready policy JSON with validation gates.",
    ].join(" ");
    this._openCcaPolicyAssist(prompt);
  }

  _openCcaPolicyAssist(customPrompt) {
    const stage = this._stageLabel();
    const prompt =
      customPrompt ||
      [
        `Assist with ${stage} stage policies on the Action Lattice.`,
        "Help create, import, or validate policy documents.",
      ].join(" ");
    this.onFocusCca(prompt);
  }

  async _ingestFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const links = this._storageLinks();
    if (!links.input) {
      window.alert("Connect a Storage Input node to this lattice to ingest policy documents.");
      return;
    }
    const node = this._node();
    if (!node) return;
    const key = this._stageKey();
    const stage = Catalog.getStageCatalog(node.data || {}, key);
    const catId = stage.categories[0]?.id;
    const queue = Array.isArray(links.input.data?.ingest_queue)
      ? links.input.data.ingest_queue.slice()
      : [];
    let nextLatticeData = { ...(node.data || {}) };

    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${liteApiBase()}/api/cca/upload`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.status);
        queue.push({
          file_id: data.file_id,
          name: data.name,
          stage: key,
          lattice_id: node.id,
          uploaded_at: new Date().toISOString(),
        });
        nextLatticeData = Catalog.addPolicy(nextLatticeData, key, catId, {
          name: file.name,
          source: "ingest",
          ingestFile: data.file_id,
        });
      } catch (err) {
        window.alert(`Ingest failed for ${file.name}: ${err.message}`);
      }
    }

    const inputData = { ...links.input.data, ingest_queue: queue, storage_role: "input" };
    this.updateNodeData(links.input.id, { data: inputData, label: links.input.label });
    this._commitNode(node.id, nextLatticeData, node.label);
    this.render();
  }

  async _emitTraces() {
    const links = this._storageLinks();
    if (!links.output) {
      window.alert("Connect a Storage Output node to this lattice to save validation traces.");
      return;
    }
    const node = this._node();
    if (!node) return;
    try {
      const traces = await LiteLatticeStore.fabricTraces(80);
      const payload = {
        lattice_id: node.id,
        stage: this._stageKey(),
        traces: traces?.traces || traces?.items || traces || [],
        emitted_at: new Date().toISOString(),
        destination: "agentstream",
      };
      const outputData = {
        ...links.output.data,
        trace_buffer: payload,
        storage_backend: links.output.data?.storage_backend || "agentstream",
        storage_role: "output",
      };
      this.updateNodeData(links.output.id, { data: outputData, label: links.output.label });
      try {
        await LiteLatticeStore.integrationAction("conn-agentstream", "store_memory", payload);
      } catch {
        /* local buffer still holds traces */
      }
      this._commitNode(node.id, node.data || {}, node.label);
      window.alert("Validation traces buffered on Storage Output and queued for Agentstream.");
      this.render();
    } catch (err) {
      window.alert(`Trace export failed: ${err.message}`);
    }
  }

  render() {
    const node = this._node();
    if (!node) return;
    const key = this._stageKey();
    const stage = Catalog.getStageCatalog(node.data || {}, key);
    const links = this._storageLinks();
    const assigned = Catalog.normalizeLatticeStages(node.data)[this._stageIndex];

    if (this.titleEl) {
      this.titleEl.textContent = `${this._stageLabel()} Stage Policies`;
    }
    if (this.hintEl) {
      this.hintEl.textContent = assigned?.label
        ? `Active on ${this._stageLabel()}: ${assigned.label}`
        : `Organize ${this._stageLabel()} policies by category. Assign, import, or create via AEP.`;
    }
    this._syncStageTabs();

    if (this.storageEl) {
      const inLabel = links.input
        ? `${links.input.label || "Storage Input"} (${links.input.data?.storage_backend || "storage"})`
        : "Not connected";
      const outLabel = links.output
        ? `${links.output.label || "Storage Output"} (${links.output.data?.storage_backend || "agentstream"})`
        : "Not connected";
      const inQueue = links.input?.data?.ingest_queue?.length || 0;
      const outTraces =
        links.output?.data?.trace_buffer?.traces?.length ||
        (Array.isArray(links.output?.data?.trace_buffer) ? links.output.data.trace_buffer.length : 0);
      this.storageEl.innerHTML = `
        <div class="stage-policy-storage-card ${links.input ? "connected" : ""}">
          <span class="stage-policy-storage-kicker">Data Input</span>
          <strong>${esc(inLabel)}</strong>
          <span class="stage-policy-storage-meta">${inQueue} document${inQueue === 1 ? "" : "s"} queued for ingest</span>
        </div>
        <div class="stage-policy-storage-card ${links.output ? "connected" : ""}">
          <span class="stage-policy-storage-kicker">Data Output → Agentstream</span>
          <strong>${esc(outLabel)}</strong>
          <span class="stage-policy-storage-meta">${outTraces} validation trace${outTraces === 1 ? "" : "s"} buffered</span>
        </div>`;
    }

    if (!this.gridEl) return;
    this.gridEl.innerHTML = stage.categories
      .map(
        (cat) => `
        <section class="stage-policy-category" data-category-id="${esc(cat.id)}">
          <header class="stage-policy-category-head">
            <h3>${esc(cat.name)}</h3>
            <span class="stage-policy-category-count">${cat.policies.length}</span>
          </header>
          <div class="stage-policy-cards">
            ${
              cat.policies.length
                ? cat.policies
                    .map(
                      (pol) => `
                <article class="stage-policy-card ${pol.assigned ? "assigned" : ""}" data-policy-id="${esc(pol.id)}">
                  <div class="stage-policy-card-head">
                    <span class="stage-policy-card-name">${esc(pol.name)}</span>
                    <span class="stage-policy-card-source">${esc(pol.source)}</span>
                  </div>
                  <div class="stage-policy-card-actions">
                    <button type="button" class="stage-policy-btn" data-action="assign" data-category="${esc(cat.id)}" data-policy="${esc(pol.id)}">Assign</button>
                    <button type="button" class="stage-policy-btn accent" data-action="aep" data-category="${esc(cat.id)}" data-policy="${esc(pol.id)}">AEP Create</button>
                    <button type="button" class="stage-policy-btn danger" data-action="remove" data-category="${esc(cat.id)}" data-policy="${esc(pol.id)}">Remove</button>
                  </div>
                </article>`,
                    )
                    .join("")
                : `<p class="stage-policy-empty">No policies in this category yet.</p>`
            }
          </div>
        </section>`,
      )
      .join("");

    this.gridEl.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        const categoryId = btn.dataset.category;
        const policyId = btn.dataset.policy;
        const cat = stage.categories.find((c) => c.id === categoryId);
        const pol = cat?.policies?.find((p) => p.id === policyId);
        if (!pol) return;
        if (action === "assign") this._assignPolicyToStage(categoryId, pol);
        if (action === "aep") this._openAepCreator(pol);
        if (action === "remove") {
          this._mutateData((data) => Catalog.removePolicy(data, key, categoryId, policyId));
        }
      });
    });
  }
}

export function initStagePolicyPanel(root, options) {
  return new StagePolicyPanel(root, options);
}