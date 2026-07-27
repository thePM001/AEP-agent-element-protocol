// SDK hook loader (mirrors AEP-Components/dynAEP/bridge/hook-loader.ts)
import type { HookRegistry } from "../protocol/action-lattice.js";
import { HOOK_NAME_ALIASES } from "../protocol/action-lattice.js";
import mleValidationHook from "../hooks/mle-hook.js";
import noopValidationHook from "../hooks/noop-hook.js";

export { HOOK_NAME_ALIASES };

const BUILTIN_HOOKS = [mleValidationHook, noopValidationHook];

export function resolveHookName(configName: string | null | undefined): string | null {
  if (!configName) return null;
  const trimmed = configName.trim();
  if (!trimmed) return null;
  return HOOK_NAME_ALIASES[trimmed] ?? trimmed;
}

export function registerBuiltinHooks(registry: HookRegistry): void {
  for (const hook of BUILTIN_HOOKS) {
    if (!registry.has(hook.name)) {
      registry.register(hook);
    }
  }
}