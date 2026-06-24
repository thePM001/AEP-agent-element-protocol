/** Lite API client mirroring internal LatticeStore policy-panel calls. */

function apiBase() {
  const base = document.querySelector("base")?.href;
  if (base) return new URL(".", base).href.replace(/\/$/, "");
  return `${location.origin}${location.pathname.replace(/\/[^/]*$/, "")}`.replace(/\/$/, "");
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${apiBase()}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || String(res.status));
  return data;
}

export const LiteLatticeStore = {
  async fabricTraces(limit = 100) {
    return fetchJson(`/api/fabric/traces?limit=${encodeURIComponent(limit)}`);
  },
  async integrationAction(connectorId, action, payload = {}) {
    return fetchJson(`/api/integration/hub/${encodeURIComponent(connectorId)}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
  },
};

export function liteApiBase() {
  return apiBase();
}