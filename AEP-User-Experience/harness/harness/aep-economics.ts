/**
 * AEP 2.9 Economics Harness
 * Wires cost-aware routing, budgeting, nanopayments and spend control from
 * the economics component (14) for a harness that runs on TypeScript.
 */

import {
  DEFAULT_FALLBACK,
  DEFAULT_SEMANTIC_CACHE,
  type EconomicsConfig,
} from "../../../AEP-Components/economics/lib/index.js";

export {
  BalanceEngine,
  PriceCatalog,
  BudgetEnforcer,
  ConcurrencyLimiter,
  FallbackManager,
  X402Gateway,
  estimateCost,
  estimateCostFromUsage,
  resolveModelId,
  createBalanceEngine,
  createPriceCatalog,
  createBudgetEnforcer,
  createConcurrencyLimiter,
  createFallbackManager,
  createX402Gateway,
  DEFAULT_X402,
  PaymentScheme,
  SignatureFormat,
} from "../../../AEP-Components/economics/lib/index.js";

/** The economics configuration a harness starts from: the defaults of the component. */
export const DEFAULT_CONFIG: Readonly<EconomicsConfig> = Object.freeze({
  cost_estimate_enabled: true,
  semantic_cache: { ...DEFAULT_SEMANTIC_CACHE },
  fallback: { ...DEFAULT_FALLBACK },
});
