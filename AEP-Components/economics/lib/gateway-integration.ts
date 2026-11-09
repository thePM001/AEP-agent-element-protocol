/**
 * Economics hooks for GovernedModelGateway pre/post dispatch.
 */

import type { ModelConfig, ModelRequest, ModelResponse } from "../../model-gateway/lib/types.js";
import type { PriceCatalog } from "./pricing.js";
import type { BudgetEnforcer } from "./budget.js";
import type { ConcurrencyLimiter } from "./concurrency.js";
import type { FallbackManager } from "./fallback.js";
import { estimateCost, estimateCostFromUsage, estimateTokens } from "./cost-estimator.js";
import type { CostEstimate } from "./types.js";

export interface EconomicsGatewayDeps {
  priceCatalog?: PriceCatalog;
  budget?: BudgetEnforcer;
  concurrency?: ConcurrencyLimiter;
  fallback?: FallbackManager;
  costEstimateEnabled?: boolean;
  budgetScope?: string;
}

export interface EconomicsPrecheckResult {
  estimate?: CostEstimate;
  budgetWarning?: boolean;
  /** True when preDispatch already charged `estimate` to the budget (checkAndRecord). */
  reserved?: boolean;
}

export class EconomicsGatewayHooks {
  constructor(private readonly deps: EconomicsGatewayDeps = {}) {}

  getPriceCatalog(): PriceCatalog | undefined {
    return this.deps.priceCatalog;
  }

  async preDispatch(
    request: ModelRequest,
    config: ModelConfig,
  ): Promise<EconomicsPrecheckResult> {
    const { budget, concurrency, fallback, priceCatalog, costEstimateEnabled, budgetScope } =
      this.deps;

    budget?.maybeResetPeriod();

    if (concurrency) {
      await concurrency.acquire();
    }

    const provider = config.provider;
    fallback?.registerProvider(provider);
    if (fallback && !fallback.isHealthy(provider)) {
      concurrency?.release();
      throw new Error(`Provider '${provider}' is unhealthy (economics fallback)`);
    }

    if (!costEstimateEnabled || !priceCatalog) {
      return {};
    }

    const priceEntry = priceCatalog.lookup(provider, config.model);
    if (!priceEntry) {
      return {};
    }

    const promptText = request.messages.map((m) => m.content).join("\n");
    const estimate = estimateCost({
      prompt_text: promptText,
      provider,
      model: config.model,
      price_entry: priceEntry,
    });

    if (budget) {
      // HIGH: reserve on preDispatch (checkAndRecord) to close TOCTOU vs check-only
      const status =
        typeof budget.checkAndRecord === "function"
          ? budget.checkAndRecord(estimate, budgetScope)
          : budget.check(estimate, budgetScope);
      if (!status.allowed) {
        concurrency?.release();
        throw new Error(status.reason ?? "Budget denied model call");
      }
      return { estimate, budgetWarning: status.warning, reserved: true };
    }

    return { estimate };
  }

  /**
   * Charge the actual usage. Pass the preDispatch result so a reserved estimate is
   * released first; without it the reservation and the actual usage are both charged.
   */
  recordSuccess(response: ModelResponse, config: ModelConfig, precheck?: EconomicsPrecheckResult): void {
    const { budget, fallback, concurrency, priceCatalog, budgetScope } = this.deps;

    if (priceCatalog && budget) {
      const priceEntry = priceCatalog.lookup(config.provider, response.model);
      if (priceEntry) {
        const actual = estimateCostFromUsage(
          response.usage.inputTokens,
          response.usage.outputTokens,
          config.provider,
          response.model,
          priceEntry,
        );
        this.releaseReservation(precheck);
        budget.record(actual, budgetScope);
      }
    }

    fallback?.recordSuccess(config.provider);
    concurrency?.release();
  }

  /**
   * Settle a stream that reached the provider. Stream adapters report no usage, so the
   * estimate reserved by preDispatch remains the charge for the call.
   */
  recordStreamComplete(config: ModelConfig): void {
    this.deps.fallback?.recordSuccess(config.provider);
    this.deps.concurrency?.release();
  }

  /** Pass the preDispatch result so a reserved estimate is returned to the budget. */
  recordFailure(config: ModelConfig, err: unknown, precheck?: EconomicsPrecheckResult): void {
    this.releaseReservation(precheck);
    // recordRateLimit counts the request and the error itself; calling recordError as
    // well counted one rate-limited call as two failed requests.
    if (err instanceof Error && /rate limit/i.test(err.message)) {
      this.deps.fallback?.recordRateLimit(config.provider);
    } else {
      this.deps.fallback?.recordError(config.provider);
    }
    this.deps.concurrency?.release();
  }

  private releaseReservation(precheck: EconomicsPrecheckResult | undefined): void {
    const { budget, budgetScope } = this.deps;
    if (!budget || !precheck?.reserved || !precheck.estimate) return;
    budget.release(precheck.estimate, budgetScope);
  }

  estimateRequestCost(request: ModelRequest, config: ModelConfig): CostEstimate | null {
    const { priceCatalog } = this.deps;
    if (!priceCatalog) return null;
    const priceEntry = priceCatalog.lookup(config.provider, config.model);
    if (!priceEntry) return null;
    const promptText = request.messages.map((m) => m.content).join("\n");
    return estimateCost({
      prompt_text: promptText,
      prompt_tokens: estimateTokens(promptText),
      provider: config.provider,
      model: config.model,
      price_entry: priceEntry,
    });
  }
}

export function createEconomicsGatewayHooks(deps?: EconomicsGatewayDeps): EconomicsGatewayHooks {
  return new EconomicsGatewayHooks(deps);
}