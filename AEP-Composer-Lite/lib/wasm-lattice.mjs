#!/usr/bin/env node
/**
 * WASM sandbox access exclusively via Lattice Channels (Unix socket, frame-only).
 */

import {
  buildLatticeFrame,
  latticeHealthPing,
  latticeStrictEnabled,
  sealAndRecordLatticeEvent,
  sendLatticeFrame,
  wasmSandboxSocket,
} from "../../AEP-Components/lattice-channels/lib/lattice-transport.mjs";

function wasmEvaluateEvent(body) {
  return {
    agent_id: "composer-lite",
    channel_id: "ch-wasm-sandbox",
    contract_id: "lattice-channel-default",
    event_type: "WASM_EVALUATE",
    session_id: "wasm-evaluate",
    docking_port: "future_features",
    trust_score: 700,
    payload: {
      input: body.input ?? 0,
    },
  };
}

export function wasmLatticeHealth(runtime) {
  const socketPath = wasmSandboxSocket(runtime.socketBase);
  const sealed = buildLatticeFrame(
    {
      agent_id: "composer-lite",
      channel_id: "ch-wasm-health",
      contract_id: "lattice-channel-default",
      event_type: "LATTICE_HEALTH_PING",
      session_id: "wasm-health",
      docking_port: "future_features",
      trust_score: 700,
      payload: { service: "aep-wasm-sandbox" },
    },
    { configPath: runtime.configPath },
  );
  return sendLatticeFrame(socketPath, sealed.frame, {
    trustScore: 700,
    signerPublicHex: sealed.signer_public_hex,
  });
}

export async function wasmLatticeEvaluate(runtime, body) {
  if (!latticeStrictEnabled()) {
    throw new Error("WASM evaluate requires AEP_LATTICE_STRICT=1 lattice channel transport");
  }
  const event = wasmEvaluateEvent(body);
  const recorded = sealAndRecordLatticeEvent(event, {
    configPath: runtime.configPath,
    latticeDb: runtime.latticeDb,
  });
  const socketPath = wasmSandboxSocket(runtime.socketBase);
  return sendLatticeFrame(socketPath, recorded.frame, { trustScore: 700 });
}

export function probeWasmSandbox(runtime) {
  try {
    latticeHealthPing(runtime.socketBase, "validation_engine", {
      configPath: runtime.configPath,
      agentId: "composer-lite",
    });
    const health = wasmLatticeHealth(runtime);
    return { ok: health.ok === true, ...health };
  } catch (err) {
    return { ok: false, status: "down", error: err.message };
  }
}