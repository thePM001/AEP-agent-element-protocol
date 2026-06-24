/** Composer Lite settings menu + API key panels (Agent Composer style). */

import { initNeoSelect } from "./neo-select.js";
import { authFetch } from "./setup-auth.js";

const INFERENCE_PROVIDERS = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "anthropic", label: "Anthropic" },
  { value: "llama_cpp", label: "Local llama.cpp" },
  { value: "custom", label: "Custom OpenAI-compatible" },
];

function mountNeoSelect(container, name, options) {
  if (!container || !options.length) return null;
  const initial = options[0];
  container.innerHTML = `
    <div class="neo-select" data-neo-select>
      <input type="hidden" name="${esc(name)}" value="${esc(initial.value)}">
      <button type="button" class="neo-select-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="neo-select-value">${esc(initial.label)}</span>
        <span class="neo-select-chevron" aria-hidden="true"></span>
      </button>
      <div class="neo-select-menu" role="listbox">
        ${options
          .map(
            (o, i) =>
              `<button type="button" role="option" data-value="${esc(o.value)}" aria-selected="${i === 0 ? "true" : "false"}" class="neo-select-option${i === 0 ? " selected" : ""}"><span class="neo-select-option-label">${esc(o.label)}</span></button>`,
          )
          .join("")}
      </div>
    </div>`;
  const root = container.querySelector(".neo-select");
  return initNeoSelect(root);
}

async function api(path, opts = {}) {
  const res = await authFetch(path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PANEL_IDS = [
  "settings-inference-panel",
  "settings-integrations-panel",
  "settings-help-panel",
];

export function initLiteSettings() {
  const menuBtn = document.getElementById("user-settings-btn");
  const menu = document.getElementById("user-settings-menu");
  const inferencePanel = document.getElementById("settings-inference-panel");
  const integrationsPanel = document.getElementById("settings-integrations-panel");
  const helpPanel = document.getElementById("settings-help-panel");
  const inferenceForm = document.getElementById("lite-inference-form");
  const inferenceStatus = document.getElementById("lite-inference-status");
  const integrationsStatus = document.getElementById("lite-integrations-status");
  const integrationsList = document.getElementById("lite-integrations-list");
  const providerSelect = mountNeoSelect(
    document.getElementById("lite-inference-provider-select"),
    "provider",
    INFERENCE_PROVIDERS,
  );

  if (!menuBtn || !menu) return null;

  const closeMenu = () => {
    menu.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  };

  const anyPanelOpen = () =>
    PANEL_IDS.some((id) => {
      const el = document.getElementById(id);
      return el && !el.hidden;
    });

  const closePanels = () => {
    for (const id of PANEL_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.hidden = true;
      el.setAttribute("hidden", "");
    }
    document.body.classList.remove("lite-settings-open");
  };

  const openPanel = (panel) => {
    if (!panel) return;
    closeMenu();
    closePanels();
    panel.hidden = false;
    panel.removeAttribute("hidden");
    document.body.classList.add("lite-settings-open");
  };

  const setInferenceError = (text = "") => {
    if (!inferenceStatus) return;
    if (!text) {
      inferenceStatus.hidden = true;
      inferenceStatus.setAttribute("hidden", "");
      inferenceStatus.textContent = "";
      inferenceStatus.dataset.tone = "";
      return;
    }
    inferenceStatus.hidden = false;
    inferenceStatus.removeAttribute("hidden");
    inferenceStatus.textContent = text;
    inferenceStatus.dataset.tone = "error";
  };

  async function loadInferenceForm() {
    try {
      const state = await api("api/inference");
      const form = inferenceForm;
      if (!form) return;
      const model = form.querySelector('[name="model"]');
      const baseUrl = form.querySelector('[name="base_url"]');
      const apiKey = form.querySelector('[name="api_key"]');
      providerSelect?.setValue(state.provider || "llama_cpp");
      if (model) model.value = state.model || "";
      if (baseUrl) baseUrl.value = state.base_url || "";
      if (apiKey) apiKey.value = "";
      if (apiKey) apiKey.placeholder = "Enter API key";
      setInferenceError();
    } catch (err) {
      setInferenceError(`Load failed: ${err.message}`);
    }
  }

  async function saveInferenceForm(e) {
    e?.preventDefault();
    if (!inferenceForm) return;
    const fd = new FormData(inferenceForm);
    const body = {
      provider: String(fd.get("provider") || "llama_cpp").trim(),
      model: String(fd.get("model") || "").trim(),
      base_url: String(fd.get("base_url") || "").trim(),
      api_key: String(fd.get("api_key") || "").trim(),
    };
    setInferenceError();
    try {
      const result = await api("api/inference", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const inf = result.inference || {};
      const apiKey = inferenceForm.querySelector('[name="api_key"]');
      if (apiKey) {
        apiKey.value = "";
        apiKey.placeholder = "Enter API key";
      }
    } catch (err) {
      setInferenceError(err.message);
    }
  }

  async function loadIntegrations() {
    if (!integrationsList) return;
    integrationsList.innerHTML = `<li class="settings-empty">Loading…</li>`;
    try {
      const data = await api("api/integrations");
      const items = [];
      if (data.agentstream) items.push(data.agentstream);
      if (Array.isArray(data.connectors)) items.push(...data.connectors);
      if (!items.length) {
        integrationsList.innerHTML = '<li class="settings-empty">No integrations probed.</li>';
        if (integrationsStatus) integrationsStatus.textContent = "Configure via environment variables on the base node.";
        return;
      }
      integrationsList.innerHTML = items
        .map((c) => {
          const online = c.connected || c.online;
          const status = online ? "online" : c.configured ? "offline" : "standby";
          return `<li class="integration-row">
            <span class="integration-name">${esc(c.label || c.service || c.id)}</span>
            <span class="integration-status ${status}">${esc(c.status || (online ? "connected" : "offline"))}</span>
          </li>`;
        })
        .join("");
      if (integrationsStatus) {
        integrationsStatus.textContent = "Agentstream URL: set AGENTSTREAM_URL on the base node host.";
      }
    } catch (err) {
      integrationsList.innerHTML = `<li class="settings-empty">${esc(err.message)}</li>`;
    }
  }

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    menuBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn) closeMenu();
  });

  document.getElementById("set-open-inference")?.addEventListener("click", () => {
    openPanel(inferencePanel);
    loadInferenceForm();
  });
  document.getElementById("set-open-integrations")?.addEventListener("click", () => {
    openPanel(integrationsPanel);
    loadIntegrations();
  });
  document.getElementById("set-open-help")?.addEventListener("click", () => {
    openPanel(helpPanel);
  });

  document.querySelectorAll("[data-settings-close]").forEach((btn) => {
    btn.addEventListener("click", () => closePanels());
  });

  inferenceForm?.addEventListener("submit", saveInferenceForm);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (anyPanelOpen()) closePanels();
      else closeMenu();
    }
  });

  return { closePanels, loadInferenceForm };
}