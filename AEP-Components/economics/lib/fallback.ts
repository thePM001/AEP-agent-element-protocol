/**
 * AEP Economics - Fallback Manager
 * Provider health tracking, circuit breaking, and retry logic
 * AEP 2.9
 */

import { ProviderHealth, FallbackConfig, ProviderId } from './types.js';

const DEFAULTS: FallbackConfig = {
  enabled: true, max_retries: 2, error_ratio_threshold: 0.1,
  health_check_interval_seconds: 5, grace_period_min_requests: 20,
  default_retry_after_seconds: 30, restore_buffer_seconds: 30,
};

export class FallbackManager {
  private config: FallbackConfig;
  private providers: Map<ProviderId, ProviderHealth>;
  private unhealthySince: Map<ProviderId, number>;
  private rateLimitedUntil: Map<ProviderId, number>;

  constructor(config: Partial<FallbackConfig> = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.providers = new Map();
    this.unhealthySince = new Map();
    this.rateLimitedUntil = new Map();
  }

  registerProvider(provider: ProviderId): void {
    if (!this.providers.has(provider)) {
      this.providers.set(provider, {
        provider, status: "healthy", error_ratio: 0,
        total_requests: 0, error_requests: 0, last_checked: Date.now(),
      });
    }
  }

  recordSuccess(provider: ProviderId): void {
    this.registerProvider(provider);
    const h = this.providers.get(provider)!;
    h.total_requests++; h.last_checked = Date.now();
    this.recompute(provider);
  }

  recordError(provider: ProviderId): void {
    this.registerProvider(provider);
    const h = this.providers.get(provider)!;
    h.total_requests++; h.error_requests++; h.last_checked = Date.now();
    this.recompute(provider);
  }

  recordRateLimit(provider: ProviderId, retryAfter?: number): void {
    this.registerProvider(provider);
    const h = this.providers.get(provider)!;
    h.error_requests++; h.total_requests++;
    h.rate_limit_restore_seconds = retryAfter || this.config.default_retry_after_seconds;
    h.last_checked = Date.now();
    this.rateLimitedUntil.set(provider, h.last_checked + h.rate_limit_restore_seconds * 1000);
    this.recompute(provider);
  }

  private recompute(provider: ProviderId): void {
    const h = this.providers.get(provider);
    if (!h) return;
    const inGrace = h.total_requests < this.config.grace_period_min_requests;
    const errRatio = h.total_requests > 0 ? h.error_requests / h.total_requests : 0;
    h.error_ratio = errRatio;
    // M-8: rate-limit degraded wins over grace-period healthy mask, but only until the
    // retry-after window ends; afterwards the provider is judged on its error ratio again.
    const limitedUntil = this.rateLimitedUntil.get(provider);
    if (limitedUntil !== undefined) {
      if (Date.now() < limitedUntil) { h.status = "degraded"; return; }
      this.rateLimitedUntil.delete(provider);
      delete h.rate_limit_restore_seconds;
    }
    if (inGrace) { h.status = "healthy"; this.unhealthySince.delete(provider); return; }
    if (errRatio >= this.config.error_ratio_threshold) {
      // Start the restore clock on any entry into unhealthy (also from degraded), else a
      // provider that went degraded first would never be let back in.
      if (h.status !== "unhealthy") this.unhealthySince.set(provider, Date.now());
      h.status = "unhealthy";
    } else if (errRatio >= this.config.error_ratio_threshold * 0.5) {
      h.status = "degraded"; this.unhealthySince.delete(provider);
    } else {
      h.status = "healthy"; this.unhealthySince.delete(provider);
    }
  }

  isHealthy(provider: ProviderId): boolean {
    const h = this.providers.get(provider);
    if (!h) return true;
    if (this.rateLimitedUntil.has(provider)) this.recompute(provider);
    if (h.status === "healthy" || h.status === "degraded") return true;
    const since = this.unhealthySince.get(provider);
    if (since && (Date.now() - since) > this.config.restore_buffer_seconds * 1000) {
      h.status = "degraded"; this.unhealthySince.delete(provider); return true;
    }
    return false;
  }

  filterHealthy(providers: ProviderId[]): ProviderId[] {
    return providers.filter(p => this.isHealthy(p));
  }

  pickBest(providers: ProviderId[]): ProviderId | null {
    const healthy = this.filterHealthy(providers);
    if (healthy.length === 0) return null;
    const full = healthy.filter(p => { const h = this.providers.get(p); return h && h.status === "healthy"; });
    return full[0] ?? healthy[0] ?? null;
  }

  getAllHealth(): ProviderHealth[] { return Array.from(this.providers.values()); }
  getHealth(provider: ProviderId): ProviderHealth | null { return this.providers.get(provider) || null; }
  get maxRetries(): number { return this.config.max_retries; }
  reset(): void { this.providers.clear(); this.unhealthySince.clear(); this.rateLimitedUntil.clear(); }
}

export function createFallbackManager(config?: Partial<FallbackConfig>): FallbackManager {
  return new FallbackManager(config);
}
