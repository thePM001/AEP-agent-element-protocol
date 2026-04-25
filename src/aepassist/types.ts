// /aepassist interactive assistant types

export type AEPassistMode =
  | "setup"
  | "status"
  | "preset"
  | "emergency"
  | "covenant"
  | "identity"
  | "report"
  | "help";

export interface AEPassistResponse {
  mode: AEPassistMode;
  message: string;
  actions?: string[];
  prompt?: string;
}

export type ProjectType = "ui" | "api" | "workflow" | "infrastructure";

export type GovernancePreset = "strict" | "standard" | "relaxed" | "audit";

export type EmergencyAction = "kill" | "kill-rollback" | "pause" | "resume";

export type CovenantAction = "list" | "create" | "view";

export type IdentityAction = "show" | "create" | "export";

export type ReportFormat = "json" | "csv" | "html";

export interface ParsedInput {
  mode: AEPassistMode;
  args: string[];
}
