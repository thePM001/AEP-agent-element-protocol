/* Composer Lite API client — internal LatticeStore paths with /api prefix */
(function (global) {
  function apiBase() {
    const base = document.querySelector("base")?.href;
    if (base) return new URL(".", base).href.replace(/\/$/, "");
    return (document.documentElement.dataset.apiBase || "").replace(/\/$/, "");
  }

  async function fetchJson(path, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${apiBase()}${path}`, { ...options, signal: controller.signal });
    } catch (err) {
      if (err?.name === "AbortError") throw new Error(`${path} timed out after ${timeoutMs}ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`bad JSON from ${path}`);
    }
    if (!res.ok) throw new Error(data.error || data.message || `${path} ${res.status}`);
    return data;
  }

  global.LatticeStore = {
    apiBase,
    async integrationAction(connectorId, action, payload = {}) {
      return fetchJson(`/api/integration/hub/${encodeURIComponent(connectorId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
    },
    async fabricTraces(limit = 100) {
      return fetchJson(`/api/fabric/traces?limit=${encodeURIComponent(limit)}`);
    },
  };
})(window);