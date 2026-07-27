import type { CovenantRequirement } from "./types.js";

export function createRequirements(
  requiredActions: string[] = [],
  forbiddenActions: string[] = []
): CovenantRequirement {
  return { requiredActions, forbiddenActions };
}
