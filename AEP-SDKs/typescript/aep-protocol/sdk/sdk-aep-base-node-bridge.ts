// ===========================================================================
// Base Node Lattice Logger - bridges dynAEP events to Rust aep-lattice-log CLI
// (PQEncryptedCapsule frames + AgentMesh bundle + action_lattice_events table)
// ===========================================================================

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveLatticeDbPath } from "./sdk-aep-memory-base-node";
import { createDockingClient } from "./sdk-aep-docking-client";
import type { BaseNodeDockingClient } from "./sdk-aep-docking-client";

export type DockingPortWire =
  | "inference_engine"
  | "validation_engine"
  | "future_features"
  | "pera"
  | "regulation_module";

export interface DynAepLatticeEvent {
  agent_id: string;
  channel_id: string;
  contract_id?: string;
  event_type: string;
  session_id?: string;
  docking_port?: DockingPortWire;
  trust_score?: number;
  payload: Record<string, unknown>;
}

export interface DynAepEventRecord {
  ok: boolean;
  event_id: number;
  frame_digest: string;
  recorded_at_unix: number;
}

export interface BaseNodeLatticeOptions {
  latticeLogCliPath?: string;
  latticeDbPath?: string;
  configPath?: string;
  socketBase?: string;
  defaultAgentId?: string;
  defaultChannelId?: string;
  /** Lattice-channel socket transport is mandatory in AEP 2.8. */
  preferSocket?: boolean;
}

interface BaseNodeConfigFile {
  base_node?: {
    lattice_db?: string;
    binary_path?: string;
  };
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../..");
}

export function resolveLatticeLogCliPath(configPath?: string): string {
  if (process.env.AEP_LATTICE_LOG_BIN) {
    return process.env.AEP_LATTICE_LOG_BIN;
  }
  if (process.env.AEP_LATTICE_LOG_CLI) {
    return process.env.AEP_LATTICE_LOG_CLI;
  }
  const candidates = [
    join(repoRoot(), "rust/target/release/aep-lattice-log"),
    join(repoRoot(), "rust/target/debug/aep-lattice-log"),
    "/usr/local/bin/aep-lattice-log",
  ];
  if (configPath && existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8")) as BaseNodeConfigFile;
      const bin = cfg.base_node?.binary_path;
      if (bin) {
        candidates.unshift(join(dirname(bin), "aep-lattice-log"));
      }
    } catch {
      /* ignore */
    }
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

export function isBaseNodeLatticeAvailable(opts: BaseNodeLatticeOptions = {}): boolean {
  const cli = opts.latticeLogCliPath ?? resolveLatticeLogCliPath(opts.configPath);
  return existsSync(cli);
}

export class BaseNodeLatticeLogger {
  private readonly cli: string;
  private readonly dbPath: string;
  private readonly configPath: string;
  private readonly defaultAgentId: string;
  private readonly defaultChannelId: string;
  private enabled = true;
  private readonly docking: BaseNodeDockingClient | null;
  private readonly preferSocket: boolean;

  constructor(opts: BaseNodeLatticeOptions = {}) {
    this.configPath = opts.configPath ?? join(homedir(), ".aep/base-node.json");
    this.cli = opts.latticeLogCliPath ?? resolveLatticeLogCliPath(this.configPath);
    this.dbPath = opts.latticeDbPath ?? resolveLatticeDbPath(this.configPath);
    this.defaultAgentId = opts.defaultAgentId ?? "dynaep-bridge";
    this.defaultChannelId = opts.defaultChannelId ?? "ch-local-dynaep";
    this.preferSocket = opts.preferSocket !== false;
    if (!existsSync(this.cli)) {
      throw new Error(
        `aep-lattice-log CLI not found at ${this.cli}; build rust release binaries first`,
      );
    }
    this.docking = createDockingClient({
      socketBase: opts.socketBase,
      configPath: this.configPath,
    });
  }

  available(): boolean {
    return this.enabled;
  }

  private run<T>(command: string, input?: unknown, extraArgs: string[] = []): T {
    const args = ["--db", this.dbPath];
    if (existsSync(this.configPath)) {
      args.push("--config", this.configPath);
    }
    args.push(command, ...extraArgs);
    const result = spawnSync(this.cli, args, {
      input: input ? JSON.stringify(input) : undefined,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0 || result.error) {
      throw new Error(
        result.stderr?.trim() ||
          result.stdout?.trim() ||
          result.error?.message ||
          `aep-lattice-log ${command} failed`,
      );
    }
    const stdout = (result.stdout ?? "").trim();
    if (!stdout) {
      return undefined as T;
    }
    return JSON.parse(stdout) as T;
  }

  logEvent(event: DynAepLatticeEvent): DynAepEventRecord {
    const normalized: DynAepLatticeEvent = {
      agent_id: event.agent_id ?? this.defaultAgentId,
      channel_id: event.channel_id ?? this.defaultChannelId,
      contract_id: event.contract_id ?? "dynaep-action-lattice",
      event_type: event.event_type,
      session_id: event.session_id,
      docking_port: event.docking_port ?? "validation_engine",
      trust_score: event.trust_score ?? 700,
      payload: event.payload,
    };
    if (this.preferSocket && this.docking) {
      return this.docking.logEvent(normalized);
    }
    return this.run<DynAepEventRecord>("record", normalized);
  }

  getEventCount(): number {
    if (!this.enabled) return 0;
    try {
      const res = this.run<{ count: number }>("count");
      return res.count;
    } catch {
      this.enabled = false;
      return 0;
    }
  }

  exportEvents(limit: number = 100): unknown[] {
    if (!this.enabled) return [];
    try {
      return this.run<unknown[]>("export", undefined, ["--limit", String(limit)]);
    } catch {
      this.enabled = false;
      return [];
    }
  }
}

export function createDefaultLatticeLogger(
  opts: BaseNodeLatticeOptions = {},
): BaseNodeLatticeLogger {
  return new BaseNodeLatticeLogger(opts);
}