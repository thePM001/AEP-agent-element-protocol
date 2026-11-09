//! Evaluation budget. Every program runs under one. A caller may lower the defaults;
//! only the node operator may raise the ceiling.

use crate::error::{Result, UcmError};
use serde_json::{json, Value as J};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub steps: u64,
    pub bits: u64,
    pub len: u64,
    pub millis: u64,
}

impl Limits {
    pub const DEFAULT: Limits = Limits {
        steps: 1_000_000,
        bits: 65_536,
        len: 100_000,
        millis: 2_000,
    };
    pub const CEILING: Limits = Limits {
        steps: 50_000_000,
        bits: 1_048_576,
        len: 10_000_000,
        millis: 30_000,
    };

    /// Apply a caller request: each field may only go down from `base` and never above `ceiling`.
    pub fn lowered(base: Limits, ceiling: Limits, req: Option<&J>) -> Result<Limits> {
        let mut out = Limits {
            steps: base.steps.min(ceiling.steps),
            bits: base.bits.min(ceiling.bits),
            len: base.len.min(ceiling.len),
            millis: base.millis.min(ceiling.millis),
        };
        let Some(r) = req else { return Ok(out) };
        let o = r
            .as_object()
            .ok_or_else(|| UcmError::Input("budget must be an object".into()))?;
        for (k, v) in o {
            let n: u64 = v.as_str().and_then(|s| s.parse().ok()).ok_or_else(|| {
                UcmError::Input(format!("budget field {k} must be a decimal string"))
            })?;
            let slot = match k.as_str() {
                "steps" => &mut out.steps,
                "bits" => &mut out.bits,
                "len" => &mut out.len,
                "millis" => &mut out.millis,
                other => return Err(UcmError::Input(format!("unknown budget field {other}"))),
            };
            if n > *slot {
                return Err(UcmError::Input(format!(
                    "budget field {k} may only be lowered, the limit is {}",
                    *slot
                )));
            }
            *slot = n;
        }
        Ok(out)
    }

    pub fn to_json(&self) -> J {
        json!({ "steps": self.steps.to_string(), "bits": self.bits.to_string(), "len": self.len.to_string(), "millis": self.millis.to_string() })
    }
}

#[derive(Debug)]
pub struct Budget {
    pub limits: Limits,
    pub steps: u64,
    pub peak_bits: u64,
    pub peak_len: u64,
    started: Instant,
    deadline: Duration,
}

impl Budget {
    pub fn new(limits: Limits) -> Budget {
        Budget {
            limits,
            steps: 0,
            peak_bits: 0,
            peak_len: 0,
            started: Instant::now(),
            deadline: Duration::from_millis(limits.millis),
        }
    }

    pub fn step(&mut self) -> Result<()> {
        self.steps += 1;
        if self.steps > self.limits.steps {
            return Err(UcmError::BudgetExceeded {
                what: format!("steps above {}", self.limits.steps),
            });
        }
        if self.steps.is_multiple_of(1024) && self.started.elapsed() > self.deadline {
            return Err(UcmError::BudgetExceeded {
                what: format!("wall time above {} ms", self.limits.millis),
            });
        }
        Ok(())
    }

    /// Charge `n` extra steps for work inside one builtin, such as a sort or a matrix inverse.
    pub fn charge(&mut self, n: u64) -> Result<()> {
        self.steps = self.steps.saturating_add(n);
        if self.steps > self.limits.steps {
            return Err(UcmError::BudgetExceeded {
                what: format!("steps above {}", self.limits.steps),
            });
        }
        if self.started.elapsed() > self.deadline {
            return Err(UcmError::BudgetExceeded {
                what: format!("wall time above {} ms", self.limits.millis),
            });
        }
        Ok(())
    }

    pub fn bits(&mut self, b: u64) -> Result<()> {
        self.peak_bits = self.peak_bits.max(b);
        if b > self.limits.bits {
            return Err(UcmError::BudgetExceeded {
                what: format!("number size above {} bits", self.limits.bits),
            });
        }
        Ok(())
    }

    pub fn len(&mut self, n: u64) -> Result<()> {
        self.peak_len = self.peak_len.max(n);
        if n > self.limits.len {
            return Err(UcmError::BudgetExceeded {
                what: format!("vector length above {}", self.limits.len),
            });
        }
        Ok(())
    }

    /// Largest exponent a power may use so the result fits the bit limit.
    pub fn max_exponent(&self) -> u64 {
        self.limits.bits
    }

    /// Steps and peaks used. Wall time is left out because it differs between hosts and a
    /// replay must reproduce the receipt.
    pub fn used_json(&self) -> J {
        json!({ "steps": self.steps.to_string(), "peak_bits": self.peak_bits.to_string(), "peak_len": self.peak_len.to_string() })
    }
}
