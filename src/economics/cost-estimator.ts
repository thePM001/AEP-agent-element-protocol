import { CostEstimate, ProviderId } from './types';
import { PriceCatalog } from './pricing';

export interface CostEstimatorOptions {
  catalog: PriceCatalog;
  defaultUsdCostMillion?: number;
}

export function estimateTokens(inputText: string): number {
  if (!inputText) return 0;
  const words = inputText.split(/\s+/);
  return Math.ceil(words.length * 1.3);
}

export function estimateCost(
  provider: ProviderId,
  model: string,
  inputText: string,
  options: CostEstimatorOptions
): CostEstimate {
  const inputTokens = estimateTokens(inputText);
  const catalogEntry = options.catalog.lookup(provider, model);
  
  if (!catalogEntry) {
    const defaultPrice = options.defaultUsdCostMillion ?? 5.0;
    return {
      estimated_input_tokens: inputTokens,
      estimated_prompt_micro_usd: Math.ceil(inputTokens / 1000000 * defaultPrice * 1000000),
      provider,
      model,
      price_per_million_prompt: defaultPrice,
      price_per_million_completion: defaultPrice,
      from_cache: false,
    };
  }

  const price = catalogEntry.price;
  const promptPrice = price.prompt;
  const completionPrice = price.completion;

  return {
    estimated_input_tokens: inputTokens,
    estimated_output_tokens: undefined,
    estimated_prompt_micro_usd: Math.ceil(inputTokens / 1000000 * promptPrice * 1000000),
    estimated_completion_micro_usd: undefined,
    provider,
    model,
    price_per_million_prompt: promptPrice,
    price_per_million_completion: completionPrice,
    from_cache: false,
  };
}

export function estimateCostFromUsage(
  provider: ProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number,
  options: CostEstimatorOptions,
  fromCache: boolean = false
): CostEstimate {
  const entry = options.catalog.lookup(provider, model);
  const promptPrice = entry?.price.prompt ?? options.defaultUsdCostMillion ?? 5.0;
  const completionPrice = entry?.price.completion ?? promptPrice;

  return {
    estimated_input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    estimated_prompt_micro_usd: Math.ceil(inputTokens / 1000000 * promptPrice * 1000000),
    estimated_completion_micro_usd: Math.ceil(outputTokens / 1000000 * completionPrice * 1000000),
    provider,
    model,
    price_per_million_prompt: promptPrice,
    price_per_million_completion: completionPrice,
    from_cache: fromCache,
  };
}
