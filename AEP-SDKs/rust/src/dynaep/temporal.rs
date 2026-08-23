//! Bridge clock is authority. Agents do not mint time.
//! @PAD: aep-sdk-dynaep-temporal
//! @GCDE: gaplune.code.v1

use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct ClockConfig {
    pub protocol: String,
    pub source: String,
    pub max_drift_ms: i64,
    pub bridge_is_authority: bool,
}

impl Default for ClockConfig {
    fn default() -> Self {
        Self {
            protocol: "system".into(),
            source: "monotonic".into(),
            max_drift_ms: 50,
            bridge_is_authority: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct BridgeTimestamp {
    pub bridge_time_ms: i64,
    pub agent_time_ms: Option<i64>,
    pub drift_ms: i64,
    pub source: String,
}

pub struct BridgeClock {
    pub config: ClockConfig,
}

impl BridgeClock {
    pub fn new(config: ClockConfig) -> Self {
        Self { config }
    }

    pub fn now_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    pub fn stamp(&self, agent_time_ms: Option<i64>) -> BridgeTimestamp {
        let bridge = self.now_ms();
        let drift = match agent_time_ms {
            Some(a) => (a - bridge).abs(),
            None => 0,
        };
        BridgeTimestamp {
            bridge_time_ms: bridge,
            agent_time_ms,
            drift_ms: drift,
            source: self.config.source.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct TemporalValidatorConfig {
    pub max_drift_ms: i64,
    pub max_future_ms: i64,
    pub max_staleness_ms: i64,
    pub mode: String,
}

impl Default for TemporalValidatorConfig {
    fn default() -> Self {
        Self {
            max_drift_ms: 50,
            max_future_ms: 500,
            max_staleness_ms: 5000,
            mode: "strict".into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct TemporalOutcome {
    pub accepted: bool,
    pub stamp: BridgeTimestamp,
    pub violations: Vec<String>,
}

pub struct TemporalValidator {
    clock: BridgeClock,
    config: TemporalValidatorConfig,
}

impl TemporalValidator {
    pub fn new(clock: BridgeClock, config: TemporalValidatorConfig) -> Self {
        Self { clock, config }
    }

    pub fn validate(&self, agent_time_ms: Option<i64>) -> TemporalOutcome {
        let stamp = self.clock.stamp(agent_time_ms);
        let mut violations = Vec::new();
        if stamp.drift_ms > self.config.max_drift_ms {
            violations.push(format!(
                "Temporal drift exceeded: {} ms > {}",
                stamp.drift_ms, self.config.max_drift_ms
            ));
        }
        if let Some(agent) = agent_time_ms {
            if agent > stamp.bridge_time_ms + self.config.max_future_ms {
                violations.push("Future timestamp detected".into());
            }
            if stamp.bridge_time_ms - agent > self.config.max_staleness_ms {
                violations.push("Stale event".into());
            }
        }
        let accepted = violations.is_empty() || self.config.mode != "strict";
        TemporalOutcome {
            accepted,
            stamp,
            violations,
        }
    }
}
