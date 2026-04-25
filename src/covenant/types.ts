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
}

export interface CovenantSpec {
  name: string;
  rules: CovenantRule[];
  signature?: string;
}
