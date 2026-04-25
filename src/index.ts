// AEP 2.5 -- Agent Element Protocol
// Session Governance, Policy Engine, Evidence Ledger, Rollback
// Trust Scoring, Execution Rings, Behavioural Covenants, Agent Identity
// Cross-Agent Verification, Intent Drift Detection, Kill Switch
// Interactive Assistant, Proof Bundles, Streaming Validation
// Lattice-Governed Knowledge Base

export { Session, type SessionState, type SessionStats, type SessionReport } from "./session/session.js";
export { SessionManager } from "./session/session-manager.js";
export { KillSwitch, type KillResult } from "./session/kill-switch.js";

export {
  type Policy,
  type Capability,
  type Limits,
  type Gate,
  type ForbiddenPattern,
  type EscalationRule,
  type SessionConfig,
  type EvidenceConfig,
  type RemediationConfig,
  type TrustPolicyConfig,
  type RingPolicyConfig,
  type IntentPolicyConfig,
  type IdentityPolicyConfig,
  type QuantumPolicyConfig,
  type TimestampPolicyConfig,
  type SystemPolicyConfig,
  type AgentAction,
  type Verdict,
  PolicySchema,
  CapabilitySchema,
  LimitsSchema,
  GateSchema,
  ForbiddenPatternSchema,
  EscalationRuleSchema,
  SessionConfigSchema,
  EvidenceConfigSchema,
  RemediationConfigSchema,
  TrustConfigSchema,
  RingConfigSchema,
  IntentConfigSchema,
  IdentityConfigSchema,
  QuantumConfigSchema,
  TimestampConfigSchema,
  SystemConfigSchema,
  StreamingConfigSchema,
  type StreamingPolicyConfig,
  DecompositionConfigSchema,
  type DecompositionPolicyConfig,
  RecoveryConfigSchema,
  type RecoveryPolicyConfig,
  ScannersConfigSchema,
  type ScannersPolicyConfig,
  WorkflowConfigSchema,
  type WorkflowPolicyConfig,
  TelemetryConfigSchema,
  type TelemetryPolicyConfig,
  TrackingConfigSchema,
  type TrackingPolicyConfig,
  KnowledgeConfigSchema,
  type KnowledgePolicyConfig,
  type ModelGatewayPolicyConfig,
  type CommercePolicyConfig,
  type FleetPolicyConfig,
} from "./policy/types.js";
export { loadPolicy, validatePolicy } from "./policy/loader.js";
export { PolicyEvaluator, type EvaluatorOptions } from "./policy/evaluator.js";

export {
  type LedgerEntry,
  type LedgerEntryType,
  type LedgerReport,
  type TokenUsage,
  type CostRecord,
} from "./ledger/types.js";
export { EvidenceLedger } from "./ledger/ledger.js";
export { MerkleTree } from "./ledger/merkle.js";
export { generateQuantumKeyPair, quantumSign, quantumVerify, type QuantumKeyPair, type QuantumSignature } from "./ledger/quantum.js";
export { TimestampQueue, type TimestampQueueOptions } from "./ledger/timestamp.js";
export { OfflineLedger, type OfflineEntry } from "./ledger/offline.js";

export {
  type CompensationPlan,
  type RollbackResult,
} from "./rollback/types.js";
export { RollbackManager } from "./rollback/manager.js";

export {
  AgentGateway,
  type GatewayOptions,
  type ActionResult,
  type AEPValidationResult,
  type AEPElement,
} from "./gateway.js";

export { AEPProxyServer, type ProxyOptions, type BackendConfig, type MCPToolCall, type MCPToolResult } from "./proxy/mcp-proxy.js";
export { ShellProxy, type ShellProxyOptions, type ShellResult } from "./proxy/shell-proxy.js";

// Trust Scoring
export { TrustManager } from "./trust/manager.js";
export { type TrustTier, type TrustEvent, type TrustConfig } from "./trust/types.js";

// Execution Rings
export { RingManager } from "./rings/manager.js";
export { type ExecutionRing, type RingConfig, type RingCapabilities } from "./rings/types.js";

// Behavioral Covenants
export { parseCovenant } from "./covenant/parser.js";
export { evaluateCovenant, type CovenantContext, type CovenantResult } from "./covenant/evaluator.js";
export { compileCovenant, type CompiledCovenant } from "./covenant/compiler.js";
export { type CovenantSpec, type CovenantRule, type Condition, type ConditionOperator } from "./covenant/types.js";

// Agent Identity
export { AgentIdentityManager, type CreateIdentityInput } from "./identity/manager.js";
export { type AgentIdentity, type CompactIdentity } from "./identity/types.js";

// Cross-Agent Verification
export { verifyCounterparty, generateProof } from "./verification/handshake.js";
export { createRequirements } from "./verification/requirements.js";
export { type ProofBundle, type HandshakeResult, type CovenantRequirement } from "./verification/types.js";

// Intent Drift Detection
export { IntentDriftDetector, type IntentBaseline, type DriftScore, type DriftResponse, type IntentConfig } from "./intent/detector.js";

// Streaming Validation
export { AEPStreamValidator, type StreamValidatorOptions, type AEPScene, type AEPRegistry } from "./streaming/validator.js";
export { StreamMiddleware, type StreamAbortInfo } from "./streaming/middleware.js";
export { type StreamVerdict, type StreamValidator } from "./streaming/types.js";

// Proof Bundles
export { ProofBundleBuilder, type ProofBundleBuildContext } from "./proof-bundle/builder.js";
export { ProofBundleVerifier } from "./proof-bundle/verifier.js";
export { type ProofBundle as SessionProofBundle, type BundleVerification, type TrustScore, type ReliabilityIndex, type ReliabilityWeights, DEFAULT_RELIABILITY_WEIGHTS, ML_RELIABILITY_WEIGHTS } from "./proof-bundle/types.js";

// Governed Task Decomposition
export { TaskDecompositionManager } from "./decomposition/manager.js";
export {
  type TaskNode,
  type TaskScope,
  type TaskTree,
  type CompletionGate,
  type CompletionCriterion,
  type DecompositionConfig,
} from "./decomposition/types.js";

// Recovery Engine
export { RecoveryEngine } from "./recovery/engine.js";
export {
  type Violation,
  type ViolationSeverity,
  type ViolationSource,
  type RecoveryAttempt,
  type RecoveryConfig,
  type RecoveryResult,
  type RecoveryCallback,
} from "./recovery/types.js";

// Content Scanners
export { PIIScanner } from "./scanners/pii.js";
export { InjectionScanner } from "./scanners/injection.js";
export { SecretsScanner } from "./scanners/secrets.js";
export { JailbreakScanner } from "./scanners/jailbreak.js";
export { ToxicityScanner } from "./scanners/toxicity.js";
export { URLScanner } from "./scanners/urls.js";
export { DataProfileScanner, DEFAULT_PROFILER_CONFIG, type DataProfileScannerConfig as ProfilerConfig } from "./scanners/profiler.js";
export { PredictionScanner } from "./scanners/prediction.js";
export { BrandScanner } from "./scanners/brand.js";
export { RegulatoryScanner } from "./scanners/regulatory.js";
export { TemporalScanner } from "./scanners/temporal.js";
export { ScannerPipeline, createDefaultPipeline } from "./scanners/pipeline.js";
export {
  type Finding,
  type ScanResult,
  type Scanner,
  type ScannerConfig,
  type URLScannerConfig,
  type ToxicityScannerConfig,
  type DataProfileScannerConfig,
  type PredictionScannerConfig,
  type BrandScannerConfig,
  type RegulatoryScannerConfig,
  type CustomDisclosureRule,
  type TemporalScannerConfig,
  type ScannersConfig,
} from "./scanners/types.js";

// Workflow Phases
export { WorkflowExecutor } from "./workflow/executor.js";
export {
  type WorkflowPhase,
  type WorkflowDefinition,
  type PhaseVerdict,
  type VerdictRecord,
  type WorkflowStatus,
} from "./workflow/types.js";
export { createFineTuningWorkflow, FINE_TUNING_PHASES } from "./workflow/templates/fine-tuning.js";

// OpenTelemetry Exporter
export { AEPTelemetryExporter, type OTELSpan, type OTELEvent, type OTELExporterOptions } from "./telemetry/otel-exporter.js";

// Interactive Assistant
export { AEPAssistant, type AssistantOptions, type AssistResponse } from "./assist/assistant.js";
export { getPreset, getPresetNames, generatePolicyYaml } from "./assist/presets.js";
export { getExplanation, findBestMatch, getAvailableTopics } from "./assist/explanations.js";
export { generateClaudeCodeCommand, generateCursorRule, generateCodexAgentSection } from "./assist/slash-commands.js";
export { type AssistPreset, type AssistAgent, type AssistStatus, type AssistIntent, type PresetConfig } from "./assist/types.js";

// /aepassist Interactive Assistant
export { AEPassistant } from "./aepassist/assistant.js";
export { parseAEPassistInput } from "./aepassist/parser.js";
export {
  type AEPassistMode,
  type AEPassistResponse,
  type ParsedInput,
  type ProjectType,
  type GovernancePreset,
  type EmergencyAction,
  type CovenantAction,
  type IdentityAction,
  type ReportFormat,
} from "./aepassist/types.js";

// Eval-to-Guardrail Lifecycle
export { EvalRunner } from "./eval/runner.js";
export { RuleGenerator } from "./eval/rule-generator.js";
export {
  type EvalEntry,
  type EvalDataset,
  type ViolationSummary,
  type SuggestedRule,
  type EvalReport,
} from "./eval/types.js";

// ML Metrics Evaluator
export { MLMetrics } from "./eval/metrics.js";
export {
  type ClassificationReport,
  type RegressionReport,
  type RetrievalReport,
  type GenerationReport,
  type MLMetricsReport,
} from "./eval/metrics.js";

// Governed Dataset Management
export { DatasetManager } from "./datasets/manager.js";
export {
  type DatasetEntry,
  type Dataset,
  type DatasetSummary,
} from "./datasets/types.js";

// Prompt Optimization Under Governance
export { PromptOptimizer, type ComparisonReport } from "./optimization/optimizer.js";
export { PromptVersionManager, type PromptVersion } from "./optimization/versioning.js";

// Lattice-Governed Knowledge Base (Capability 10)
export { KnowledgeBaseManager } from "./knowledge/manager.js";
export { KnowledgeIngestor } from "./knowledge/ingest.js";
export { GovernedRetriever } from "./knowledge/retriever.js";
export {
  type KnowledgeChunk,
  type KnowledgeBase,
  type KnowledgeBaseSummary,
  type IngestReport,
  type KnowledgeQueryOptions,
} from "./knowledge/types.js";

// Model Gateway (Capability 11)
export { GovernedModelGateway, type GatewayDependencies } from "./model-gateway/gateway.js";
export { ProviderRegistry } from "./model-gateway/registry.js";
export { AnthropicAdapter } from "./model-gateway/providers/anthropic.js";
export { OpenAIAdapter } from "./model-gateway/providers/openai.js";
export { OllamaAdapter } from "./model-gateway/providers/ollama.js";
export { CustomAdapter } from "./model-gateway/providers/custom.js";
export {
  type ModelProvider,
  type ModelConfig,
  type ModelRequest,
  type ModelResponse,
  type ModelMessage,
  type GovernedModelResponse,
  type GovernedChunk,
  type ProviderAdapter,
  type ModelGatewayPolicy,
  type ModelGatewayOptions,
  ModelProviderSchema,
  ModelConfigSchema,
  ModelRequestSchema,
  ModelMessageSchema,
  ModelGatewayPolicySchema,
} from "./model-gateway/types.js";

// Commerce Subprotocol
export { CommerceValidator } from "./subprotocols/commerce/validator.js";
export { SpendTracker } from "./subprotocols/commerce/spend-tracker.js";
export { CommerceRegistry } from "./subprotocols/commerce/registry.js";
export {
  type CommerceAction,
  type CartItem,
  type Cart,
  type Address,
  type CheckoutSession,
  type CheckoutStatus,
  type PaymentNegotiation,
  type MerchantProfile,
  type CommercePolicy,
  type CommerceLedgerEntryType,
  type CommerceValidationResult,
  CommerceActionSchema,
  CartItemSchema,
  CartSchema,
  AddressSchema,
  CheckoutSessionSchema,
  CheckoutStatusSchema,
  PaymentNegotiationSchema,
  MerchantProfileSchema,
  CommercePolicySchema,
} from "./subprotocols/commerce/types.js";

// Fleet Governance
export { FleetManager } from "./fleet/manager.js";
export { FleetAPI } from "./fleet/api.js";
export { SpawnGovernor } from "./fleet/spawn-governance.js";
export { MessageScanner } from "./fleet/message-scanner.js";
export {
  type FleetPolicy,
  type FleetStatus,
  type AgentSummary,
  type FleetAlert,
  type FleetAlertType,
  type FleetViolation,
  type FleetAction,
  type FleetPolicyResult,
  type RegisterResult,
  type SpawnResult,
  type MessageScanResult,
  FleetPolicySchema,
} from "./fleet/types.js";
