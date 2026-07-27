// @PAD: /root/dynAEP/observers/interface.ts
// =============================================================================
// observers/interface.ts
// Observer adapter interface for the dynAEP event ecosystem.
//
// Any source of external events (webhooks, SSE, polling, blockchain nodes,
// message queues, etc.) implements the ObserverAdapter interface to plug
// into the bridge's event pipeline.
//
// Each adapter normalises its native event shape into a LatticeEvent,
// which the bridge then validates against the Action Lattice.
//
// IMPORTANT: LatticeEvent is defined ONCE in bridge/lattice/index.ts.
// This file imports from there. Do NOT redefine LatticeEvent.
// =============================================================================

import type { LatticeEvent } from "../bridge/lattice";

// Re-export for adapter convenience
export type { LatticeEvent };

/**
 * ObserverAdapter is the contract every event source must satisfy.
 *
 * Lifecycle:
 *   1. Construct the adapter with its config.
 *   2. Call `onEvent` to register the callback that receives normalised events.
 *   3. Call `start()` to begin consuming events.
 *   4. Call `stop()` to tear down resources (server sockets, timers, etc.).
 */
export interface ObserverAdapter {
  /** Human-readable name for logging and metrics (e.g. "webhook:9000", "eth:mainnet") */
  name: string;

  /**
   * Start consuming events.
   * Implementations MUST be idempotent (calling start twice is a no-op).
   */
  start(): Promise<void>;

  /**
   * Stop consuming events and release all resources.
   * Implementations MUST be idempotent and safe to call even if not started.
   */
  stop(): Promise<void>;

  /**
   * Register the callback that receives normalised LatticeEvents.
   * Each adapter calls this for every event it produces.
   * Only one callback is supported; subsequent calls replace the previous one.
   */
  onEvent(callback: (event: LatticeEvent) => void): void;
}
