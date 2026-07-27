// @PAD: /root/dynAEP/hooks/interface.ts
// =============================================================================
// hooks/interface.ts
// Validation Hook Interface for dynAEP Lattice Events.
//
// The canonical ValidationHook interface and HookRegistry now live in
// bridge/lattice/index.ts to prevent circular dependencies and type
// duplication. This file re-exports them for backward compatibility
// and provides the documentation reference.
//
// Hooks are executed during the lattice filtering pipeline, after
// structural constraints (required_field, threshold, authorization)
// have been evaluated. Custom constraints in the lattice config
// (constraint.type === "custom") are delegated to registered hooks.
//
// To implement a custom hook:
//   1. Import { ValidationHook } from "../../hooks/interface";
//   2. Import { LatticeEvent, ActionLattice, LatticeNode }
//      from "../../bridge/lattice";
//   3. Export an object conforming to ValidationHook
//   4. Register it in the LatticeFilter's HookRegistry
// =============================================================================

export type { ValidationHook } from "../bridge/lattice";
export { HookRegistry } from "../bridge/lattice";
export type { LatticeEvent, ActionLattice, LatticeNode } from "../bridge/lattice";

// Re-export HookResult type for convenience
export interface HookResult {
  passed: boolean;
  score: number;
  confidence: number;
  adjustments?: Record<string, unknown>;
  details?: string;
}
