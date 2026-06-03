import { ModelMapping, ModelId } from './types';

export function resolveModelId(
  canonicalName: string,
  preferredProvider: string,
  mapping: ModelMapping,
  defaultProvider: string = 'openai'
): ModelId | undefined {
  const ids = mapping[canonicalName];
  if (!ids || ids.length === 0) return undefined;

  const preferred = ids.find(id => id.startsWith(preferredProvider + '/'));
  if (preferred) return preferred;

  const default = ids.find(id => id.startsWith(defaultProvider + '/'));
  if (default) return default;

  return ids[0];
}

export function resolveModelIds(
  canonicalName: string,
  mapping: ModelMapping
): ModelId[] {
  return mapping[canonicalName] || [];
}

export function getModelProvider(modelId: ModelId): string | undefined {
  const slashIdx = modelId.indexOf('/');
  if (slashIdx === -1) return undefined;
  return modelId.substring(0, slashIdx);
}

export function getModelName(modelId: ModelId): string | undefined {
  const slashIdx = modelId.indexOf('/');
  if (slashIdx === -1) return undefined;
  return modelId.substring(slashIdx + 1);
}
