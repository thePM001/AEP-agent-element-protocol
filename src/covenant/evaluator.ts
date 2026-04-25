import type { CovenantSpec, CovenantRule, Condition } from "./types.js";

export interface CovenantContext {
  action: string;
  input: Record<string, unknown>;
  trustTier?: string;
  ring?: number;
  [key: string]: unknown;
}

export interface CovenantResult {
  allowed: boolean;
  reason: string;
  matchedRule?: CovenantRule;
}

export function evaluateCovenant(covenant: CovenantSpec, ctx: CovenantContext): CovenantResult {
  // Check require rules first
  for (const rule of covenant.rules) {
    if (rule.type !== "require") continue;
    for (const cond of rule.conditions) {
      const ctxValue = String(ctx[cond.field] ?? ctx.input[cond.field] ?? "");
      if (!evaluateCondition(cond, ctxValue)) {
        return {
          allowed: false,
          reason: `Requirement not met: ${cond.field} ${cond.operator} "${Array.isArray(cond.value) ? cond.value.join(", ") : cond.value}" (actual: "${ctxValue}")`,
          matchedRule: rule,
        };
      }
    }
  }

  // Check forbid rules (forbid wins over permit)
  for (const rule of covenant.rules) {
    if (rule.type !== "forbid") continue;
    if (!actionMatches(rule.action, ctx.action)) continue;

    if (rule.conditions.length === 0) {
      return {
        allowed: false,
        reason: `Forbidden by covenant: ${rule.action}`,
        matchedRule: rule,
      };
    }

    const allConditionsMet = rule.conditions.every(cond => {
      const val = String(ctx.input[cond.field] ?? ctx[cond.field] ?? "");
      return evaluateCondition(cond, val);
    });

    if (allConditionsMet) {
      return {
        allowed: false,
        reason: `Forbidden by covenant: ${rule.action} (conditions matched)`,
        matchedRule: rule,
      };
    }
  }

  // Check permit rules
  let hasPermitForAction = false;
  for (const rule of covenant.rules) {
    if (rule.type !== "permit") continue;
    if (!actionMatches(rule.action, ctx.action)) continue;

    hasPermitForAction = true;

    if (rule.conditions.length === 0) {
      return { allowed: true, reason: `Permitted by covenant: ${rule.action}`, matchedRule: rule };
    }

    const allConditionsMet = rule.conditions.every(cond => {
      const val = String(ctx.input[cond.field] ?? ctx[cond.field] ?? "");
      return evaluateCondition(cond, val);
    });

    if (allConditionsMet) {
      return { allowed: true, reason: `Permitted by covenant: ${rule.action} (conditions matched)`, matchedRule: rule };
    }
  }

  // Default deny for unmatched actions
  if (hasPermitForAction) {
    return { allowed: false, reason: `No permit conditions matched for action: ${ctx.action}` };
  }

  return { allowed: false, reason: `Default deny: no covenant rule matches action "${ctx.action}"` };
}

function actionMatches(pattern: string, action: string): boolean {
  if (pattern === action) return true;
  if (pattern === "*") return true;
  if (pattern.endsWith(":*")) {
    return action.startsWith(pattern.slice(0, -1));
  }
  return false;
}

function evaluateCondition(cond: Condition, actualValue: string): boolean {
  const expected = cond.value;

  switch (cond.operator) {
    case "==":
      return actualValue === expected;
    case "!=":
      return actualValue !== expected;
    case ">":
      return Number(actualValue) > Number(expected);
    case "<":
      return Number(actualValue) < Number(expected);
    case ">=":
      return compareTierOrNumber(actualValue, expected as string, ">=");
    case "<=":
      return compareTierOrNumber(actualValue, expected as string, "<=");
    case "in":
      return Array.isArray(expected) && expected.includes(actualValue);
    case "matches": {
      try {
        const re = new RegExp(expected as string);
        return re.test(actualValue);
      } catch {
        return actualValue.includes(expected as string);
      }
    }
    default:
      return false;
  }
}

function compareTierOrNumber(actual: string, expected: string, op: ">=" | "<="): boolean {
  const tierOrder = ["untrusted", "provisional", "standard", "trusted", "privileged"];
  const actualTierIdx = tierOrder.indexOf(actual);
  const expectedTierIdx = tierOrder.indexOf(expected);

  if (actualTierIdx !== -1 && expectedTierIdx !== -1) {
    return op === ">=" ? actualTierIdx >= expectedTierIdx : actualTierIdx <= expectedTierIdx;
  }

  const a = Number(actual);
  const b = Number(expected);
  return op === ">=" ? a >= b : a <= b;
}
