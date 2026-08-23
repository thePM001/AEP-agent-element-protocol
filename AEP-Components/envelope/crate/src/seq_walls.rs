// @PAD: aep-envelope-seq-walls-v1
// @GCDE: gaplune.policy.v1
// AEP28-ENV-022: fold causal and forecast denies into envelope walls.
use crate::EnvelopeAction;
use crate::Snapshot;
use crate::WallVerdict;
fn wall(name: &str, family: &str, open: bool, reason: &str) -> WallVerdict {
  WallVerdict { name: name.to_string(), family: family.to_string(), open, reason: reason.to_string() }
}
pub fn wall_causal(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
  if action.sequence_number == 0 || action.agent_id.is_empty() {
    return wall("causal.sequence", "causal", true, "no sequence bound");
  }
  match snap.last_seq_by_agent.get(&action.agent_id) {
    Some(last) if action.sequence_number < *last => wall("causal.sequence", "causal", false, "agent clock regression"),
    _ => wall("causal.sequence", "causal", true, "causal open"),
  }
}
pub fn wall_forecast(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
  if snap.forecast_require_approval == false {
    return wall("forecast.anomaly", "forecast", true, "approval not required");
  }
  let score = if action.anomaly_score != 0.0 { action.anomaly_score } else { snap.forecast_cached_score };
  if score >= snap.forecast_anomaly_threshold && score > 0.0 {
    wall("forecast.anomaly", "forecast", false, "anomaly requires approval")
  } else {
    wall("forecast.anomaly", "forecast", true, "forecast open")
  }
}
