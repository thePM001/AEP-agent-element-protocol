import type { CovenantSpec, CovenantRule, Condition } from "./types.js";

export interface CompiledCovenant {
  name: string;
  requireRules: CovenantRule[];
  forbidRules: Map<string, CovenantRule[]>;
  permitRules: Map<string, CovenantRule[]>;
}

export function compileCovenant(spec: CovenantSpec): CompiledCovenant {
  const requireRules: CovenantRule[] = [];
  const forbidRules = new Map<string, CovenantRule[]>();
  const permitRules = new Map<string, CovenantRule[]>();

  for (const rule of spec.rules) {
    switch (rule.type) {
      case "require":
        requireRules.push(rule);
        break;
      case "forbid": {
        const existing = forbidRules.get(rule.action) ?? [];
        existing.push(rule);
        forbidRules.set(rule.action, existing);
        break;
      }
      case "permit": {
        const existing = permitRules.get(rule.action) ?? [];
        existing.push(rule);
        permitRules.set(rule.action, existing);
        break;
      }
    }
  }

  return { name: spec.name, requireRules, forbidRules, permitRules };
}
