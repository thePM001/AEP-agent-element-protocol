/** Remote setup token from ?setup_token= (required when Composer Lite is not loopback-only). */

export function setupAuthHeaders() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("setup_token")?.trim() || "";
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