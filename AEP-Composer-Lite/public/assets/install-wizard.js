const STEP_LABELS = [
  "Environment",
  "Compliance",
  "Components",
  "Inference",
  "CCA opt",
  "Activate",
];

const CCA_STEP = 4;
const ACTIVATE_STEP = 5;

const state = {
  step: 0,
  catalog: null,
  status: null,
  lrps: new Set(),
  components: new Set(),
  validation_engine: "none",
  inference: {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
    base_url: "https://openrouter.ai/api/v1",
    api_key_env: "OPENROUTER_API_KEY",
    api_key: "",
  },
  cca_intent: "",
  cca_skipped: false,
  activating: false,
  activationResult: null,
  ccaResult: null,
};

const $ = (sel) => document.querySelector(sel);

function setupAuthHeaders() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("setup_token")?.trim() || "";
  if (!token) return {};
  return { "X-AEP-Setup-Token": token };
}

function api(path, opts = {}) {
  const base = document.querySelector("base")?.href?.replace(/\/$/, "") ?? "";
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...setupAuthHeaders(),
      ...(opts.headers || {}),
    },
    ...opts,
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText || "request failed");
    return body;
  });
}

function setStatusPill() {
  const pill = $("#status-pill");
  if (!state.status) {
    pill.textContent = "Probing";
    pill.className = "status-pill pending";
    return;
  }
  if (state.status.activated) {
    pill.textContent = `Activated ${new Date(state.status.activation?.activated_at || "").toLocaleString()}`;
    pill.className = "status-pill ok";
    return;
  }
  const docks = state.status.docking?.filter((d) => d.pong)?.length ?? 0;
  pill.textContent = `Fresh env · ${docks} docks live`;
  pill.className = "status-pill pending";
}

function skipCcaStep() {
  state.cca_intent = "";
  state.cca_skipped = true;
  state.step = ACTIVATE_STEP;
  renderSteps();
  renderPanel();
}

function renderSteps() {
  const nav = $("#wizard-steps");
  nav.innerHTML = STEP_LABELS.map((label, i) => {
    const parts = [];
    if (i < state.step) parts.push("done");
    if (i === state.step) parts.push("active");
    if (i === CCA_STEP) parts.push("optional");
    if (i === CCA_STEP && state.cca_skipped && state.step > CCA_STEP) parts.push("done");
    const cls = parts.join(" ");
    return `<div class="step-chip ${cls}">${i + 1}. ${label}</div>`;
  }).join("");
  $("#footer-meta").textContent = `Step ${state.step + 1} of ${STEP_LABELS.length}`;
  $("#btn-back").disabled = state.step === 0 || state.activating;
  const skipBtn = $("#btn-skip");
  if (skipBtn) {
    const showSkip = !state.activating && (state.step === 3 || state.step === CCA_STEP);
    skipBtn.hidden = !showSkip;
    skipBtn.disabled = state.activating;
    skipBtn.textContent = state.step === 3 ? "Skip CCA" : "Skip";
  }
  const nextBtn = $("#btn-next");
  if (nextBtn) {
    if (state.activating) nextBtn.textContent = "Activating";
    else if (state.step >= ACTIVATE_STEP) nextBtn.textContent = "Activate";
    else if (state.step === CCA_STEP && state.cca_intent.trim()) nextBtn.textContent = "Review";
    else nextBtn.textContent = "Next";
  }
}

function checkboxCards(items, selected, key = "id", titleKey = "name", descKey = "description") {
  return `<div class="grid-2">${items
    .map(
      (item) => `
    <div class="card">
      <label>
        <input type="checkbox" data-id="${item[key]}" ${selected.has(item[key]) ? "checked" : ""} />
        <span>
          <strong>${item[titleKey]}</strong>
          <p>${item[descKey] || ""}</p>
        </span>
      </label>
    </div>`,
    )
    .join("")}</div>`;
}

function bindCheckboxes(container, set) {
  container.querySelectorAll('input[type="checkbox"][data-id]').forEach((el) => {
    el.addEventListener("change", () => {
      if (el.checked) set.add(el.dataset.id);
      else set.delete(el.dataset.id);
    });
  });
}

function renderPanel() {
  const panel = $("#wizard-panel");
  if (!state.catalog || !state.status) {
    panel.innerHTML = '<p class="loading">Reading catalog</p>';
    return;
  }

  if (state.step === 0) {
    const health = state.status.health?.status ?? "unknown";
    const dockOk = state.status.docking?.filter((d) => d.listening || d.pong).length ?? 0;
    panel.innerHTML = `
      <h2>Environment probe</h2>
      <p class="lead">This wizard activates Base Node on a fresh Docker volume. EPSCOM, hyperlattice docks and CAW sandboxes wire in through the setup agent.</p>
      <div class="metrics">
        <div class="metric"><span>Base Node health</span><strong>${health}</strong></div>
        <div class="metric"><span>Docking ports</span><strong>${dockOk} / ${state.status.docking?.length ?? 0}</strong></div>
        <div class="metric"><span>Config present</span><strong>${state.status.config_present ? "yes" : "bootstrap"}</strong></div>
        <div class="metric"><span>Activated</span><strong>${state.status.activated ? "yes" : "no"}</strong></div>
      </div>
      <p class="lead">Install method for this container: <strong>Docker Compose (recommended)</strong>. Data dir: <code>${state.status.paths?.data_dir ?? "/data/aep"}</code></p>
      <div class="field">
        <label>Validation engine mode</label>
        <select id="validation-engine">
          ${state.catalog.validation_engines
            .map(
              (v) =>
                `<option value="${v.id}" ${state.validation_engine === v.id ? "selected" : ""}>${v.label}</option>`,
            )
            .join("")}
        </select>
      </div>`;
    $("#validation-engine")?.addEventListener("change", (e) => {
      state.validation_engine = e.target.value;
    });
    return;
  }

  if (state.step === 1) {
    panel.innerHTML = `
      <h2>Compliance LRPs</h2>
      <p class="lead">EPSCOM is always mandatory (priority 255). Select regulation modules to bind on the hyperlattice wrap.</p>
      ${checkboxCards(state.catalog.compliance_lrps, state.lrps)}`;
    bindCheckboxes(panel, state.lrps);
    return;
  }

  if (state.step === 2) {
    const caw = state.catalog.caw_framework;
    panel.innerHTML = `
      <h2>Components + CAW sandboxes</h2>
      <p class="lead"><strong>caw-framework</strong> is core for governed coding agents. GAP profiles: ${caw.gap_profiles.join(", ")}. ${caw.note}</p>
      ${checkboxCards(state.catalog.components, state.components)}`;
    bindCheckboxes(panel, state.components);
    return;
  }

  if (state.step === 3) {
    const defs = state.catalog.inference.defaults[state.inference.provider] ?? {};
    panel.innerHTML = `
      <h2>Inference engine (CCA)</h2>
      <p class="lead">CCA uses this provider for deployment planning and chat after activation.</p>
      <div class="field">
        <label>Provider</label>
        <select id="inf-provider">
          ${state.catalog.inference.providers
            .map((p) => `<option value="${p}" ${state.inference.provider === p ? "selected" : ""}>${p}</option>`)
            .join("")}
        </select>
      </div>
      <div class="field"><label>Model</label><input id="inf-model" value="${state.inference.model || defs.model || ""}" /></div>
      <div class="field"><label>Base URL</label><input id="inf-base" value="${state.inference.base_url || defs.base_url || ""}" /></div>
      <div class="field"><label>API key (stored in inference-secrets.env)</label><input id="inf-key" type="password" placeholder="${defs.api_key_env ? `env ${defs.api_key_env}` : "optional for local"}" /></div>`;
    const applyDefaults = () => {
      const d = state.catalog.inference.defaults[state.inference.provider] ?? {};
      state.inference.model = $("#inf-model").value.trim() || d.model || "";
      state.inference.base_url = $("#inf-base").value.trim() || d.base_url || "";
      state.inference.api_key_env = d.api_key_env ?? null;
    };
    $("#inf-provider").addEventListener("change", (e) => {
      state.inference.provider = e.target.value;
      const d = state.catalog.inference.defaults[state.inference.provider] ?? {};
      $("#inf-model").value = d.model ?? "";
      $("#inf-base").value = d.base_url ?? "";
      applyDefaults();
    });
    ["inf-model", "inf-base", "inf-key"].forEach((id) => {
      $(`#${id}`)?.addEventListener("input", applyDefaults);
    });
    $("#inf-key")?.addEventListener("input", (e) => {
      state.inference.api_key = e.target.value;
    });
    return;
  }

  if (state.step === CCA_STEP) {
    panel.innerHTML = `
      <h2>CCA deployment intent</h2>
      <p class="lead">Optional. Plain intent string for CCA plan bootstrap after activation. Use Skip CCA or leave blank.</p>
      <div class="field">
        <label>Example: "Enable caw-framework, Postgres evidence store, eu-ai-act compliance and coding agents with shell enforcement"</label>
        <textarea id="cca-intent" placeholder="caw-framework + eu-ai-act + coding agents">${state.cca_intent}</textarea>
      </div>`;
    $("#cca-intent")?.addEventListener("input", (e) => {
      state.cca_intent = e.target.value;
      state.cca_skipped = !state.cca_intent.trim();
      renderSteps();
    });
    return;
  }

  const lrps = [...state.lrps];
  const components = [...state.components];
  const ccaLabel = state.cca_intent.trim()
    ? "intent set"
    : state.cca_skipped
      ? "skipped"
      : "none";
  panel.innerHTML = `
    <h2>Review and activate</h2>
    <p class="lead">setup-agent --non-interactive. CCA bootstrap only if intent is set.</p>
    <div class="metrics">
      <div class="metric"><span>LRPs</span><strong>${lrps.length ? lrps.join(", ") : "defaults"}</strong></div>
      <div class="metric"><span>Components</span><strong>${components.length ? components.length : "defaults"}</strong></div>
      <div class="metric"><span>Inference</span><strong>${state.inference.provider}</strong></div>
      <div class="metric"><span>Validation engine</span><strong>${state.validation_engine}</strong></div>
      <div class="metric"><span>CCA</span><strong>${ccaLabel}</strong></div>
    </div>
    ${!state.cca_intent.trim() ? `<p class="lead"><button type="button" class="btn ghost" id="btn-add-cca">Add CCA intent</button></p>` : ""}
    ${state.activationResult ? `<div class="log-box">${escapeHtml(JSON.stringify(state.activationResult, null, 2))}</div>` : ""}
    ${state.ccaResult ? `<div class="log-box">${escapeHtml(JSON.stringify(state.ccaResult, null, 2))}</div>` : ""}
    ${state.status?.ucb?.api_key_configured ? `
      <div class="metrics">
        <div class="metric"><span>UCB API key</span><strong>${escapeHtml(state.status.ucb.key_preview || "configured")}</strong></div>
      </div>
      ${state.status.ucb.recovery_available ? `<p class="lead">${escapeHtml(state.status.ucb.recovery_hint)}</p>` : ""}` : ""}
    ${state.status.activated || state.activationResult?.ok ? `
      <div class="links">
        <a href="./">Open Composer Lite canvas</a>
        <a href="./#cca">CCA chat is on the canvas</a>
      </div>` : ""}`;
  $("#btn-add-cca")?.addEventListener("click", () => {
    state.cca_skipped = false;
    state.step = CCA_STEP;
    renderSteps();
    renderPanel();
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function activate() {
  state.activating = true;
  $("#btn-next").disabled = true;
  renderPanel();
  try {
    await api("/api/setup/inference", {
      method: "POST",
      body: JSON.stringify({
        provider: state.inference.provider,
        model: state.inference.model,
        base_url: state.inference.base_url,
        api_key: state.inference.api_key || undefined,
      }),
    });
    const activation = await api("/api/setup/activate", {
      method: "POST",
      body: JSON.stringify({
        force: state.status.activated,
        lrps: [...state.lrps],
        components: [...state.components],
        validation_engine: state.validation_engine,
      }),
    });
    state.activationResult = activation;
    if (state.cca_intent.trim()) {
      state.ccaResult = await api("/api/setup/cca-bootstrap", {
        method: "POST",
        body: JSON.stringify({ intent: state.cca_intent.trim() }),
      });
    }
    state.status = await api("/api/setup/status");
    setStatusPill();
  } catch (err) {
    state.activationResult = { ok: false, error: err.message };
  } finally {
    state.activating = false;
    $("#btn-next").disabled = false;
    renderPanel();
  }
}

async function init() {
  [state.catalog, state.status] = await Promise.all([
    api("/api/setup/catalog"),
    api("/api/setup/status"),
  ]);
  for (const lrp of state.catalog.compliance_lrps) {
    if (lrp.default_enabled) state.lrps.add(lrp.id);
  }
  for (const comp of state.catalog.components) {
    if (comp.default_enabled) state.components.add(comp.id);
  }
  if (!state.components.has("caw-framework")) state.components.add("caw-framework");
  const defs = state.catalog.inference.defaults[state.inference.provider] ?? {};
  state.inference.model = defs.model ?? state.inference.model;
  state.inference.base_url = defs.base_url ?? state.inference.base_url;
  state.inference.api_key_env = defs.api_key_env ?? null;

  setStatusPill();
  renderSteps();
  renderPanel();

  $("#btn-back").addEventListener("click", () => {
    if (state.step > 0) {
      state.step -= 1;
      renderSteps();
      renderPanel();
    }
  });

  $("#btn-skip")?.addEventListener("click", () => {
    skipCcaStep();
  });

  $("#btn-next").addEventListener("click", async () => {
    if (state.step < ACTIVATE_STEP) {
      if (state.step === 3) state.cca_skipped = false;
      if (state.step === CCA_STEP && !state.cca_intent.trim()) {
        skipCcaStep();
        return;
      }
      state.step += 1;
      renderSteps();
      renderPanel();
      return;
    }
    await activate();
  });
}

init().catch((err) => {
  $("#wizard-panel").innerHTML = `<p class="loading" style="color:var(--danger)">Catalog unavailable: ${escapeHtml(err.message)}</p>`;
});