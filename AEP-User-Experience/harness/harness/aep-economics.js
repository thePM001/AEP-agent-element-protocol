/**
 * AEP 2.75e Economics Harness
 * Wires cost-aware routing, budgeting, nanopayments, and spend control
 */

const economics = require("../../src/economics");

const {
  BalanceEngine, PriceCatalog, BudgetEnforcer, ConcurrencyLimiter,
  FallbackManager, X402Gateway, estimateCost, estimateCostFromUsage,
  resolveModelId, createBalanceEngine, createPriceCatalog,
  createBudgetEnforcer, createConcurrencyLimiter,
  createFallbackManager, createX402Gateway,
} = economics;

const DEFAULT_CONFIG = require("../../AEP-Subprotocols/commerce/price-catalog.yaml");

module.exports = {
  BalanceEngine, PriceCatalog, BudgetEnforcer, ConcurrencyLimiter,
  FallbackManager, X402Gateway, estimateCost, estimateCostFromUsage,
  resolveModelId, createBalanceEngine, createPriceCatalog,
  createBudgetEnforcer, createConcurrencyLimiter,
  createFallbackManager, createX402Gateway,
  DEFAULT_CONFIG,
  // X402 types and constants
  DEFAULT_X402: economics.DEFAULT_X402,
  PaymentScheme: economics.PaymentScheme,
  SignatureFormat: economics.SignatureFormat,
};
