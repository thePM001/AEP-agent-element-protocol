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

import type { LatticeEvent, ActionLattice, LatticeNode } from "../protocol/action-lattice.js";
import type { ValidationHook, HookResult } from "../protocol/action-lattice.js";

const noopValidationHook: ValidationHook = {
  name: "noop",
  version: "1.0.0",

  async validate(
    _event: LatticeEvent,
    _lattice: ActionLattice,
    _node: LatticeNode,
  ): Promise<HookResult> {
    return {
      passed: true,
      score: 1.0,
      confidence: 1.0,
      details: "Noop hook: pass-through (always passes)",
    };
  },
};

export default noopValidationHook;
