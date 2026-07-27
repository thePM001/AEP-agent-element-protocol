// @PAD: /root/dynAEP/hooks/examples/noop-hook/index.ts
// =============================================================================
// hooks/examples/noop-hook/index.ts
// No-Operation Validation Hook - Pass-Through
//
// This hook always passes every event with score 1.0 and confidence 1.0.
// It is useful as:
//   - A default placeholder when no real validation is configured
//   - A baseline for benchmarking the hook pipeline overhead
//   - A reference for implementing new hooks
// =============================================================================

import type { LatticeEvent, ActionLattice, LatticeNode } from "../../../bridge/lattice";
import type { ValidationHook, HookResult } from "../../interface";

const noopValidationHook: ValidationHook = {
  name: "noop",
  version: "1.0.0",

  async validate(
    _event: LatticeEvent,
    _lattice: ActionLattice,
    _node: LatticeNode,
  ): Promise<HookResult> {
    const allow = process.env.AEP_ALLOW_NOOP_HOOK === "1";
    return {
      passed: allow,
      score: allow ? 1.0 : 0,
      confidence: 1.0,
      details: allow
        ? "Noop hook: pass-through (AEP_ALLOW_NOOP_HOOK=1)"
        : "Noop hook denied (set AEP_ALLOW_NOOP_HOOK=1 for benchmarks only)",
    };
  },
};

export default noopValidationHook;
