// =============================================================================
// Built-in validation hook registration for dynAEP Action Lattice.
// Resolves config aliases (e.g. "mle" -> "mle-validator") and registers
// reference hooks into a HookRegistry.
//
// The MLE reference hook source was removed from the public tree, so the
// only built-in hook is the noop pass-through. A config that names "mle"
// resolves to "mle-validator", which remains unregistered unless the host
// registers its own MLE hook; custom constraints then fail closed.
// =============================================================================

import {
  HOOK_NAME_ALIASES,
  type HookRegistry,
  type HookResult,
  type ValidationHook,
} from "./lattice/index.js";

/** Config / dynaep-config.yaml hook name -> HookRegistry key */
export { HOOK_NAME_ALIASES };

/** Environment switch that lets the noop hook pass events. */
export const NOOP_HOOK_ENV = "AEP_ALLOW_NOOP_HOOK";

/**
 * No-operation validation hook. Denies every event unless
 * AEP_ALLOW_NOOP_HOOK=1 is set, in which case it passes everything with
 * score 1.0. Fail-closed by default so a misconfigured deployment never
 * waves custom constraints through.
 */
export const noopValidationHook: ValidationHook = {
  name: "noop",
  version: "1.0.0",
  async validate(): Promise<HookResult> {
    const allow = process.env[NOOP_HOOK_ENV] === "1";
    return {
      passed: allow,
      score: allow ? 1.0 : 0,
      confidence: 1.0,
      details: allow
        ? `Noop hook: pass-through (${NOOP_HOOK_ENV}=1)`
        : `Noop hook denied (set ${NOOP_HOOK_ENV}=1 to allow pass-through)`,
    };
  },
};

const BUILTIN_HOOKS: readonly ValidationHook[] = [noopValidationHook];

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
 * Register built-in validation hooks. Idempotent per hook name.
 */
export function registerBuiltinHooks(registry: HookRegistry): void {
  for (const hook of BUILTIN_HOOKS) {
    if (!registry.has(hook.name)) {
      registry.register(hook);
    }
  }
}
