// Fold causal and forecast denies into envelope walls.
// Wall_forecast uses live anomaly_score only. Cached snapshot score is not a wall verdict.
use crate::EnvelopeAction;
use crate::Snapshot;
use crate::AdmitWall;
fn wall(id: &str, family: &str, open: bool, reason: &str) -> AdmitWall {
  AdmitWall::verdict(id, family, open, reason)
}
pub fn wall_causal(action: &EnvelopeAction, snap: &Snapshot) -> AdmitWall {
  if action.sequence_number == 0 {
    return wall("causal.sequence", "causal", false, "no sequence bound");
  }
  match snap.last_seq_by_agent.get(&action.agent_id) {
    Some(last) if action.sequence_number < *last => wall("causal.sequence", "causal", false, "agent clock regression"),
    _ => wall("causal.sequence", "causal", true, "causal open"),
  }
}
pub fn wall_forecast(action: &EnvelopeAction, snap: &Snapshot) -> AdmitWall {
  if snap.forecast_require_approval == false {
    return wall("forecast.anomaly", "forecast", true, "approval not required");
  }
  let score = action.anomaly_score;
  if score >= snap.forecast_anomaly_threshold && score > 0.0 {
    wall("forecast.anomaly", "forecast", false, "anomaly requires approval")
  } else {
    wall("forecast.anomaly", "forecast", true, "forecast open")
  }
}
