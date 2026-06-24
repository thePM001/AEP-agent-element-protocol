//! PERA (Perceptive Rails) docking port - future sensor and world-model integration.
//!
//! Mirrors the future-features dock: lattice-gated, reserved for AEP 3.0+ perception
//! streams and internal world-model updates. See `AEP-Docks/pera/README.md` and
//! NLA-PLATFORM `NLA-Research/pera.md`.

pub const PERA_DOCK_ID: &str = "pera";
pub const PERA_CONTRACT_ID: &str = "pera-perceptive-rails";
pub const PERA_SOCKET_SUFFIX: &str = "pera";
pub const PERA_EVENT_TYPE: &str = "docking_pera_perceptive_rails";

/// Reserved dynAEP action paths (activated when PERA runtime ships).
pub const PERA_ACTION_PERCEPTION_INGEST: &str = "pera:perception:ingest";
pub const PERA_ACTION_WORLD_MODEL_UPDATE: &str = "pera:world_model:update";
pub const PERA_ACTION_STATUS_EVOLUTION: &str = "pera:status:evolution";
pub const PERA_ACTION_HYPERFRAME_CREATE: &str = "pera:hyperframe:create";