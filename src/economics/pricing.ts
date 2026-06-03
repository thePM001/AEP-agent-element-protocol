/**
 * AEP Economics - Price Catalog
 * Provider/model price lookup for cost-aware routing
 * AEP 2.75e
 */

import { PriceCatalogEntry, ModelPrice, ProviderId } from './types';

export class PriceCatalog {
  private entries: Map<string, PriceCatalogEntry>;

  constructor(entries: PriceCatalogEntry[] = []) {
    this.entries = new Map();
    for (const e of entries) {
      this.entries.set(`${e.provider}/${e.model}`, e);
    }
  }

  lookup(provider: ProviderId, model: string): PriceCatalogEntry | null {
    return this.entries.get(`${provider}/${model}`) ?? null;
  }

  getPrice(provider: ProviderId, model: string): ModelPrice | null {
    const entry = this.lookup(provider, model);
    return entry?.price ?? null;
  }

  listByProvider(provider: ProviderId): PriceCatalogEntry[] {
    const results: PriceCatalogEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.provider === provider) results.push(entry);
    }
    return results;
  }

  listAll(): PriceCatalogEntry[] {
    return Array.from(this.entries.values());
  }

  findCheapest(modelIds: string[]): PriceCatalogEntry | null {
    let cheapest: PriceCatalogEntry | null = null;
    for (const mid of modelIds) {
      const [provider, model] = mid.split("/", 2);
      const entry = this.lookup(provider, model);
      if (entry && (!cheapest || entry.price.prompt < cheapest.price.prompt)) {
        cheapest = entry;
      }
    }
    return cheapest;
  }

  get size(): number { return this.entries.size; }

  validate(): string[] {
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const entry of this.entries.values()) {
      const key = `${entry.provider}/${entry.model}`;
      if (seen.has(key)) errors.push(`Duplicate entry: ${key}`);
      seen.add(key);
      if (!entry.price) errors.push(`Missing price for ${key}`);
    }
    if (this.entries.size === 0) errors.push("Price catalog is empty");
    return errors;
  }
}

export function createPriceCatalog(entries?: PriceCatalogEntry[]): PriceCatalog {
  return new PriceCatalog(entries);
}
