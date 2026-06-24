// ===========================================================================
// Base Node Docking Client - Unix socket transport to validation dock
// ===========================================================================

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { docking_port_specs } from "./sdk-aep-docking-spec";
import type { DynAepLatticeEvent, DynAepEventRecord } from "./sdk-aep-base-node-bridge";

export interface DockFrameResponse {
  ok: boolean;
  event_id?: number;
  digest?: string;
  error?: string;
  pong?: boolean;
}

export interface DockingClientOptions {
  socketBase?: string;
  configPath?: string;
}

interface BaseNodeConfigFile {
  base_node?: {
    socket_base?: string;
  };
}

export function resolveSocketBase(configPath?: string): string {
  if (process.env.AEP_SOCKET_BASE) {
    return process.env.AEP_SOCKET_BASE;
  }
  const path = configPath ?? join(homedir(), ".aep/base-node.json");
  if (existsSync(path)) {
    try {
      const cfg = JSON.parse(readFileSync(path, "utf8")) as BaseNodeConfigFile;
      if (cfg.base_node?.socket_base) {
        return cfg.base_node.socket_base;
      }
    } catch {
      /* ignore */
    }
  }
  return "/tmp/aep-base-node.sock";
}

export function validationDockPath(socketBase?: string, configPath?: string): string {
  const base = socketBase ?? resolveSocketBase(configPath);
  const spec = docking_port_specs(base).find((p) => p.port === "validation_engine");
  return spec?.listen_path ?? join(base, "validation");
}

function sendLineAsync(socketPath: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buf += chunk;
      if (buf.includes("\n")) {
        socket.end();
        resolve(buf.split("\n")[0]);
      }
    });
    socket.on("error", reject);
    socket.on("connect", () => {
      socket.write(`${line}\n`);
    });
    socket.on("end", () => {
      if (buf) resolve(buf.split("\n")[0]);
    });
  });
}

/** Subprocess socket I/O so the main event loop is not blocked by Atomics.wait. */

function latticeStrictEnabled(): boolean {
  return (process.env.AEP_LATTICE_STRICT ?? "1") !== "0";
}

function resolveLatticeLogBin(): string {
  if (process.env.AEP_LATTICE_LOG_BIN) return process.env.AEP_LATTICE_LOG_BIN;
  return process.env.AEP_LATTICE_LOG_CLI || "aep-lattice-log";
}

function buildLatticeFrame(event: DynAepLatticeEvent): {
  frame: Record<string, unknown>;
  signer_public_hex?: string;
} {
  const bin = resolveLatticeLogBin();
  const input = JSON.stringify({
    agent_id: event.agent_id,
    channel_id: event.channel_id,
    contract_id: event.contract_id ?? "dynaep-action-lattice",
    event_type: event.event_type,
    session_id: event.session_id,
    docking_port: event.docking_port ?? "validation_engine",
    trust_score: event.trust_score ?? 700,
    payload: event.payload,
  });
  const out = execFileSync(bin, ["build-frame"], {
    input,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
  const parsed = JSON.parse(out) as {
    frame: Record<string, unknown>;
    signer_public_hex?: string;
  };
  if (!parsed.frame) {
    throw new Error("aep-lattice-log build-frame did not return a LatticeChannelFrame");
  }
  return parsed;
}

function frameWirePayload(sealed: {
  frame: Record<string, unknown>;
  signer_public_hex?: string;
}): string {
  return JSON.stringify({
    frame: sealed.frame,
    ...(sealed.signer_public_hex ? { signer_public_hex: sealed.signer_public_hex } : {}),
  });
}

function sendLineSync(socketPath: string, line: string, timeoutMs = 5000): string {
  const script = `
    const net = require("node:net");
    const path = ${JSON.stringify(socketPath)};
    const payload = ${JSON.stringify(`${line}\n`)};
    const timeout = ${timeoutMs};
    const socket = net.connect({ path });
    let buf = "";
    const timer = setTimeout(() => {
      socket.destroy(new Error("docking socket timeout"));
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
  return execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

export class BaseNodeDockingClient {
  private readonly validationPath: string;

  constructor(opts: DockingClientOptions = {}) {
    this.validationPath = validationDockPath(opts.socketBase, opts.configPath);
  }

  get validationSocketPath(): string {
    return this.validationPath;
  }

  available(): boolean {
    return existsSync(this.validationPath);
  }

  ping(): boolean {
    const sealed = buildLatticeFrame({
      agent_id: "aep-docking-client",
      channel_id: "ch-lattice-health",
      contract_id: "lattice-channel-default",
      event_type: "LATTICE_HEALTH_PING",
      session_id: "health-check",
      docking_port: "validation_engine",
      trust_score: 700,
      payload: { probe: true },
    });
    const line = sendLineSync(this.validationPath, frameWirePayload(sealed));
    const resp = JSON.parse(line) as DockFrameResponse;
    return resp.ok === true;
  }

  logEvent(event: DynAepLatticeEvent): DynAepEventRecord {
    const sealed = buildLatticeFrame({
      agent_id: event.agent_id,
      channel_id: event.channel_id,
      contract_id: event.contract_id ?? "dynaep-action-lattice",
      event_type: event.event_type,
      session_id: event.session_id,
      docking_port: event.docking_port ?? "validation_engine",
      trust_score: event.trust_score ?? 700,
      payload: event.payload,
    });
    const line = sendLineSync(this.validationPath, frameWirePayload(sealed));
    const resp = JSON.parse(line) as DockFrameResponse;
    if (!resp.ok) {
      throw new Error(resp.error ?? "docking event rejected");
    }
    return {
      ok: true,
      event_id: resp.event_id ?? 0,
      frame_digest: resp.digest ?? "",
      recorded_at_unix: Math.floor(Date.now() / 1000),
    };
  }

  async pingAsync(): Promise<boolean> {
    const sealed = buildLatticeFrame({
      agent_id: "aep-docking-client",
      channel_id: "ch-lattice-health",
      contract_id: "lattice-channel-default",
      event_type: "LATTICE_HEALTH_PING",
      session_id: "health-check",
      docking_port: "validation_engine",
      trust_score: 700,
      payload: { probe: true },
    });
    const line = await sendLineAsync(
      this.validationPath,
      JSON.stringify({ frame: sealed.frame }),
    );
    const resp = JSON.parse(line) as DockFrameResponse;
    return resp.ok === true;
  }
}

export function createDockingClient(
  opts: DockingClientOptions = {},
): BaseNodeDockingClient | null {
  const client = new BaseNodeDockingClient(opts);
  return client.available() ? client : null;
}