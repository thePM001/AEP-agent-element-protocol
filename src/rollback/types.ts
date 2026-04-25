export interface CompensationPlan {
  actionId: string;
  tool: string;
  originalInput: Record<string, unknown>;
  compensationAction: Record<string, unknown> | null;
  backup: { path: string; content: string; snapshotHash: string };
}

export interface RollbackResult {
  actionId: string;
  success: boolean;
  compensationApplied: Record<string, unknown> | null;
  error?: string;
}
