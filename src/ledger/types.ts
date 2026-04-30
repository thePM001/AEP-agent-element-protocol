export type LedgerEntryType =
  | "session:start"
  | "session:terminate"
  | "action:evaluate"
  | "action:result"
  | "action:gate"
  | "action:rollback"
  | "aep:validate"
  | "aep:reject"
  | "stream:abort"
  | "bundle:created"
  | "task:create"
  | "task:decompose"
  | "task:complete"
  | "task:fail"
  | "task:cancel"
  | "recovery:attempt"
  | "recovery:success"
  | "recovery:exhausted"
  | "scanner:finding"
  | "workflow:start"
  | "workflow:phase_enter"
  | "workflow:phase_verdict"
  | "workflow:complete"
  | "workflow:fail"
  | "knowledge:ingest"
  | "knowledge:reject"
  | "knowledge:flag"
  | "knowledge:retrieve"
  | "model:call"
  | "model:error"
  | "commerce:discover"
  | "commerce:cart_update"
  | "commerce:checkout"
  | "commerce:payment"
  | "commerce:fulfillment"
  | "commerce:return"
  | "fleet:agent_register"
  | "fleet:agent_deregister"
  | "fleet:pause"
  | "fleet:resume"
  | "fleet:kill"
  | "chain:evaluate";

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface CostRecord {
  input_cost: number;
  output_cost: number;
  total_cost: number;
  currency: string;
}

export interface LedgerEntry {
  seq: number;
  ts: string;
  hash: string;
  prev: string;
  type: LedgerEntryType;
  data: Record<string, unknown>;
  stateRef?: string;
  tokens?: TokenUsage;
  cost?: CostRecord;
}

export interface LedgerReport {
  sessionId: string;
  entryCount: number;
  timeRange: { first: string; last: string } | null;
  actionCounts: Record<string, number>;
  chainValid: boolean;
}
