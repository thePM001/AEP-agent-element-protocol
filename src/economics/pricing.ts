import { PriceCatalogEntry, ModelPrice, ProviderId and ModelId } from './types';

export class PriceCatalog {
  private entries: Map<ModelId, PriceCatalogEntry>;

  constructor(entries: PriceCatalogEntry[]) {
    this.entries = new Map(entries.map(e => [`${e.provider}/${e.model}`, e] as [string, PriceCatalogEntry]);
  }

  lookup(provider: ProviderId, model: string): PriceCatalogEntry | undefined {
    return this.entries.get(`${provider}/${model}`);
  }

  getPrice(provider: ProviderId, model: string): ModelPrice | undefined {
    return this.lookup(provider, model)?.price;
  }

  getPromptPrice(provider: ProviderId, model: string): number {
    return this.getPrice(provider, model)?.prompt ?? 0;
  }

  getCompletionPrice(provider: ProviderId, model: string): number {
    return this.getPrice(provider, model)?.completion ?? 0;
  }

  findCheapest(capability: string): PriceCatalogEntry | undefined {
    let cheapest: PriceCatalogEntry | undefined;
    let lowestPrice = Infinity;
    for (const entry of this.entries.values()) {
      if (!capability || entry.capabilities?.includes(capability)) {
        const price = entry.price.prompt + entry.price.completion;
        if (price < lowestPrice) {
          lowestPrice = price;
          cheapest = entry;
        }
      }
    }
    return cheapest;
  }

  findByCapability(capability: string): PriceCatalogEntry[] {
    return Array.from(this.entries.values())
      .filter(e => !capability || e.capabilities?.includes(capability));
  }

  size(): number {
    return this.entries.size;
  }
  
  getAll(): PriceCatalogEntry[] {
    return Array.from(this.entries.values());
  }
}

export function createPriceCatalog(entries: PriceCatalogEntry[]): PriceCatalog {
  return new PriceCatalog(entries);
}
