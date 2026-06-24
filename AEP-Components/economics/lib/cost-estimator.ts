/**
 * AEP Economics - Cost Estimator
 * Token count estimation and micro-USD cost computation
 * AEP 2.75e
 */

import { CostEstimate, PriceCatalogEntry, ProviderId } from './types.js';

export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  const words = text.split(" ").filter(function(w) { return w.length > 0; });
  if (words.length > 0) return Math.ceil(words.length * 1.3);
  return Math.ceil(text.length / 4);
}

export interface EstimateInput {
  prompt_text?: string;
  prompt_tokens?: number;
  expected_output_tokens?: number;
  provider: ProviderId;
  model: string;
  price_entry: PriceCatalogEntry;
}

export function estimateCost(input: EstimateInput): CostEstimate {
  const pt = input.prompt_tokens !== undefined ? input.prompt_tokens : estimateTokens(input.prompt_text || "");
  const ot = input.expected_output_tokens !== undefined ? input.expected_output_tokens : Math.ceil(pt * 0.3);
  const p = input.price_entry.price;
  const pmu = (pt / 1000000) * p.prompt * 1000000;
  const cmu = ot > 0 ? (ot / 1000000) * p.completion * 1000000 : undefined;
  return {
    estimated_input_tokens: pt, estimated_output_tokens: ot,
    estimated_prompt_micro_usd: Math.round(pmu * 100) / 100,
    estimated_completion_micro_usd: cmu !== undefined ? Math.round(cmu * 100) / 100 : undefined,
    provider: input.provider, model: input.model,
    price_per_million_prompt: p.prompt, price_per_million_completion: p.completion,
    from_cache: false,
  };
}

export function estimateCostFromUsage(
  it: number, ot: number, provider: ProviderId, model: string, pe: PriceCatalogEntry,
): CostEstimate {
  const pmu = (it / 1000000) * pe.price.prompt * 1000000;
  const cmu = (ot / 1000000) * pe.price.completion * 1000000;
  return {
    estimated_input_tokens: it, estimated_output_tokens: ot,
    estimated_prompt_micro_usd: Math.round(pmu * 100) / 100,
    estimated_completion_micro_usd: Math.round(cmu * 100) / 100,
    provider, model,
    price_per_million_prompt: pe.price.prompt, price_per_million_completion: pe.price.completion,
    from_cache: false,
  };
}

export function microUsdToUsd(mu: number): string { return "$" + (mu / 1000000).toFixed(6); }
export function totalMicroUsd(e: CostEstimate): number { return e.estimated_prompt_micro_usd + (e.estimated_completion_micro_usd || 0); }
