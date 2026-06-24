/**
 * WASM sandbox access via Lattice Channels (frame-only Unix socket).
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function resolveSocketBase(): string {
  if (process.env.AEP_SOCKET_BASE) return process.env.AEP_SOCKET_BASE;
  const data = process.env.AEP_DATA || join(homedir(), ".aep");
  return join(data, "sockets");
}

function resolveLatticeDb(): string {
  if (process.env.AEP_LATTICE_DB) return process.env.AEP_LATTICE_DB;
  const data = process.env.AEP_DATA || join(homedir(), ".aep");
  return join(data, "action-lattice.db");
}

function resolveConfigPath(): string | undefined {
  const data = process.env.AEP_DATA || join(homedir(), ".aep");
  const path = join(data, "base-node.json");
  return existsSync(path) ? path : undefined;
}

function resolveLatticeLogBin(): string {
  return process.env.AEP_LATTICE_LOG_BIN || process.env.AEP_LATTICE_LOG_CLI || "aep-lattice-log";
}

function wasmSandboxSocket(): string {
  return process.env.WASM_SANDBOX_SOCKET || join(resolveSocketBase(), "wasm_sandbox");
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
  }).trim();
  return JSON.parse(out) as { frame: Record<string, unknown> };
}

function sealAndRecord(event: Record<string, unknown>): Record<string, unknown> {
  const bin = resolveLatticeLogBin();
  const args: string[] = [];
  const configPath = resolveConfigPath();
  if (configPath) args.push("--config", configPath);
  args.push("--db", resolveLatticeDb(), "record");
  const out = execFileSync(bin, args, {
    input: JSON.stringify(event),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
  return JSON.parse(out) as Record<string, unknown>;
}

function sendLatticeLine(socketPath: string, line: string): string {
  const script = `
    const net = require("node:net");
    const path = ${JSON.stringify(socketPath)};
    const payload = ${JSON.stringify(`${line}\n`)};
    const socket = net.connect({ path });
    let buf = "";
    const timer = setTimeout(() => socket.destroy(new Error("lattice socket timeout")), 8000);
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      if (buf.includes("\\n")) {
        clearTimeout(timer);
        process.stdout.write(buf.split("\\n")[0]);
        socket.end();
      }
    });
    socket.on("error", (err) => { clearTimeout(timer); console.error(err.message); process.exit(1); });
  `;
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }).trim();
}

function latticeDockRequest(dockPort: string, event: Record<string, unknown>): void {
  const suffix =
    dockPort === "future_features"
      ? "future"
      : dockPort === "inference_engine"
        ? "inference"
        : dockPort === "regulation_module"
          ? "regulation"
          : "validation";
  const socketPath = join(resolveSocketBase(), suffix);
  const sealed = buildLatticeFrame(event);
  const line = sendLatticeLine(socketPath, JSON.stringify({ frame: sealed.frame }));
  const resp = JSON.parse(line) as { ok?: boolean; error?: string };
  if (!resp.ok) throw new Error(resp.error ?? "lattice frame rejected");
}

export interface WasmEvaluateResult {
  ok: boolean;
  result?: number;
  error?: string;
}

export function wasmLatticeEvaluate(body: { input?: number }): WasmEvaluateResult {
  const event = {
    agent_id: "code-sandbox",
    channel_id: "ch-wasm-sandbox",
    contract_id: "lattice-channel-default",
    event_type: "WASM_EVALUATE",
    session_id: "code-sandbox-evaluate",
    docking_port: "future_features",
    trust_score: 700,
    payload: { input: body.input ?? 0 },
  };
  const recorded = sealAndRecord(event);
  if (!recorded.frame) {
    throw new Error("lattice record did not return frame");
  }
  const line = sendLatticeLine(
    wasmSandboxSocket(),
    JSON.stringify({ frame: recorded.frame, trust_score: 700 }),
  );
  const resp = JSON.parse(line) as WasmEvaluateResult & { ok?: boolean; error?: string };
  if (resp.ok === false) {
    throw new Error(resp.error ?? "wasm lattice frame rejected");
  }
  return resp;
}