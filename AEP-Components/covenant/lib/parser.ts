import type { CovenantSpec, CovenantRule, Condition, ConditionOperator } from "./types.js";

const VALID_OPERATORS: readonly ConditionOperator[] = ["==", "!=", ">", "<", ">=", "<=", "in", "matches"];

function toOperator(op: string): ConditionOperator {
  const found = VALID_OPERATORS.find((v) => v === op);
  if (!found) {
    throw new Error(`Invalid condition operator: "${op}"`);
  }
  return found;
}

/** Capture group `i` of a successful match. Every group read here is non-optional in its regex. */
function group(match: RegExpMatchArray, i: number): string {
  const value = match[i];
  if (value === undefined) {
    throw new Error(`Covenant parser: missing capture group ${i} in "${match[0]}"`);
  }
  return value;
}

export function parseCovenant(source: string): CovenantSpec {
  const lines = source.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//"));
  let name = "";
  const rules: CovenantRule[] = [];
  let inBlock = false;

  for (const line of lines) {
    // Match covenant declaration
    const covenantMatch = line.match(/^covenant\s+(\w+)\s*\{$/);
    if (covenantMatch) {
      const declared = group(covenantMatch, 1);
      // M-6: refuse silent multi-covenant merge
      if (name) {
        throw new Error(`Multiple covenants in one source not allowed (already parsing "${name}", found "${declared}")`);
      }
      name = declared;
      inBlock = true;
      continue;
    }

    // L-4: only end covenant block on a sole closing brace line
    if (inBlock && line === "}") {
      inBlock = false;
      continue;
    }

    if (!inBlock) continue;

    // Parse rule: permit/forbid/require ... [hard|soft];
    const ruleMatch = line.match(/^(permit|forbid|require)\s+(.+?)\s*(?:\[(hard|soft)\])?\s*;$/);
    if (!ruleMatch) {
      throw new Error(`Invalid covenant rule: "${line}"`);
    }

    const type = group(ruleMatch, 1) as "permit" | "forbid" | "require";
    const rest = group(ruleMatch, 2);
    const severity = ruleMatch[3] as "hard" | "soft" | undefined;

    if (type === "require") {
      // require trust_tier >= "standard"
      const reqMatch = rest.match(/^(\w+)\s*(==|!=|>|<|>=|<=)\s*"([^"]+)"$/);
      if (!reqMatch) {
        throw new Error(`Invalid require condition: "${rest}"`);
      }
      const field = group(reqMatch, 1);
      rules.push({
        type: "require",
        action: field,
        conditions: [{ field, operator: toOperator(group(reqMatch, 2)), value: group(reqMatch, 3) }],
        ...(severity ? { severity } : {}),
      });
      continue;
    }

    // permit/forbid action (conditions)
    const actionCondMatch = rest.match(/^([\w:]+)\s*(?:\((.+)\))?$/);
    if (!actionCondMatch) {
      throw new Error(`Invalid action expression: "${rest}"`);
    }

    const action = group(actionCondMatch, 1);
    const condStr = actionCondMatch[2];
    const conditions: Condition[] = [];

    if (condStr) {
      // Parse condition: field op value
      const parts = condStr.trim();

      // Handle "in" operator: field in ["a", "b"]
      const inMatch = parts.match(/^(\w+)\s+in\s+\[([^\]]+)\]$/);
      if (inMatch) {
        const values = group(inMatch, 2).split(",").map(v => v.trim().replace(/^"|"$/g, ""));
        conditions.push({ field: group(inMatch, 1), operator: "in", value: values });
      } else {
        // Handle matches: field matches "pattern"
        const matchesMatch = parts.match(/^(\w+)\s+matches\s+"([^"]+)"$/);
        if (matchesMatch) {
          conditions.push({ field: group(matchesMatch, 1), operator: "matches", value: group(matchesMatch, 2) });
        } else {
          // Handle comparison: field op "value"
          const compMatch = parts.match(/^(\w+)\s*(==|!=|>|<|>=|<=)\s*"([^"]+)"$/);
          if (compMatch) {
            conditions.push({
              field: group(compMatch, 1),
              operator: toOperator(group(compMatch, 2)),
              value: group(compMatch, 3),
            });
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
