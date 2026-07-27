// @PAD: p0-v275-h7-h8-covenant-condition-v1
// @GCDE: document_sha256=p0-v275-h7-h8-covenant
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
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
  /** Soft forbid matched: allow with warning (not hard deny) */
  softWarning?: string;
}

/** Canonical rule bytes for signature verification. */
export function covenantCanonicalPayload(covenant: CovenantSpec): Buffer {
  return Buffer.from(
    JSON.stringify({
      name: covenant.name,
      rules: covenant.rules,
    }),
  );
}

export function verifyCovenantSignature(covenant: CovenantSpec): boolean {
  const pem = String(covenant.signingPublicKey ?? "").trim();
  const sigB64 = String(covenant.signature ?? "").trim();
  if (!pem || !sigB64) return false;
  try {
    const key = createPublicKey(pem);
    const sig = Buffer.from(sigB64, "base64");
    if (sig.length === 0) return false;
    const payload = covenantCanonicalPayload(covenant);
    try {
      if (cryptoVerify(null, payload, key, sig)) return true;
    } catch {
      /* try sha256 */
    }
    return cryptoVerify("sha256", payload, key, sig);
  } catch {
    return false;
  }
}

export function evaluateCovenant(covenant: CovenantSpec, ctx: CovenantContext): CovenantResult {
  // MEDIUM: signature field must be verified when required
  if (covenant.requireSignature) {
    if (!covenant.signature || !covenant.signingPublicKey) {
      return {
        allowed: false,
        reason: "Covenant signature required but missing signature or signingPublicKey",
      };
    }
    if (!verifyCovenantSignature(covenant)) {
      return {
        allowed: false,
        reason: "Covenant signature verification failed",
      };
    }
  } else if (covenant.signature && covenant.signingPublicKey) {
    // If both present, always verify (fail closed on bad signature)
    if (!verifyCovenantSignature(covenant)) {
      return {
        allowed: false,
        reason: "Covenant signature present but invalid",
      };
    }
  }

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
      if (rule.severity === "soft") {
        return {
          allowed: true,
          reason: `Soft forbid warning for covenant: ${rule.action}`,
          matchedRule: rule,
          softWarning: `Forbidden by covenant (soft): ${rule.action}`,
        };
      }
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
      if (rule.severity === "soft") {
        return {
          allowed: true,
          reason: `Soft forbid warning for covenant: ${rule.action}`,
          matchedRule: rule,
          softWarning: `Forbidden by covenant (soft): ${rule.action} (conditions matched)`,
        };
      }
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
    // M-5: ns:* requires a non-empty suffix after "ns:"
    const prefix = pattern.slice(0, -1); // "ns:"
    if (!action.startsWith(prefix)) return false;
    return action.length > prefix.length;
  }
  return false;
}

function evaluateCondition(cond: Condition, actualValue: string): boolean {
  const expected = cond.value;

  switch (cond.operator) {
    case "==":
      // H-7: array expected means membership, not String(array) coercion
      if (Array.isArray(expected)) {
        return expected.map(String).includes(actualValue);
      }
      return actualValue === String(expected);
    case "!=":
      if (Array.isArray(expected)) {
        return !expected.map(String).includes(actualValue);
      }
      return actualValue !== String(expected);
    case ">": {
      const a = Number(actualValue);
      const b = Number(expected as string | number);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false; // H-8
      return a > b;
    }
    case "<": {
      const a = Number(actualValue);
      const b = Number(expected as string | number);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return a < b;
    }
    case ">=":
      return compareTierOrNumber(actualValue, expected as string, ">=");
    case "<=":
      return compareTierOrNumber(actualValue, expected as string, "<=");
    case "in":
      return Array.isArray(expected) && expected.map(String).includes(actualValue);
    case "matches": {
      try {
        const re = new RegExp(String(expected));
        return re.test(actualValue);
      } catch {
        // MEDIUM: invalid regex must fail closed (never substring fall-open)
        return false;
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
  // H-8: NaN comparisons must not pass
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return op === ">=" ? a >= b : a <= b;
}
