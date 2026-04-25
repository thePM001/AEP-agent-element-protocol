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
  | "task:cancel";

export interface LedgerEntry {
  seq: number;
  ts: string;
  hash: string;
  prev: string;
  type: LedgerEntryType;
  data: Record<string, unknown>;
  stateRef?: string;
}

export interface LedgerReport {
  sessionId: string;
  entryCount: number;
  timeRange: { first: string; last: string } | null;
  actionCounts: Record<string, number>;
  chainValid: boolean;
}
