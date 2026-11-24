// Fold temporal bounds into Admit walls.

pub mod compile;
pub mod gate;
pub mod parse;

pub use compile::{
    causal_parent_wall_id, compile_temporal_walls, compile_temporal_warns,
    fold_temporal_into_admit, TemporalCompileInput, DEFAULT_MAX_DRIFT_MS, DEFAULT_MAX_FUTURE_MS,
    DEFAULT_MAX_STALENESS_MS, WALL_TEMPORAL_CAUSAL_PARENT, WALL_TEMPORAL_DRIFT,
    WALL_TEMPORAL_FUTURE, WALL_TEMPORAL_STALE,
};
pub use gate::run_gate;
pub use parse::{parse_extra_walls, parse_temporal_from_text};
