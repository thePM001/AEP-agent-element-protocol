/** Composer Lite setup token for API calls (header only; never leave token in URL long-term). */

const TOKEN_STORAGE_KEY = "aep_composer_lite_setup_token";

function captureSetupTokenFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("setup_token")?.trim() || "";
    if (!q) return;
    // Prefer header-backed storage; remove token from URL to limit Referer/history leaks.
    try {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, q);
    } catch {
      /* private mode */
    }
    params.delete("setup_token");
    const qs = params.toString();
    const next = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
    window.history.replaceState({}, "", next);
  } catch {
    /* ignore */
  }
}

captureSetupTokenFromQuery();

export function setupAuthHeaders() {
  let token = "";
  try {
    token = sessionStorage.getItem(TOKEN_STORAGE_KEY)?.trim() || "";
  } catch {
    token = "";
  }
  if (!token) {
    const params = new URLSearchParams(window.location.search);
    token = params.get("setup_token")?.trim() || "";
  }
  if (!token) return {};
  return { "X-AEP-Setup-Token": token };
}

export function authFetch(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const headers = {
    ...(!isForm && opts.body ? { "Content-Type": "application/json" } : {}),
    ...setupAuthHeaders(),
    ...(opts.headers || {}),
  };
  return fetch(path, { ...opts, headers });
}
