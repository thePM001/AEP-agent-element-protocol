/** AEP 84xx port policy - see AEP-Docks/docs/AEP-PORT-POLICY.md */

export const COMPOSER_LITE_DEFAULT_PORT = 8424;

/** Ports that MUST never be used (AEP policy violations). */
export const DISALLOWED_PORTS = new Set([28780]);

export function resolveComposerLitePort(env = process.env) {
  const raw = env.COMPOSER_LITE_PORT ?? String(COMPOSER_LITE_DEFAULT_PORT);
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid COMPOSER_LITE_PORT: ${raw}`);
  }
  if (DISALLOWED_PORTS.has(port)) {
    throw new Error(
      `Port ${port} is DISALLOWED per AEP policy. Use ${COMPOSER_LITE_DEFAULT_PORT} (see AEP-Docks/docs/AEP-PORT-POLICY.md).`,
    );
  }
  if (port < 8400 || port > 8499) {
    throw new Error(
      `Port ${port} is outside the AEP 84xx service mesh (8400-8499).`,
    );
  }
  return port;
}