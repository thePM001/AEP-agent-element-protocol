// @PAD: aep28-env-024-live-wire-v1
// @GCDE: gaplune-decode hmac-sha256:06827ec2297b2ec9bca467d50b93f689790ce1832e3b65da038e8113b6beff8c
import type { ActionLattice } from "../protocol/action-lattice.js";
const LIVE_PATH =
  "Admit collect-all walls then Apply: product live path is Rust aep-live-entry (aep_envelope::admit in-process)";
export function resolveEnvelopeBin(): string {
  throw new Error(LIVE_PATH);
}
export type EnvelopeSnapExtras = {
  max_drift_ms?: number;
  max_age_ms?: number;
  max_future_ms?: number;
  last_seq_by_agent?: Record<string, number>;
  forecast_require_approval?: boolean;
  forecast_anomaly_threshold?: number;
  forecast_cached_score?: number;
  scanner_needles?: string[];
};
export function snapshotFromLattice(lattice: ActionLattice, satisfied: string[], bridgeTsMs: number, extras?: EnvelopeSnapExtras) {
  const lattice_nodes: Record<string, { action_path: string; parents: string[]; trust_floor: number; category: string }> = {};
  for (const id of lattice.allActions()) {
    const n = lattice.get(id);
    if (!n) continue;
    lattice_nodes[id] = { action_path: id, parents: n.parents ?? [], trust_floor: n.trust_floor ?? 1, category: String(n.category ?? "") };
  }
  return { lattice_nodes, satisfied_actions: satisfied.slice(), bridge_ts_ms: bridgeTsMs, gap_scan_payload: true, max_actions_per_minute: 200, event_rate_max: 200, actions_last_minute: 0, event_rate: 0, max_drift_ms: extras?.max_drift_ms ?? 50, max_age_ms: extras?.max_age_ms ?? 5000, max_future_ms: extras?.max_future_ms ?? 500, last_seq_by_agent: extras?.last_seq_by_agent ?? {}, forecast_require_approval: extras?.forecast_require_approval ?? false, forecast_anomaly_threshold: extras?.forecast_anomaly_threshold ?? 3.0, forecast_cached_score: extras?.forecast_cached_score ?? 0, scanner_needles: extras?.scanner_needles ?? [] };
}
export function runEnvelopeAdmit(action: unknown, snapshot: unknown) {
  void action;
  void snapshot;
  throw new Error(LIVE_PATH);
}
export function closedReasons(result: { closed_walls?: Array<{ name: string; reason: string; open: boolean }> }) {
  return (result.closed_walls ?? []).filter((w) => w && w.open === false).map((w) => w.reason || w.name);
}
