export type ConditionOperator = "==" | "!=" | ">" | "<" | ">=" | "<=" | "in" | "matches";

export interface Condition {
  field: string;
  operator: ConditionOperator;
  value: string | string[];
}

export interface CovenantRule {
  type: "permit" | "forbid" | "require";
  action: string;
  conditions: Condition[];
  severity?: "hard" | "soft";
}

export interface CovenantSpec {
  name: string;
  rules: CovenantRule[];
  /** Detached signature (base64) over canonical rules JSON */
  signature?: string;
  /** PEM public key used to verify signature when requireSignature */
  signingPublicKey?: string;
  /** When true, evaluate refuses unsigned/invalid covenants */
  requireSignature?: boolean;
}
