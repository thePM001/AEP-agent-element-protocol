/** Composer Lite policy creator - simple form with optional advanced builder. */
(function (global) {
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slugify(value) {
    return String(value || "policy")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "policy";
  }

  function defaultSchemaDefinition() {
    return {
      type: "object",
      required: ["action", "actor"],
      properties: {
        action: { type: "string", enum: ["read", "write", "execute"] },
        actor: { type: "string", minLength: 1 },
        resource: { type: "string" },
      },
      additionalProperties: false,
    };
  }

  function defaultSampleData() {
    return [
      { action: "read", actor: "agent-alpha", resource: "lattice-stage" },
      { action: "write", actor: "agent-beta", resource: "policy-catalog" },
    ];
  }

  class PolicyBuilderFlow {
    constructor(root) {
      this.root = root;
      this.panel = root?.querySelector(".policy-builder-panel");
      this.stepNav = root?.querySelector(".policy-builder-steps");
      this.bodyEl = root?.querySelector(".policy-builder-body");
      this.statusEl = root?.querySelector("#policy-builder-status");
      this.titleEl = root?.querySelector("#policy-builder-title");
      this.closeBtn = root?.querySelector("#policy-builder-close");
      this.backBtn = root?.querySelector("#policy-builder-back");
      this.nextBtn = root?.querySelector("#policy-builder-next");
      this._ctx = null;
      this._state = {};
      this._busy = false;
      this._advancedOpen = false;

      this.closeBtn?.addEventListener("click", () => this.close());
      this.backBtn?.addEventListener("click", () => this.close());
      this.nextBtn?.addEventListener("click", () => this._submit());
      this.root?.addEventListener("click", (e) => {
        if (e.target === this.root) this.close();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isOpen()) this.close();
      });
      this.panel?.addEventListener("click", (e) => e.stopPropagation());
    }

    isOpen() {
      return this.root?.classList.contains("open");
    }

    _setStatus(text, tone = "info") {
      if (!this.statusEl) return;
      this.statusEl.textContent = text || "";
      this.statusEl.dataset.tone = tone;
    }

    _setBusy(busy) {
      this._busy = busy;
      if (this.nextBtn) this.nextBtn.disabled = busy;
      if (this.backBtn) this.backBtn.disabled = busy;
    }

    openCreate(ctx = {}) {
      if (!this.root) return;
      this._ctx = ctx;
      this._advancedOpen = false;
      this._state = {
        name: "",
        description: "",
        domain: ctx.stageLabel ? `${slugify(ctx.stageLabel)}-lattice` : "lattice-stage",
        categoryId: ctx.defaultCategoryId || ctx.categories?.[0]?.id || "",
        schemaId: "",
        schemaJson: JSON.stringify(defaultSchemaDefinition(), null, 2),
        sampleJson: JSON.stringify(defaultSampleData(), null, 2),
        schemaResult: null,
        buildResult: null,
        validateResult: null,
      };
      if (this.titleEl) {
        this.titleEl.textContent = `New Policy · ${ctx.stageLabel || "Stage"}`;
      }
      this.root.hidden = false;
      this.root.removeAttribute("hidden");
      this.root.classList.add("open");
      document.body.classList.add("policy-builder-open");
      this._renderCreate();
    }

    openCategory(ctx = {}) {
      if (!this.root) return;
      this._ctx = { ...ctx, mode: "category" };
      this._state = { name: "" };
      if (this.titleEl) this.titleEl.textContent = "New Category";
      this.root.hidden = false;
      this.root.removeAttribute("hidden");
      this.root.classList.add("open");
      document.body.classList.add("policy-builder-open");
      this._renderCategoryOnly();
    }

    close() {
      if (!this.root) return;
      this.root.hidden = true;
      this.root.setAttribute("hidden", "");
      this.root.classList.remove("open");
      document.body.classList.remove("policy-builder-open");
      this._ctx = null;
      this._setBusy(false);
      this._setStatus("");
    }

    async _submit() {
      if (this._busy) return;
      if (this._ctx?.mode === "category") {
        const name = this._state.name?.trim();
        if (!name) {
          this._setStatus("Enter a category name.", "error");
          return;
        }
        this._ctx.onComplete?.(name);
        this.close();
        return;
      }

      const name = this.bodyEl?.querySelector('[name="policy-name"]')?.value?.trim();
      const categoryId = this.bodyEl?.querySelector('[name="policy-category"]')?.value;
      const description = this.bodyEl?.querySelector('[name="policy-description"]')?.value?.trim() || "";
      const domain = this.bodyEl?.querySelector('[name="policy-domain"]')?.value?.trim()
        || this._state.domain;

      if (!name) {
        this._setStatus("Policy name is required.", "error");
        return;
      }

      this._state.name = name;
      this._state.categoryId = categoryId || this._state.categoryId;
      this._state.description = description;
      this._state.domain = domain;
      this._state.schemaId = slugify(`${domain}-${name}`);

      if (this._advancedOpen && this._state.buildResult) {
        this._savePolicy("aep-policy-builder");
        return;
      }

      this._savePolicy("manual", {
        description,
        domain,
        schemaId: this._state.schemaId,
        createdAt: new Date().toISOString(),
        stage: this._ctx?.stageLabel,
      });
    }

    _schemaCandidate() {
      const schemaJson = this.bodyEl?.querySelector('[name="schema-json"]')?.value
        || this._state.schemaJson;
      return {
        schemaId: this._state.schemaId,
        domain: this._state.domain,
        definition: JSON.parse(schemaJson || "{}"),
        source: "human",
      };
    }

    _historicalData() {
      try {
        const raw = this.bodyEl?.querySelector('[name="sample-json"]')?.value
          || this._state.sampleJson;
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    async _post(path, body) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `${path} failed (${res.status})`);
      }
      return data.result;
    }

    async _runSchemaValidation() {
      this._setBusy(true);
      this._setStatus("Validating schema…");
      try {
        this._state.schemaJson = this.bodyEl?.querySelector('[name="schema-json"]')?.value
          || this._state.schemaJson;
        this._state.sampleJson = this.bodyEl?.querySelector('[name="sample-json"]')?.value
          || this._state.sampleJson;
        const result = await this._post("api/schema-builder/validate", {
          schema: this._schemaCandidate(),
          historicalData: this._historicalData(),
        });
        this._state.schemaResult = result;
        this._setStatus(
          `Schema ${result.decision.toUpperCase()} · ${(result.compositeScore * 100).toFixed(1)}%`,
          result.decision === "pass" ? "ok" : result.decision === "review" ? "warn" : "error",
        );
        this._renderAdvancedBody();
      } catch (err) {
        this._setStatus(err.message, "error");
      } finally {
        this._setBusy(false);
      }
    }

    async _runPolicyBuild() {
      this._setBusy(true);
      this._setStatus("Building Rego rules…");
      try {
        const built = await this._post("api/policy-builder/build", {
          schema: this._schemaCandidate(),
          domain: this._state.domain,
          historicalData: this._historicalData(),
        });
        const rules = (built.rules || []).map((r) => r.ruleSource).filter(Boolean);
        const validated = await this._post("api/policy-builder/validate", {
          schema: this._schemaCandidate(),
          rules,
          manifest: built.manifest,
          historicalData: this._historicalData(),
        });
        this._state.buildResult = built;
        this._state.validateResult = validated;
        this._setStatus(
          `Coverage ${Math.round((validated.coverageRate || 0) * 100)}% · ${rules.length} rules`,
          "ok",
        );
        this._renderAdvancedBody();
      } catch (err) {
        this._setStatus(err.message, "error");
      } finally {
        this._setBusy(false);
      }
    }

    _savePolicy(source, minimalBody = null) {
      let body;
      if (minimalBody) {
        body = {
          name: this._state.name,
          source,
          body: minimalBody,
        };
      } else {
        const rules = (this._state.buildResult?.rules || []).map((r) => ({
          id: r.ruleId,
          source: r.ruleSource,
          invariantId: r.invariantId,
          confidence: r.confidence,
        }));
        body = {
          name: this._state.name,
          source,
          body: {
            description: this._state.description,
            schema: this._schemaCandidate(),
            schemaValidation: this._state.schemaResult,
            manifest: this._state.buildResult?.manifest,
            rules,
            rego: rules.map((r) => r.source),
            validation: this._state.validateResult,
            spectral: this._state.buildResult?.spectral,
            stage: this._ctx?.stageLabel,
            createdAt: new Date().toISOString(),
          },
        };
      }
      this._ctx?.onSave?.({
        name: this._state.name,
        categoryId: this._state.categoryId,
        policy: body,
      });
      this.close();
    }

    _renderCategoryOnly() {
      if (this.stepNav) this.stepNav.hidden = true;
      if (this.backBtn) this.backBtn.hidden = true;
      if (this.nextBtn) this.nextBtn.textContent = "ADD CATEGORY";
      this.bodyEl.innerHTML = `
        <section class="policy-builder-section">
          <p class="policy-builder-lead">Group policies for this lattice stage.</p>
          <label class="policy-builder-field policy-builder-field-span">
            <span>Category name</span>
            <input type="text" name="category-name" maxlength="48" placeholder="Compliance, Runtime, Data…" autofocus>
          </label>
        </section>`;
      const input = this.bodyEl.querySelector('[name="category-name"]');
      input?.addEventListener("input", (e) => {
        this._state.name = e.target.value;
      });
      input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this._submit();
        }
      });
      this._setStatus("");
    }

    _renderCreate() {
      if (this.stepNav) this.stepNav.hidden = true;
      if (this.backBtn) this.backBtn.hidden = true;
      if (this.nextBtn) this.nextBtn.textContent = "CREATE POLICY";

      const cats = this._ctx?.categories || [];
      const catOptions = cats
        .map((c) => `<option value="${esc(c.id)}" ${c.id === this._state.categoryId ? "selected" : ""}>${esc(c.name)}</option>`)
        .join("");

      this.bodyEl.innerHTML = `
        <section class="policy-builder-section">
          <p class="policy-builder-lead">Add a policy to <strong>${esc(this._ctx?.stageLabel)}</strong>. Name it, pick a category, save. Use Advanced only if you need Schema/Policy Builder.</p>
          <div class="policy-builder-grid">
            <label class="policy-builder-field policy-builder-field-span">
              <span>Policy name</span>
              <input type="text" name="policy-name" maxlength="64" value="${esc(this._state.name)}" placeholder="e.g. Egress guard" autofocus>
            </label>
            <label class="policy-builder-field">
              <span>Category</span>
              <select name="policy-category">${catOptions}</select>
            </label>
            <label class="policy-builder-field">
              <span>Domain (optional)</span>
              <input type="text" name="policy-domain" maxlength="48" value="${esc(this._state.domain)}">
            </label>
            <label class="policy-builder-field policy-builder-field-span">
              <span>Notes (optional)</span>
              <textarea name="policy-description" rows="2" maxlength="500" placeholder="What this policy covers">${esc(this._state.description)}</textarea>
            </label>
          </div>
          <div class="policy-builder-simple-actions">
            <button type="button" class="policy-builder-btn ghost" id="policy-builder-ask-cca">ASK CCA</button>
            <button type="button" class="policy-builder-btn ghost" id="policy-builder-advanced-toggle">${this._advancedOpen ? "HIDE ADVANCED" : "ADVANCED BUILDER"}</button>
          </div>
          <div id="policy-builder-advanced" class="policy-builder-advanced" ${this._advancedOpen ? "" : "hidden"}></div>
        </section>`;

      this.bodyEl.querySelector("#policy-builder-ask-cca")?.addEventListener("click", () => {
        const stage = this._ctx?.stageLabel || "lattice stage";
        const prompt = [
          `Help me write a ${stage} stage policy for this Action Lattice.`,
          "I need guidance on JSON schema, invariants, and Rego rules.",
        ].join(" ");
        this.close();
        if (typeof this._ctx?.onAskCca === "function") {
          this._ctx.onAskCca(prompt);
          return;
        }
        requestAnimationFrame(() => {
          global.composerCcaPane?.focusComposer?.(prompt);
        });
      });

      this.bodyEl.querySelector("#policy-builder-advanced-toggle")?.addEventListener("click", () => {
        this._advancedOpen = !this._advancedOpen;
        const adv = this.bodyEl.querySelector("#policy-builder-advanced");
        const btn = this.bodyEl.querySelector("#policy-builder-advanced-toggle");
        if (adv) adv.hidden = !this._advancedOpen;
        if (btn) btn.textContent = this._advancedOpen ? "HIDE ADVANCED" : "ADVANCED BUILDER";
        if (this._advancedOpen) this._renderAdvancedBody();
      });

      if (this._advancedOpen) this._renderAdvancedBody();
      this._setStatus("");
    }

    _renderAdvancedBody() {
      const adv = this.bodyEl?.querySelector("#policy-builder-advanced");
      if (!adv) return;
      const r = this._state.schemaResult;
      const built = this._state.buildResult;
      const val = this._state.validateResult;

      adv.innerHTML = `
        <details class="policy-builder-advanced-panel" open>
          <summary>Schema Builder</summary>
          <div class="policy-builder-split">
            <label class="policy-builder-field">
              <span>Schema (JSON)</span>
              <textarea name="schema-json" rows="10" spellcheck="false">${esc(this._state.schemaJson)}</textarea>
            </label>
            <label class="policy-builder-field">
              <span>Sample data (JSON array)</span>
              <textarea name="sample-json" rows="10" spellcheck="false">${esc(this._state.sampleJson)}</textarea>
            </label>
          </div>
          <button type="button" class="policy-builder-btn ghost" id="policy-builder-validate-schema">VALIDATE SCHEMA</button>
          ${r ? `
            <div class="policy-builder-metrics">
              <div class="policy-builder-metric"><span>Decision</span><strong data-tone="${esc(r.decision)}">${esc(String(r.decision).toUpperCase())}</strong></div>
              <div class="policy-builder-metric"><span>Score</span><strong>${(r.compositeScore * 100).toFixed(1)}%</strong></div>
            </div>` : ""}
        </details>
        <details class="policy-builder-advanced-panel" ${built ? "open" : ""}>
          <summary>Policy Builder (Rego)</summary>
          <button type="button" class="policy-builder-btn ghost" id="policy-builder-build-policy">BUILD POLICY</button>
          ${built ? `
            <div class="policy-builder-metrics">
              <div class="policy-builder-metric"><span>Rules</span><strong>${(built.rules || []).length}</strong></div>
              <div class="policy-builder-metric"><span>Coverage</span><strong>${Math.round((val?.coverageRate || 0) * 100)}%</strong></div>
            </div>` : `<p class="policy-builder-placeholder">Validate schema first, then build.</p>`}
        </details>`;

      adv.querySelector("#policy-builder-validate-schema")?.addEventListener("click", () => {
        this._runSchemaValidation();
      });
      adv.querySelector("#policy-builder-build-policy")?.addEventListener("click", () => {
        this._runPolicyBuild();
      });
    }
  }

  let flow = null;

  global.PolicyBuilderFlow = {
    init() {
      const root = document.getElementById("policy-builder-flow");
      if (!root) return null;
      flow = new PolicyBuilderFlow(root);
      return flow;
    },
    openCreate(ctx) {
      if (!flow) flow = this.init();
      flow?.openCreate(ctx);
    },
    openCategory(ctx) {
      if (!flow) flow = this.init();
      flow?.openCategory(ctx);
    },
    isOpen() {
      return !!flow?.isOpen();
    },
    close() {
      flow?.close();
    },
  };
})(window);