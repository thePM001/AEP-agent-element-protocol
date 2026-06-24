/**
 * AEP Economics - Model Mapping
 * Resolves canonical model names to provider-specific model IDs
 * AEP 2.75e
 */

import { ModelMapping, ModelId, ProviderId } from './types.js';

export class ModelMapper {
  private mapping: ModelMapping;

  constructor(mapping: ModelMapping = {}) {
    this.mapping = mapping;
  }

  resolve(canonicalName: string): ModelId[] {
    return this.mapping[canonicalName] ?? [];
  }

  resolveFirst(canonicalName: string): ModelId | null {
    const ids = this.resolve(canonicalName);
    return ids.length > 0 ? ids[0] : null;
  }

  static providerFromId(modelId: ModelId): ProviderId {
    return modelId.split("/")[0] as ProviderId;
  }

  static modelFromId(modelId: ModelId): string {
    const parts = modelId.split("/");
    return parts.slice(1).join("/");
  }

  canonicalForProvider(provider: ProviderId): string[] {
    const results: string[] = [];
    for (const [canonical, ids] of Object.entries(this.mapping)) {
      if ((ids as string[]).some((id: string) => id.startsWith(provider + "/"))) {
        results.push(canonical);
      }
    }
    return results;
  }

  listCanonical(): string[] {
    return Object.keys(this.mapping);
  }

  get size(): number { return Object.keys(this.mapping).length; }

  validate(): string[] {
    const errors: string[] = [];
    for (const [canonical, ids] of Object.entries(this.mapping)) {
      if (!Array.isArray(ids) || ids.length === 0) {
        errors.push(canonical + ": must map to at least one provider ID");
        continue;
      }
      for (const id of ids) {
        if (!id.includes("/")) {
          errors.push(canonical + ": invalid model ID \"" + id + "\" - must be provider/model format");
        }
      }
    }
    if (Object.keys(this.mapping).length === 0) errors.push("Model mapping is empty");
    return errors;
  }
}

export function resolveModelId(canonicalName: string, mapping?: ModelMapping): ModelId | null {
  if (!mapping) return null;
  const ids = mapping[canonicalName];
  return ids && ids.length > 0 ? ids[0] : null;
}
