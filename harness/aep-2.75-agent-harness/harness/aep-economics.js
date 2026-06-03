/**
 * AEP 2.75e Economics Harness
 * Wires cost-aware routing, budgeting, and spend control
 */

const {
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
} = require("../../src/economics");

const DEFAULT_CONFIG = require("../../config/embedded/price-catalog.yaml");

module.exports = {
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
  DEFAULT_CONFIG,
};

