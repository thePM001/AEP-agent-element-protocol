import { ProviderHealth, ProviderId, FallbackConfig, DEFAULT_FALLBACK } from './types';

export class FallbackManager {
  private config: FallbackConfig;
  private health: Map<ProviderId, ProviderHealth>;
  private rateLimitUntil: Map<ProviderId, number>;

  constructor(config?: FallbackConfig) {
    this.config = config || DEFAULT_FALLBACK;
    this.health = new Map();
    this.rateLimitUntil = new Map();
  }

  apply(healthyList: ProviderHealth[]): ProviderId[] {
    if (!this.config.enabled) return healthyList.map(h => h.provider);
    
    for (const h of healthyList) {
      this.health.set(h.provider, h);
    }

    const now = Date.now();
    return healthyList
      .filter(h => {
        if (h.status === 'unhealthy') return false;
        if (h.error_ratio > this.config.error_ratio_threshold) {
          if (h.total_requests > this.config.grace_period_min_requests) return false;
        }
        const limit = this.rateLimitUntil.get(h.provider);
        if (limit && now < limit) return false;
        return true;
      })
      .map(h => h.provider);
  }

  recordError(provider: ProviderId): void {
    const h = this.health.get(provider);
    if (h) {
      h.total_requests++;
      h.error_requests++;
      h.error_ratio = h.error_requests / h.total_requests;
      h.last_checked = Date.now();
      if (h.error_ratio > this.config.error_ratio_threshold) h.status = 'degraded';
    }
  }

  recordSuccess(provider: ProviderId): void {
    const h = this.health.get(provider);
    if (h) {
      h.total_requests++;
      h.error_ratio = h.error_requests / h.total_requests;
      h.last_checked = Date.now();
      if (h.error_ratio < 0.02 && h.status !== 'healthy') h.status = 'healthy';
    }
  }

  setRateLimit(provider: ProviderId, retryAfterSeconds?: number): void {
    const seconds = retryAfterSeconds || this.config.default_retry_after_seconds;
    this.rateLimitUntil.set(provider, Date.now() + (seconds + this.config.restore_buffer_seconds) * 1000);
  }

  getHealth(provider: ProviderId): ProviderHealth | undefined {
    return this.health.get(provider);
  }

  getAllCandidates(): ProviderId[] {
    return Array.from(this.health.keys());
  }

  reset(): void {
    this.health.clear();
    this.rateLimitUntil.clear();
  }
}

export function createFallbackManager(config?: FallbackConfig): FallbackManager {
  return new FallbackManager(config);
}
