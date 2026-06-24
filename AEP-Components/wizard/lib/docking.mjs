#!/usr/bin/env node
/**
 * Unix socket helpers for Base Node docking ports (Lattice Channel frame-only).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  DOCK_SUFFIXES,
  buildLatticeFrame,
  dockPaths,
  latticeDockRequest,
  parseLatticeDockLine,
  sendLatticeFrame,
  sendLatticeLine,
} from "../../lattice-channels/lib/lattice-transport.mjs";

export { DOCK_SUFFIXES, dockPaths, buildLatticeFrame, sendLatticeLine };

export function sendDockLine(socketPath, line, timeoutMs = 5000) {
  return sendLatticeLine(socketPath, line, timeoutMs);
}

export function pingDock(socketPath, opts = {}) {
  const dockPort = opts.dockPort ?? "validation_engine";
  const sealed = buildLatticeFrame(
    {
      agent_id: opts.agentId ?? "setup-agent",
      channel_id: "ch-lattice-health",
      contract_id: "lattice-channel-default",
      event_type: "LATTICE_HEALTH_PING",
      session_id: opts.sessionId ?? "wizard-health",
      docking_port: dockPort,
      trust_score: opts.trustScore ?? 700,
      payload: { probe: true },
    },
    opts,
  );
  const resp = sendLatticeFrame(socketPath, sealed.frame, {
    ...opts,
    signerPublicHex: sealed.signer_public_hex,
  });
  return resp.ok === true;
}

export function pingAllDocks(socketBase, opts = {}) {
  const dockOpts = {
    ...opts,
    configPath: opts.configPath ?? opts.config_path,
  };
  const results = [];
  for (const dock of dockPaths(socketBase)) {
    const listening = existsSync(dock.path);
    let pong = false;
    if (listening) {
      try {
        pong = pingDock(dock.path, { ...dockOpts, dockPort: dock.port });
      } catch {
        pong = false;
      }
    }
    results.push({ port: dock.port, path: dock.path, listening, pong });
  }
  return results;
}

export async function waitForDocks(socketBase, timeoutMs = 30000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const docks = dockPaths(socketBase);
    if (docks.every((d) => existsSync(d.path))) {
      return true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export function recordActivationEvent(socketBase, agentId = "setup-agent", opts = {}) {
  return latticeDockRequest(
    socketBase,
    "validation_engine",
    {
      agent_id: agentId,
      channel_id: "ch-setup-activation",
      contract_id: "dynaep-action-lattice",
      event_type: "SETUP_ACTIVATION",
      session_id: "setup-session",
      docking_port: "validation_engine",
      trust_score: 700,
      payload: { phase: "activation", ok: true },
    },
    opts,
  );
}