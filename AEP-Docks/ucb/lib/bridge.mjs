import {
  buildLatticeFrame,
  dockPath,
  normalizeDockPort,
  sealAndRecordLatticeEvent,
  sendLatticeFrame,
} from "../../lattice-channels/lib/lattice-transport.mjs";
import { translateForeignIngest } from "./translator.mjs";
import { validateForeignIngest } from "./validator.mjs";
import {
  appendDiffRecord,
  listDiffRecords,
  peekDiffRecords,
  popDiffRecords,
  withJournalLock,
} from "./diff-journal.mjs";

export async function ingestForeignPayload(body, runtime, context = {}) {
  const prior = listDiffRecords(runtime.dataDir, { limit: 200 }).map(
    (e) => e.binding_fingerprint,
  );
  const validation = validateForeignIngest(body, {
    prior_fingerprints: prior.filter(Boolean),
    ...context,
  });
  if (!validation.ok) {
    return {
      ok: false,
      status: "rejected",
      validation,
    };
  }

  const event = translateForeignIngest(body, {
    agentId: "ucb-bridge",
    trustScore: 650,
  });

  const dockPort = normalizeDockPort(event.docking_port ?? "validation_engine");
  const socketPath = dockPath(runtime.socketBase, dockPort);
  const latticeOpts = {
    configPath: runtime.configPath,
    latticeDb: runtime.latticeDb,
    latticeLogBin: runtime.latticeLogBin,
  };

  let built;
  let docked;
  try {
    built = buildLatticeFrame(event, latticeOpts);
    docked = sendLatticeFrame(socketPath, built.frame, {
      trustScore: event.trust_score,
    });
  } catch (err) {
    return {
      ok: false,
      status: "rejected",
      validation,
      error: err.message ?? String(err),
    };
  }

  const recorded = sealAndRecordLatticeEvent(event, latticeOpts);

  const diff = await withJournalLock(() =>
    appendDiffRecord(runtime.dataDir, {
      operation: "extend_write",
      event_id: recorded.event_id ?? docked.event_id,
      frame_digest: recorded.frame_digest ?? docked.digest ?? built.digest,
      binding_fingerprint: event.payload.binding_fingerprint,
      foreign_protocol: event.payload.foreign_protocol,
      session_id: event.session_id,
      snapshot: {
        agent_id: event.agent_id,
        event_type: event.event_type,
        payload: event.payload,
      },
    }),
  );

  return {
    ok: true,
    status: "integrated",
    validation,
    event_id: recorded.event_id ?? docked.event_id,
    frame_digest: recorded.frame_digest ?? docked.digest,
    diff_id: diff.diff_id,
    lattice_event: event,
  };
}

export async function rollbackForeignIntegrations(steps, runtime) {
  const peeked = await withJournalLock(() =>
    peekDiffRecords(runtime.dataDir, steps),
  );
  if (peeked.count === 0) {
    return { ok: false, error: "no diff records to rollback", rolled_back: 0 };
  }

  const rollbackEvent = {
    agent_id: "ucb-bridge",
    channel_id: "ch-ucb-rollback",
    contract_id: "dynaep-action-lattice",
    event_type: "UCB_ROLLBACK",
    session_id: `ucb-rollback-${Date.now()}`,
    docking_port: "validation_engine",
    trust_score: 800,
    payload: {
      rolled_back: peeked.count,
      diff_ids: peeked.records.map((r) => r.diff_id),
      reverted_event_ids: peeked.records.map((r) => r.event_id).filter(Boolean),
      bridge: "ucb/2.8.0",
    },
  };

  const latticeOpts = {
    configPath: runtime.configPath,
    latticeDb: runtime.latticeDb,
    latticeLogBin: runtime.latticeLogBin,
  };

  let recorded;
  try {
    const built = buildLatticeFrame(rollbackEvent, latticeOpts);
    const socketPath = dockPath(runtime.socketBase, "validation_engine");
    sendLatticeFrame(socketPath, built.frame, {
      trustScore: rollbackEvent.trust_score,
    });
    recorded = sealAndRecordLatticeEvent(rollbackEvent, latticeOpts);
  } catch (err) {
    return {
      ok: false,
      error: err.message ?? String(err),
      rolled_back: 0,
    };
  }

  const popped = await withJournalLock(() =>
    popDiffRecords(runtime.dataDir, steps),
  );

  return {
    ok: true,
    status: "rolled_back",
    rolled_back: popped.rolled_back,
    diff_ids: popped.records.map((r) => r.diff_id),
    event_id: recorded.event_id,
    frame_digest: recorded.frame_digest,
  };
}