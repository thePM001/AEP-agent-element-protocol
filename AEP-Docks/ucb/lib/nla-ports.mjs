/** NLA 84xx port policy - UCB secured dock. See docs/NLA-PORT-POLICY.md */

export const UCB_DEFAULT_PORT = 8412;

export const DISALLOWED_PORTS = new Set([28780]);

export function resolveUcbPort(env = process.env) {
  const raw = env.UCB_PORT ?? String(UCB_DEFAULT_PORT);
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid UCB_PORT: ${raw}`);
  }
  if (DISALLOWED_PORTS.has(port)) {
    throw new Error(
      `Port ${port} is DISALLOWED per NLA policy. Use ${UCB_DEFAULT_PORT}.`,
    );
  }
  if (port < 8400 || port > 8499) {
    throw new Error(`Port ${port} is outside the NLA 84xx service mesh (8400-8499).`);
  }
  return port;
}