export function composerLiteBasePath(env = process.env) {
  const raw = env.COMPOSER_LITE_BASE_PATH ?? "";
  const trimmed = String(raw).trim().replace(/\/$/, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Strip reverse-proxy prefix so handlers always see /api/... and /install. */
export function stripComposerLiteBasePath(pathname, env = process.env) {
  const path = String(pathname ?? "/");
  const base = composerLiteBasePath(env);
  if (!base) return path || "/";
  if (path === base) return "/";
  if (path.startsWith(`${base}/`)) {
    const stripped = path.slice(base.length);
    return stripped.startsWith("/") ? stripped : `/${stripped}`;
  }
  return path;
}