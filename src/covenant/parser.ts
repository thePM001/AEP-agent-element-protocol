import type { CovenantSpec, CovenantRule, Condition, ConditionOperator } from "./types.js";

const VALID_OPERATORS: ConditionOperator[] = ["==", "!=", ">", "<", ">=", "<=", "in", "matches"];

export function parseCovenant(source: string): CovenantSpec {
  const lines = source.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//"));
  let name = "";
  const rules: CovenantRule[] = [];
  let inBlock = false;

  for (const line of lines) {
    // Match covenant declaration
    const covenantMatch = line.match(/^covenant\s+(\w+)\s*\{$/);
    if (covenantMatch) {
      name = covenantMatch[1];
      inBlock = true;
      continue;
    }

    if (line === "}") {
      inBlock = false;
      continue;
    }

    if (!inBlock) continue;

    // Parse rule: permit/forbid/require ... [hard|soft];
    const ruleMatch = line.match(/^(permit|forbid|require)\s+(.+?)\s*(?:\[(hard|soft)\])?\s*;$/);
    if (!ruleMatch) {
      throw new Error(`Invalid covenant rule: "${line}"`);
    }

    const type = ruleMatch[1] as "permit" | "forbid" | "require";
    const rest = ruleMatch[2];
    const severity = (ruleMatch[3] as "hard" | "soft" | undefined) ?? undefined;

    if (type === "require") {
      // require trust_tier >= "standard"
      const reqMatch = rest.match(/^(\w+)\s*(==|!=|>|<|>=|<=)\s*"([^"]+)"$/);
      if (!reqMatch) {
        throw new Error(`Invalid require condition: "${rest}"`);
      }
      rules.push({
        type: "require",
        action: reqMatch[1],
        conditions: [{ field: reqMatch[1], operator: reqMatch[2] as ConditionOperator, value: reqMatch[3] }],
        ...(severity ? { severity } : {}),
      });
      continue;
    }

    // permit/forbid action (conditions)
    const actionCondMatch = rest.match(/^([\w:]+)\s*(?:\((.+)\))?$/);
    if (!actionCondMatch) {
      throw new Error(`Invalid action expression: "${rest}"`);
    }

    const action = actionCondMatch[1];
    const condStr = actionCondMatch[2];
    const conditions: Condition[] = [];

    if (condStr) {
      // Parse condition: field op value
      const parts = condStr.trim();

      // Handle "in" operator: field in ["a", "b"]
      const inMatch = parts.match(/^(\w+)\s+in\s+\[([^\]]+)\]$/);
      if (inMatch) {
        const values = inMatch[2].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
        conditions.push({ field: inMatch[1], operator: "in", value: values });
      } else {
        // Handle matches: field matches "pattern"
        const matchesMatch = parts.match(/^(\w+)\s+matches\s+"([^"]+)"$/);
        if (matchesMatch) {
          conditions.push({ field: matchesMatch[1], operator: "matches", value: matchesMatch[2] });
        } else {
          // Handle comparison: field op "value"
          const compMatch = parts.match(/^(\w+)\s*(==|!=|>|<|>=|<=)\s*"([^"]+)"$/);
          if (compMatch) {
            conditions.push({ field: compMatch[1], operator: compMatch[2] as ConditionOperator, value: compMatch[3] });
          } else {
            throw new Error(`Invalid condition: "${parts}"`);
          }
        }
      }
    }

    rules.push({ type, action, conditions, ...(severity ? { severity } : {}) });
  }

  if (!name) {
    throw new Error("No covenant name found. Expected: covenant Name { ... }");
  }

  return { name, rules };
}
