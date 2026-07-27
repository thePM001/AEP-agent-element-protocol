// @PAD: /root/dynAEP/sdk/typescript/src/types.ts
// ===========================================================================
// @dynaep/core - Type Definitions
// Central type re-exports for the dynAEP validation bridge.
// ===========================================================================

// TA-1: Temporal Authority types
export type { ClockConfig, BridgeTimestamp, ClockHealth } from "./temporal/clock";
export type {
  TemporalValidationResult,
  TemporalViolation,
  TemporalValidatorConfig,
} from "./temporal/validator";
export type {
  CausalEvent,
  CausalOrderResult,
  CausalViolation,
  CausalConfig,
} from "./temporal/causal";
export type {
  ForecastConfig,
  TemporalForecast,
  ForecastPoint,
  RuntimeCoordinates,
  RuntimeCoordinateEvent,
  AnomalyResult,
} from "./temporal/forecast";
export type {
  ClockSyncEvent,
  TemporalStampEvent,
  TemporalRejectionEvent,
  CausalViolationEvent,
  TemporalForecastEvent,
  TemporalAnomalyEvent,
  TemporalResetEvent,
  TemporalRecoveryEvent,
  AgentReregisterEvent,
  ReregisterResultEvent,
  TemporalEvent,
} from "./temporal/events";

// OPT-005: Partitioned Causal Ordering
export type { SceneGraph, OrderingResult } from "./causal/PartitionedCausalEngine";
export { PartitionedCausalEngine } from "./causal/PartitionedCausalEngine";
export { SparseVectorClock } from "./causal/SparseVectorClock";
export type { PartitionStats } from "./causal/SubtreeOrderingContext";

// TA-3.1: Durable Causal State
export type {
  DurableCausalStore,
  BufferedEvent,
  DependencyEdge,
  DependencyGraph,
  AgentRegistration,
  CausalStateSnapshot,
  CausalPersistenceConfig,
} from "./causal/DurableCausalStore";
export { FileBasedCausalStore } from "./causal/FileBasedCausalStore";
export { SqliteCausalStore } from "./causal/SqliteCausalStore";
export { ExternalCausalStore } from "./causal/ExternalCausalStore";
export type { ExternalKeyValueBackend } from "./causal/ExternalCausalStore";

// TA-3.2: TIM Clock Quality Tracking
export { ClockQualityTracker } from "./temporal/ClockQualityTracker";
export type {
  TIMConfig,
  TIMMetadata,
  SyncState,
  ConfidenceClass,
  AnomalyFlag,
} from "./temporal/ClockQualityTracker";

// TA-3.3: Workflow Temporal Primitives
export type {
  DeadlineHandle,
  ScheduleHandle,
  SuspendedTask,
  SerializedDeadline,
  SerializedSchedule,
  SerializedSuspend,
  TemporalPrimitivesConfig,
} from "./workflow/TemporalPrimitives";
export {
  TemporalDeadline,
  TemporalSchedule,
  TemporalSleepResume,
  TemporalTimeout,
  TemporalPrimitives,
  TemporalTimeoutError,
} from "./workflow/TemporalPrimitives";

// TA-3.4: Bridge Recovery Protocol
export type { RecoveryConfig, RecoveryResult } from "./recovery/BridgeRecoveryProtocol";
export { BridgeRecoveryProtocol } from "./recovery/BridgeRecoveryProtocol";

// OPT-007: Lattice Memory Attractor Indexing
export type { AttractorConfig, LedgerAttractor, AttractorStats } from "./lattice/AttractorIndex";
export { AttractorIndex } from "./lattice/AttractorIndex";
export type { FeatureSource } from "./lattice/FeatureExtractor";
export { extractFeatures, cosineSimilarity, FEATURE_DIMENSION } from "./lattice/FeatureExtractor";

// OPT-008: Async Bridge Clock
export { AsyncBridgeClock } from "./temporal/AsyncBridgeClock";

// OPT-010: Cross-Modality State Atomicity
export type { PerceptionConfig, ModalityState, ModalityInfo } from "./perception/ModalityTracker";
export { ModalityTracker } from "./perception/ModalityTracker";

// OPT-004: Chain Executor types
export type {
  StepMode,
  StepVerdict,
  StepResult,
  ChainResult,
  ChainInput,
  StepContext,
  StepExecutor,
  ChainExecutor,
  ChainExecutionConfig,
} from "./chain/types";
export {
  CHAIN_STEP_COUNT,
  STEP_DEFINITIONS,
  createNotExecutedEntry,
} from "./chain/types";
export { ParallelChainExecutor } from "./chain/ParallelChainExecutor";
export { SequentialChainExecutor } from "./chain/SequentialChainExecutor";

// Bridge types (re-exported for convenience)
export type { DynAEPBridgeConfig, DynAEPRejection } from "./bridge";
