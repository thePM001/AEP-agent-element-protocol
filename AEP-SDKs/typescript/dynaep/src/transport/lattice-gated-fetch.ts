/**
 * AEP 2.8 Lattice-gated outbound HTTP - all external calls audit via inference_engine dock.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface LatticeGatewayMeta {
  agentId?: string;
  channelId?: string;
  contractId?: string;
  eventType?: string;
  sessionId?: string;
  trustScore?: number;
  gateway?: string;
  payloadExtra?: Record<string, unknown>;
}

function latticeStrictEnabled(): boolean {
  return (process.env.AEP_LATTICE_STRICT ?? "1") !== "0";
}

function resolveSocketBase(): string {
  if (process.env.AEP_SOCKET_BASE) return process.env.AEP_SOCKET_BASE;
  const data = process.env.AEP_DATA || join(homedir(), ".aep");
  return join(data, "sockets");
}

function resolveLatticeLogBin(): string {
  return process.env.AEP_LATTICE_LOG_BIN || process.env.AEP_LATTICE_LOG_CLI || "aep-lattice-log";
}

function resolveConfigPath(): string | undefined {
  const data = process.env.AEP_DATA || join(homedir(), ".aep");
  const path = join(data, "base-node.json");
  return existsSync(path) ? path : undefined;
}

function buildLatticeFrame(event: Record<string, unknown>): { frame: Record<string, unknown> } {
  const bin = resolveLatticeLogBin();
  const args: string[] = [];
  const configPath = resolveConfigPath();
  if (configPath) args.push("--config", configPath);
  args.push("build-frame");
  const out = execFileSync(bin, args, {
    input: JSON.stringify(event),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const outText = typeof out === "string" ? out : out.toString("utf8");
  const parsed = JSON.parse(outText.trim()) as { frame?: Record<string, unknown> };
  if (!parsed.frame) {
    throw new Error("aep-lattice-log build-frame missing LatticeChannelFrame");
  }
  return parsed as { frame: Record<string, unknown> };
}

function sendLatticeLine(socketPath: string, line: string, timeoutMs = 8000): string {
  if (!existsSync(socketPath)) {
    throw new Error(`lattice socket not found: ${socketPath}`);
  }
  const script = `
    const net = require("node:net");
    const path = ${JSON.stringify(socketPath)};
    const payload = ${JSON.stringify(`${line}\n`)};
    const timeout = ${timeoutMs};
    const socket = net.connect({ path });
    let buf = "";
    const timer = setTimeout(() => {
      socket.destroy(new Error("lattice socket timeout"));
    }, timeout);
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      if (buf.includes("\\n")) {
        clearTimeout(timer);
        process.stdout.write(buf.split("\\n")[0]);
        socket.end();
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      console.error(err.message);
      process.exit(1);
    });
  `;
  const response = execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return (typeof response === "string" ? response : response.toString("utf8")).trim();
}

function latticeDockRequest(
  socketBase: string,
  dockPort: string,
  event: Record<string, unknown>,
): void {
  const suffix =
    dockPort === "inference_engine"
      ? "inference"
      : dockPort === "validation_engine"
        ? "validation"
        : dockPort === "future_features"
          ? "future"
          : dockPort === "regulation_module"
            ? "regulation"
            : dockPort;
  const socketPath = join(socketBase, suffix);
  const sealed = buildLatticeFrame(event);
  const wire = JSON.stringify({ frame: sealed.frame });
  const line = sendLatticeLine(socketPath, wire);
  const resp = JSON.parse(line) as { ok?: boolean; error?: string };
  if (!resp.ok) {
    throw new Error(resp.error ?? "lattice frame rejected");
  }
}

export async function latticeGatedFetch(
  url: string | URL,
  init: RequestInit = {},
  meta: LatticeGatewayMeta = {},
  socketBase?: string,
): Promise<Response> {
  if (!latticeStrictEnabled()) {
    return fetch(url, init);
  }
  const base = socketBase ?? resolveSocketBase();
  const event = {
    agent_id: meta.agentId ?? "lattice-gateway",
    channel_id: meta.channelId ?? "ch-outbound-gateway",
    contract_id: meta.contractId ?? "lattice-channel-default",
    event_type: meta.eventType ?? "LATTICE_GATEWAY_REQUEST",
    session_id: meta.sessionId ?? "gateway-session",
    docking_port: "inference_engine",
    trust_score: meta.trustScore ?? 750,
    payload: {
      url: String(url),
      method: init.method ?? "GET",
      gateway: meta.gateway ?? "http",
      ...(meta.payloadExtra ?? {}),
    },
  };
  const inferencePath = join(base, "inference");
  latticeDockRequest(base, "inference_engine", event);
  if (!existsSync(inferencePath)) {
    throw new Error(
      `inference_engine dock required for lattice-gated fetch: ${inferencePath}`,
    );
  }
  return fetch(url, init);
}