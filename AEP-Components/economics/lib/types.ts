/**
 * AEP Economics - Core Types
 * Cost-aware routing, budgeting, and spend control
 * AEP 2.75e
 */

export type ProviderId = string;
export type ModelId = string;

export interface ModelPrice {
  prompt: number;
  completion: number;
  cache_read?: number;
  cache_write?: number;
}

export interface PriceCatalogEntry {
  provider: ProviderId;
  model: string;
  price: ModelPrice;
  context_window?: number;
  max_output_tokens?: number;
  capabilities?: string[];
}

export type BalanceStrategy = "provider-weighted" | "balanced-latency" | "model-weighted" | "model-latency";
export interface WeightedProvider { provider: ProviderId; weight: number; }
export interface WeightedModel { model: ModelId; weight: number; }
export interface BalanceConfig { strategy: BalanceStrategy; providers?: WeightedProvider[]; models?: WeightedModel[]; }
export type ModelMapping = Record<string, ModelId[]>;
export interface CostEstimate { estimated_input_tokens: number; estimated_output_tokens?: number; estimated_prompt_micro_usd: number; estimated_completion_micro_usd?: number; provider: ProviderId; model: string; price_per_million_prompt: number; price_per_million_completion: number; from_cache: boolean; }
export type BudgetMode = "deny" | "warn" | "quota";
export type BudgetScope = "per-workspace" | "per-agent" | "per-user";
export type BudgetPeriod = "monthly" | "daily" | "per-request";
export interface BudgetConfig { enabled: boolean; mode: BudgetMode; scope: BudgetScope; period: BudgetPeriod; hard_cap: number; soft_warning_at: number; }
export interface BudgetStatus { allowed: boolean; remaining_usd: number; consumed_ratio: number; warning: boolean; reason?: string; }
export interface ProviderHealth { provider: ProviderId; status: "healthy" | "degraded" | "unhealthy"; error_ratio: number; total_requests: number; error_requests: number; last_checked: number; rate_limit_restore_seconds?: number; }
export interface SemanticCacheConfig { enabled: boolean; similarity_threshold: number; ttl_seconds: number; exact_match_first: boolean; }
export interface FallbackConfig { enabled: boolean; max_retries: number; error_ratio_threshold: number; health_check_interval_seconds: number; grace_period_min_requests: number; default_retry_after_seconds: number; restore_buffer_seconds: number; }
export interface EconomicsConfig { balance?: Record<string, BalanceConfig>; cost_estimate_enabled?: boolean; budget?: BudgetConfig; max_concurrent?: number; semantic_cache?: SemanticCacheConfig; fallback?: FallbackConfig; }
export const DEFAULT_SEMANTIC_CACHE: SemanticCacheConfig = { enabled: true, similarity_threshold: 0.92, ttl_seconds: 3600, exact_match_first: true };
export const DEFAULT_FALLBACK: FallbackConfig = { enabled: true, max_retries: 2, error_ratio_threshold: 0.1, health_check_interval_seconds: 5, grace_period_min_requests: 20, default_retry_after_seconds: 30, restore_buffer_seconds: 30 };
