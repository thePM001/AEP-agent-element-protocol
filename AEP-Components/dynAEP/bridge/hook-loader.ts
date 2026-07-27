// @PAD: AEP-Components/dynAEP/bridge/hook-loader.ts
// =============================================================================
// Built-in validation hook registration for dynAEP Action Lattice.
// Resolves config aliases (e.g. "mle" -> "mle-validator") and registers
// reference hooks into a HookRegistry.
// =============================================================================

import type { HookRegistry } from "./lattice/index";
import mleValidationHook from "../hooks/examples/mle-hook/index";
import noopValidationHook from "../hooks/examples/noop-hook/index";

/** Config / dynaep-config.yaml hook name -> HookRegistry key */
export const HOOK_NAME_ALIASES: Record<string, string> = {
  mle: "mle-validator",
  "mle-validator": "mle-validator",
  noop: "noop",
};

const BUILTIN_HOOKS = [mleValidationHook, noopValidationHook];

/**
 * Resolve a lattice.hook config value to a HookRegistry name.
 */
export function resolveHookName(configName: string | null | undefined): string | null {
  if (!configName) return null;
  const trimmed = configName.trim();
  if (!trimmed) return null;
  return HOOK_NAME_ALIASES[trimmed] ?? trimmed;
}

/**
 * Register built-in validation hooks (MLE, noop). Idempotent per hook name.
 */
export function registerBuiltinHooks(registry: HookRegistry): void {
  for (const hook of BUILTIN_HOOKS) {
    if (!registry.has(hook.name)) {
      registry.register(hook);
    }
  }
}