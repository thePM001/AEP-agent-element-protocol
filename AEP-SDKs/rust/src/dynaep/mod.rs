//! dynAEP Rust client. Replaces the retired interpreter SDK.
//! @PAD: aep-sdk-dynaep
//! @GCDE: gaplune.code.v1

pub mod aho;
pub mod bridge;
pub mod causal;
pub mod chain;
pub mod forecast;
pub mod ledger;
pub mod rego;
pub mod scanner;
pub mod template;
pub mod temporal;

pub use bridge::{DynAepBridge, DynAepBridgeConfig, DynAepRejection, ProcessOut, ToolCallResult};
pub use causal::{CausalEvent, CausalOrderingEngine, SparseVectorClock};
pub use chain::{run_meet, run_sequential, ChainResult};
pub use forecast::ForecastCache;
pub use ledger::BufferedLedger;
pub use rego::{RegoConfig, RegoResult, UnifiedRegoEvaluator};
pub use scanner::{ScanHit, ScannerPattern, UnifiedScanner};
pub use template::{FastExitResult, TemplateInstanceResolver};
pub use temporal::{BridgeClock, ClockConfig, TemporalValidator, TemporalValidatorConfig};
