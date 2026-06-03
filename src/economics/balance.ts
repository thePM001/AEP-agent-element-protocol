import { BalanceConfig, BalanceStrategy } from './types';
export class BalanceEngine {
  private configs: Map<string, BalanceConfig>;
  private latencyCache: Map<string, number[]>;
  constructor(configs: Record<string, BalanceConfig>) {
    this.configs = new Map(Object.entries(configs));
    this.latencyCache = new Map();
  }
  selectProvider(endpointType: string): string | null {
    const cf = this.configs.get(endpointType);
    if (!cf) return null;
    if (cf.providers) {
      const tw = cf.providers.reduce((s, p) => s + p.weight, 0);
      let r = Math.random() * tw;
      for (const p of cf.providers) { r -= p.weight; if (r <= 0) return p.provider; }
      return cf.providers[cf.providers.length - 1].provider;
    }
    return null;
  }
  resolveModel(endpointType: string): string | null {
    const cf = this.configs.get(endpointType);
    if (!cf || !cf.models) return null;
    const tw = cf.models.reduce((s, m) => s + m.weight, 0);
    let r = Math.random() * tw;
    for (const m of cf.models) { r -= m.weight; if (r <= 0) return m.model; }
    return cf.models[cf.models.length - 1].model;
  }
}
