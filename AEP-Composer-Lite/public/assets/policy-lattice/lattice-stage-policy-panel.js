/* Wide-screen lattice stage policy manager (inventory-style popup) */
(function (global) {
  const STAGE_LABELS = global.LatticeVisualTokens?.LATTICE_STAGE_LABELS || ["WARN", "SOFT", "HARD"];
  const STAGE_KEYS = global.LatticeVisualTokens?.LATTICE_STAGE_KEYS || ["warn", "soft", "hard"];
  const Catalog = global.LatticePolicyCatalog;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function apiBase() {
    return (document.documentElement.dataset.apiBase || "").replace(/\/$/, "");
  }

  function controlHeaders(extra = {}) {
    const headers = { ...extra };
    const token = document.documentElement.dataset.dashboardToken || "";
    if (token) headers["X-Composer-Token"] = token;
    return headers;
  }

  class LatticeStagePolicyPanel {
    constructor(root, options = {}) {
      this.root = root;
      this.lattice = options.lattice;
      this.onChange = options.onChange || (() => {});
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
      this._latticeNode = null;
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
        if (!this._latticeNode) return;
        const key = this._stageKey();
        global.PolicyBuilderFlow?.openCategory({
          onComplete: (name) => {
            this._latticeNode.meta = Catalog.addCategory(this._latticeNode.meta, key, name);
            this._commit();
            this.render();
          },
        });
      });

      this.createPolicyBtn?.addEventListener("click", () => {
        if (!this._latticeNode) return;
        const key = this._stageKey();
        const stage = Catalog.getStageCatalog(this._latticeNode.meta, key);
        const categories = stage.categories || [];
        const defaultCategoryId = categories[0]?.id;
        if (!defaultCategoryId) {
          global.PolicyBuilderFlow?.openCategory({
            onComplete: (name) => {
              this._latticeNode.meta = Catalog.addCategory(this._latticeNode.meta, key, name);
              this._commit();
              this.render();
              this.createPolicyBtn?.click();
            },
          });
          return;
        }
        global.PolicyBuilderFlow?.openCreate({
          stageKey: key,
          stageLabel: this._stageLabel(),
          categories,
          defaultCategoryId,
          onAskCca: (prompt) => this._openCcaPolicyAssist(prompt),
          onSave: ({ name, categoryId, policy }) => {
            const catId = categoryId || defaultCategoryId;
            this._latticeNode.meta = Catalog.addPolicy(this._latticeNode.meta, key, catId, {
              name,
              source: policy?.source || "aep-policy-builder",
              body: policy?.body || {},
            });
            this._commit();
            this.render();
          },
        });
      });

      this.importPolicyBtn?.addEventListener("click", () => this.importFile?.click());
      this.importFile?.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file || !this._latticeNode) return;
        try {
          const text = await file.text();
          const key = this._stageKey();
          const stage = Catalog.getStageCatalog(this._latticeNode.meta, key);
          const catId = stage.categories[0]?.id;
          const result = Catalog.importPolicyJson(this._latticeNode.meta, key, catId, text);
          if (result.error) throw new Error(result.error);
          this._latticeNode.meta = result.meta;
          this._commit();
          this.render();
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
          if (!Number.isInteger(idx) || !this._latticeNode) return;
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
      return STAGE_KEYS[this._stageIndex] || STAGE_KEYS[0];
    }

    _stageLabel() {
      return STAGE_LABELS[this._stageIndex] || "STAGE";
    }

    _storageLinks() {
      if (!this._latticeNode || !this.lattice) return { input: null, output: null };
      return Catalog.resolveLatticeStorageLinks(
        this._latticeNode.id,
        this.lattice.nodes,
        this.lattice.edges,
      );
    }

    open(latticeNode, stageIndex) {
      if (!this.root || !latticeNode) return;
      this._latticeNode = latticeNode;
      this._stageIndex = Number(stageIndex) || 0;
      this._latticeNode.meta = Catalog.writePolicyCatalog(
        this._latticeNode.meta,
        Catalog.normalizePolicyCatalog(this._latticeNode.meta),
      );
      this.root.hidden = false;
      this.root.removeAttribute("hidden");
      this.root.classList.add("open");
      this._syncStageTabs();
      this.render();
    }

    close() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.setAttribute("hidden", "");
      this.root.classList.remove("open");
      this._latticeNode = null;
    }

    _commit() {
      if (!this._latticeNode || !this.lattice) return;
      this.lattice.updateNode?.(this._latticeNode.id, {
        label: this._latticeNode.label,
        meta: this._latticeNode.meta,
      });
      this.onChange(this._latticeNode);
      this.lattice._scheduleDraw?.();
    }

    _assignPolicyToStage(categoryId, policy) {
      if (!this._latticeNode || !this.lattice) return;
      const key = this._stageKey();
      const idx = this._stageIndex;
      const stages = global.LatticeVisualTokens?.normalizeLatticeStages?.(this._latticeNode.meta) || [];
      stages[idx] = {
        catalogPolicyId: policy.id,
        categoryId,
        label: policy.name,
        color: global.LatticeVisualTokens?.LATTICE_STAGE_COLORS?.[idx] || "#D4C84A",
        source: policy.source,
      };
      this._latticeNode.meta = {
        ...Catalog.updatePolicyAssignment(this._latticeNode.meta, key, categoryId, policy.id, true),
        stages,
      };
      this._commit();
      this.render();
    }

    _openAepCreator(policy) {
      const stage = this._stageLabel();
      const prompt = [
        `Create an AEP policy for lattice stage ${stage}.`,
        `Policy: ${policy?.name || "new policy"}.`,
        "Return PAD-ready policy JSON with validation gates.",
      ].join(" ");
      this._openCcaPolicyAssist(prompt);
      const aepPanel = document.getElementById("settings-aep-panel");
      if (aepPanel) {
        aepPanel.hidden = false;
        aepPanel.removeAttribute("hidden");
        aepPanel.classList.add("open");
      }
    }

    _openCcaPolicyAssist(customPrompt) {
      const stage = this._stageLabel();
      const prompt = customPrompt || [
        `Assist with ${stage} stage policies on the Action Lattice.`,
        "Help create, import, or validate policy documents.",
      ].join(" ");
      if (global.PolicyBuilderFlow?.isOpen?.()) {
        global.PolicyBuilderFlow.close();
      }
      if (this.isOpen()) {
        this.close();
      }
      requestAnimationFrame(() => {
        const pane = global.composerCcaPane;
        if (pane?.focusComposer) {
          pane.focusComposer(prompt);
          return;
        }
        pane?.setTab?.("agent");
        pane?.toggleExpanded?.(true);
        const input = document.getElementById("cca-chat-input");
        if (input) {
          input.value = prompt;
          input.focus();
        }
      });
    }

    async _ingestFiles(e) {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      const links = this._storageLinks();
      if (!links.input) {
        window.alert("Connect a Storage Input node to this lattice to ingest policy documents.");
        return;
      }
      const key = this._stageKey();
      const stage = Catalog.getStageCatalog(this._latticeNode.meta, key);
      const catId = stage.categories[0]?.id;
      const queue = Array.isArray(links.input.meta?.ingest_queue) ? links.input.meta.ingest_queue.slice() : [];
      for (const file of files) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch(`${apiBase()}/api/cca/upload`, {
            method: "POST",
            headers: controlHeaders(),
            body: fd,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || res.status);
          queue.push({
            file_id: data.file_id,
            name: data.name,
            stage: key,
            lattice_id: this._latticeNode.id,
            uploaded_at: new Date().toISOString(),
          });
          this._latticeNode.meta = Catalog.addPolicy(this._latticeNode.meta, key, catId, {
            name: file.name,
            source: "ingest",
            ingestFile: data.file_id,
          });
        } catch (err) {
          window.alert(`Ingest failed for ${file.name}: ${err.message}`);
        }
      }
      links.input.meta = { ...links.input.meta, ingest_queue: queue, storage_role: "input" };
      this.lattice.updateNode?.(links.input.id, { meta: links.input.meta, label: links.input.label });
      this._commit();
      this.render();
    }

    async _emitTraces() {
      const links = this._storageLinks();
      if (!links.output) {
        window.alert("Connect a Storage Output node to this lattice to save validation traces.");
        return;
      }
      try {
        const traces = await global.LatticeStore?.fabricTraces?.(80);
        const payload = {
          lattice_id: this._latticeNode.id,
          stage: this._stageKey(),
          traces: traces?.traces || traces?.items || traces || [],
          emitted_at: new Date().toISOString(),
          destination: "agentstream",
        };
        links.output.meta = {
          ...links.output.meta,
          trace_buffer: payload,
          storage_backend: links.output.meta?.storage_backend || "agentstream",
          storage_role: "output",
        };
        this.lattice.updateNode?.(links.output.id, { meta: links.output.meta, label: links.output.label });
        try {
          await global.LatticeStore?.integrationAction?.("conn-agentstream", "store_memory", payload);
        } catch {
          /* local buffer still holds traces */
        }
        this._commit();
        window.alert("Validation traces buffered on Storage Output and queued for Agentstream.");
        this.render();
      } catch (err) {
        window.alert(`Trace export failed: ${err.message}`);
      }
    }

    render() {
      if (!this._latticeNode) return;
      const key = this._stageKey();
      const stage = Catalog.getStageCatalog(this._latticeNode.meta, key);
      const links = this._storageLinks();
      const assigned = global.LatticeVisualTokens?.normalizeLatticeStages?.(this._latticeNode.meta)?.[this._stageIndex];

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
          ? `${links.input.label || "Storage Input"} (${links.input.meta?.storage_backend || "storage"})`
          : "Not connected";
        const outLabel = links.output
          ? `${links.output.label || "Storage Output"} (${links.output.meta?.storage_backend || "agentstream"})`
          : "Not connected";
        const inQueue = links.input?.meta?.ingest_queue?.length || 0;
        const outTraces = links.output?.meta?.trace_buffer?.traces?.length
          || (Array.isArray(links.output?.meta?.trace_buffer) ? links.output.meta.trace_buffer.length : 0);
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
      this.gridEl.innerHTML = stage.categories.map((cat) => `
        <section class="stage-policy-category" data-category-id="${esc(cat.id)}">
          <header class="stage-policy-category-head">
            <h3>${esc(cat.name)}</h3>
            <span class="stage-policy-category-count">${cat.policies.length}</span>
          </header>
          <div class="stage-policy-cards">
            ${cat.policies.length
              ? cat.policies.map((pol) => `
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
                </article>`).join("")
              : `<p class="stage-policy-empty">No policies in this category yet.</p>`}
          </div>
        </section>`).join("");

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
            this._latticeNode.meta = Catalog.removePolicy(this._latticeNode.meta, key, categoryId, policyId);
            this._commit();
            this.render();
          }
        });
      });
    }
  }

  global.LatticeStagePolicyPanel = LatticeStagePolicyPanel;
})(window);