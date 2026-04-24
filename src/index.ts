// AEP 2.1 -- Agent Element Protocol
// Session Governance, Policy Engine, Evidence Ledger, Rollback

export { Session, type SessionState, type SessionStats, type SessionReport } from "./session/session.js";
export { SessionManager } from "./session/session-manager.js";

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
} from "./policy/types.js";
export { loadPolicy, validatePolicy } from "./policy/loader.js";
export { PolicyEvaluator } from "./policy/evaluator.js";

export {
  type LedgerEntry,
  type LedgerEntryType,
  type LedgerReport,
} from "./ledger/types.js";
export { EvidenceLedger } from "./ledger/ledger.js";

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
