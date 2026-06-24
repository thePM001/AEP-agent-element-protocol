#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { invokeCodingGovernanceRust } from "../../../AEP-SDKs/typescript/aep-protocol/lib/subprotocol-rust.mjs";
import { explainIntent } from "../../intent-ledger/lib/ledger.mjs";
import { expandHome, defaultPaths } from "../../wizard/lib/paths.mjs";
import {
  loadTaskManifest,
  saveTaskManifest,
  mergeCodingGovernanceIntoManifest,
  resolveTaskManifestDir,
} from "./task-manifest.mjs";
import {
  sealAndRecordLatticeEvent,
  latticeStrictEnabled,
  normalizeDockPort,
} from "../../lattice-channels/lib/lattice-transport.mjs";
import { recordIntentKnot } from "../../intent-ledger/lib/intent-knots.mjs";

function loadProposeToken(dataDir, intentId) {
  const active = join(dataDir, "tokens", "active-propose.json");
  if (!existsSync(active)) return null;
  try {
    const token = JSON.parse(readFileSync(active, "utf8"));
    return token.intent_id === intentId ? token : null;
  } catch {
    return null;
  }
}

/**
 * Announce coding intent on lattice, bound to agent_id + task manifest.
 * @param {object} opts
 */
export function runAnnounce({
  agentId,
  intentId,
  dataDir = expandHome(defaultPaths().dataDir),
  threadId,
  correlationId,
  sessionId,
  trustScore,
  syncManifest = true,
  recordOnly = true,
  configPath,
  latticeDb,
  socketBase,
  dockingPort = "validation_engine",
  taskManifest: providedManifest,
}) {
  const intent = explainIntent(dataDir, intentId);
  if (!intent.declaration) {
    return {
      valid: false,
      errors: [`no intent snapshot for ${intentId}; run aep propose first`],
      frame: null,
    };
  }

  let taskManifest = providedManifest;
  let taskManifestPath = null;
  if (!taskManifest) {
    const loaded = loadTaskManifest(agentId, dataDir);
    taskManifest = loaded.manifest;
    taskManifestPath = loaded.path;
  }

  if (syncManifest || !taskManifest) {
    taskManifest = mergeCodingGovernanceIntoManifest(taskManifest, {
      agentId,
      intentId,
      sessionId: sessionId ?? taskManifest?.session_id,
      declaration: intent.declaration,
      blastRadius: intent.blast_radius,
    });
    taskManifestPath = saveTaskManifest(taskManifest, dataDir);
  }

  const proposeToken = loadProposeToken(dataDir, intentId);
  const payload = {
    agent_id: agentId,
    intent_id: intentId,
    task_manifest: taskManifest,
    thread_id: threadId,
    correlation_id: correlationId ?? threadId,
    session_id: sessionId ?? taskManifest.session_id,
    trust_score: trustScore ?? taskManifest.trust?.max_trust_score ?? 700,
    docking_port: dockingPort,
  };

  const validation = invokeCodingGovernanceRust("announce", payload);
  if (!validation.valid) {
    return { validation, entry: null, frame: null, task_manifest: taskManifest };
  }

  const detail = validation.detail ?? {};
  const event = {
    agent_id: agentId,
    channel_id: "ch-coding-governance",
    contract_id: "dynaep-action-lattice",
    event_type: "CODING_GOVERNANCE_ANNOUNCE",
    session_id: sessionId ?? taskManifest.session_id ?? `announce-${intentId}`,
    docking_port: normalizeDockPort(dockingPort),
    trust_score: detail.trust_score ?? payload.trust_score,
    payload: {
      intent_id: intentId,
      task_manifest_id: taskManifest.id,
      agent_id: agentId,
      thread_id: threadId ?? null,
      correlation_id: correlationId ?? threadId ?? null,
      coding_intent: intent.declaration,
      blast_radius: intent.blast_radius,
      propose_token_hash: proposeToken?.blast_radius_hash ?? null,
      task_manifest: taskManifest,
    },
  };

  let recorded = null;
  try {
    recorded = sealAndRecordLatticeEvent(event, { configPath, latticeDb });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (latticeStrictEnabled() && !recordOnly) {
      return {
        validation,
        entry: null,
        frame: null,
        task_manifest: taskManifest,
        lattice_error: message,
      };
    }
    recorded = { ok: true, record_only: true, error: message, event };
  }

  const intentKnot = recordIntentKnot(
    "announce",
    {
      intentId,
      agentId,
      statement: intent.declaration?.statement,
      blastRadius: intent.blast_radius,
      proposeToken,
      taskManifestId: taskManifest.id,
      threadId,
      sessionId: sessionId ?? taskManifest.session_id,
    },
    { dataDir },
  );

  return {
    validation,
    detail,
    task_manifest: taskManifest,
    task_manifest_path: taskManifestPath,
    lattice: recorded,
    event,
    intent_knot: intentKnot,
  };
}