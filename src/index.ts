// AEP 2.2 -- Agent Element Protocol
// Session Governance, Policy Engine, Evidence Ledger, Rollback
// Trust Scoring, Execution Rings, Behavioural Covenants, Agent Identity
// Cross-Agent Verification, Intent Drift Detection, Kill Switch
// Interactive Assistant, Proof Bundles, Streaming Validation

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
} from "./policy/types.js";
export { loadPolicy, validatePolicy } from "./policy/loader.js";
export { PolicyEvaluator, type EvaluatorOptions } from "./policy/evaluator.js";

export {
  type LedgerEntry,
  type LedgerEntryType,
  type LedgerReport,
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
export { type ProofBundle as SessionProofBundle, type BundleVerification, type TrustScore } from "./proof-bundle/types.js";

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

// Interactive Assistant
export { AEPAssistant, type AssistantOptions, type AssistResponse } from "./assist/assistant.js";
export { getPreset, getPresetNames, generatePolicyYaml } from "./assist/presets.js";
export { getExplanation, findBestMatch, getAvailableTopics } from "./assist/explanations.js";
export { generateClaudeCodeCommand, generateCursorRule, generateCodexAgentSection } from "./assist/slash-commands.js";
export { type AssistPreset, type AssistAgent, type AssistStatus, type AssistIntent, type PresetConfig } from "./assist/types.js";
