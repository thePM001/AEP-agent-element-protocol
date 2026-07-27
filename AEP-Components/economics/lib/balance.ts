import { BalanceConfig, WeightedProvider, WeightedModel, ProviderId, ModelId } from './types.js';

export class BalanceEngine {
  private configs: Map<string, BalanceConfig>;
  private latencyCache: Map<string, number[]>;

  constructor(configs: Record<string, BalanceConfig>) {
    this.configs = new Map(Object.entries(configs));
    this.latencyCache = new Map();
  }

  selectProvider(endpointType: string): ProviderId | null {
    const config = this.configs.get(endpointType);
    if (!config || !config.providers || config.providers.length === 0) return null;
    const totalWeight = config.providers.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight <= 0) return config.providers[0].provider;
    let r = Math.random() * totalWeight;
    for (const p of config.providers) {
      r -= p.weight;
      if (r <= 0) return p.provider;
    }
    return config.providers[config.providers.length - 1].provider;
  }

  resolveModel(endpointType: string): ModelId | null {
    const config = this.configs.get(endpointType);
    if (!config || !config.models || config.models.length === 0) return null;
    const totalWeight = config.models.reduce((sum, m) => sum + m.weight, 0);
    if (totalWeight <= 0) return config.models[0].model;
    let r = Math.random() * totalWeight;
    for (const m of config.models) {
      r -= m.weight;
      if (r <= 0) return m.model;
    }
    return config.models[config.models.length - 1].model;
  }

  recordLatency(provider: ProviderId, latencyMs: number): void {
    const latencies = this.latencyCache.get(provider) || [];
    latencies.push(latencyMs);
    if (latencies.length > 100) latencies.shift();
    this.latencyCache.set(provider, latencies);
  }

  validate(): string[] {
    const errors: string[] = [];
    for (const [key, config] of this.configs) {
      if (!config.providers || config.providers.length === 0) {
        errors.push(key + ": strategy requires non-empty providers list");
      }
      if (config.models && config.models.length > 0) {
        const totalWeight = config.models.reduce((s, m) => s + m.weight, 0);
        if (totalWeight <= 0) {
          errors.push(key + ": model weights must sum to > 0, got " + totalWeight);
        }
      }
    }
    return errors;
  }

  testDefaults(): BalanceConfig {
    return {
      strategy: "provider-weighted",
      providers: [
        { provider: "openai", weight: 0.5 },
        { provider: "anthropic", weight: 0.3 },
        { provider: "deepseek", weight: 0.2 },
      ],
    };
  }
}

export function createBalanceEngine(configs?: Record<string, BalanceConfig>): BalanceEngine {
  return new BalanceEngine(configs || {});
}
