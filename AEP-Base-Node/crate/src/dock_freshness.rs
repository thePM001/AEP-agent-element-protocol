//! Wire sent_at freshness. AEP28-ENV-079.
//! Constants come from aep-base-node-pulse.

use aep_base_node_pulse::{MAX_FRAME_AGE_SECS, MAX_FRAME_FUTURE_SKEW_SECS};
use crate::BaseNodeError;

pub(crate) fn frame_is_fresh(sent_at_unix: u64) -> Result<(), BaseNodeError> {
    let now = crate::now_unix();
    if sent_at_unix + MAX_FRAME_AGE_SECS < now {
        return Err(BaseNodeError::FrameStale {
            sent_at_unix,
            max_age: MAX_FRAME_AGE_SECS,
        });
    }
    if sent_at_unix > now.saturating_add(MAX_FRAME_FUTURE_SKEW_SECS) {
        return Err(BaseNodeError::FrameClockSkew { sent_at_unix });
    }
    Ok(())
}
