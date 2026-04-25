// AEP 2.5 -- Commerce Registry
// Manages merchant profiles for commerce subprotocol validation.

import type { MerchantProfile } from "./types.js";

export class CommerceRegistry {
  private merchants: Map<string, MerchantProfile> = new Map();

  registerMerchant(id: string, profile: MerchantProfile): void {
    this.merchants.set(id, { ...profile, id });
  }

  getMerchant(id: string): MerchantProfile | null {
    return this.merchants.get(id) ?? null;
  }

  listMerchants(): MerchantProfile[] {
    return Array.from(this.merchants.values());
  }

  removeMerchant(id: string): boolean {
    return this.merchants.delete(id);
  }

  hasMerchant(id: string): boolean {
    return this.merchants.has(id);
  }
}
