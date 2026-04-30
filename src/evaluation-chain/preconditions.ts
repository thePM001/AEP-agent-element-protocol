// AEP 2.5 -- Precondition Evaluators
// Each function evaluates whether an active-mode step's precondition is met.

import type { EvalContext } from "./types.js";

export const PRECONDITION_EVALUATORS: Record<string, (ctx: EvalContext) => boolean> = {
  decomposition_enabled: (ctx) =>
    ctx.decomposition?.enabled === true,

  warmup_complete: (ctx) =>
    ctx.session.actionCount >= ctx.config.drift.warmupThreshold,

  escalation_rules_defined: (ctx) =>
    ctx.policy.escalation !== undefined && ctx.policy.escalation.length > 0,

  budgets_configured: (ctx) =>
    ctx.config.budgets !== undefined && (
      ctx.config.budgets.tokenBudget !== undefined ||
      ctx.config.budgets.costBudget !== undefined ||
      ctx.config.budgets.dailySpendLimit !== undefined ||
      ctx.config.budgets.maxRuntimeMs !== undefined ||
      ctx.config.budgets.maxActions !== undefined ||
      ctx.config.budgets.maxDenials !== undefined
    ),

  gates_configured_for_action_type: (ctx) => {
    const actionType = ctx.currentAction.tool;
    return ctx.config.gates?.[actionType] !== undefined ||
      Object.keys(ctx.config.gates ?? {}).length > 0;
  },

  fleet_multi_agent: (ctx) =>
    ctx.fleet.activeAgentCount > 1,

  knowledge_active_and_retrieval: (ctx) =>
    ctx.knowledgeBase?.active === true &&
    ctx.currentAction.involvesRetrieval === true,
};

export function evaluatePrecondition(
  precondition: string,
  ctx: EvalContext,
): boolean {
  const evaluator = PRECONDITION_EVALUATORS[precondition];
  if (!evaluator) return false;
  return evaluator(ctx);
}
