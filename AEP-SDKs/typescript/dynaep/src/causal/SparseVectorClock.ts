// @PAD: /root/dynAEP/sdk/typescript/src/causal/SparseVectorClock.ts
// ===========================================================================
// @dynaep/core - Sparse Vector Clock
// OPT-005: Efficient vector clock for partitioned causal ordering.
// Only tracks agents that have touched a given subtree, yielding O(min(|A|,|B|))
// comparison instead of O(totalAgents).
// ===========================================================================

/**
 * A sparse vector clock that only tracks agents with non-zero entries.
 * Uses a Map for O(1) per-agent lookup and O(min(|this|, |other|))
 * dominance comparison.
 */
export class SparseVectorClock {
  private readonly _entries: Map<string, number>;

  constructor(initial?: Map<string, number> | Record<string, number>) {
    this._entries = new Map<string, number>();
    if (initial) {
      if (initial instanceof Map) {
        for (const [k, v] of initial) {
          if (v > 0) this._entries.set(k, v);
        }
      } else {
        const keys = Object.keys(initial);
        for (const k of keys) {
          const v = initial[k];
          if (v > 0) this._entries.set(k, v);
        }
      }
    }
  }

  /**
   * Return the number of agents tracked in this clock.
   */
  get size(): number {
    return this._entries.size;
  }

  /**
   * Get the sequence number for a specific agent. Returns 0 if absent.
   */
  get(agentId: string): number {
    return this._entries.get(agentId) ?? 0;
  }

  /**
   * Increment the counter for the given agent by 1.
   */
  increment(agentId: string): void {
    const current = this._entries.get(agentId) ?? 0;
    this._entries.set(agentId, current + 1);
  }

  /**
   * Set the counter for the given agent to a specific value.
   */
  set(agentId: string, value: number): void {
    if (value <= 0) {
      this._entries.delete(agentId);
    } else {
      this._entries.set(agentId, value);
    }
  }

  /**
   * Merge another clock into this one by taking the component-wise maximum.
   */
  merge(other: SparseVectorClock): void {
    for (const [agentId, otherVal] of other._entries) {
      const currentVal = this._entries.get(agentId) ?? 0;
      if (otherVal > currentVal) {
        this._entries.set(agentId, otherVal);
      }
    }
  }

  /**
   * Returns true if this clock dominates the other clock.
   * A dominates B iff for every agent, A[agent] >= B[agent],
   * and for at least one agent, A[agent] > B[agent].
   *
   * Runs in O(min(|this|, |other|)) for the common case where
   * clocks share few agents.
   */
  dominates(other: SparseVectorClock): boolean {
    let hasGreater = false;

    // Check all agents in other: this must be >= for each
    for (const [agentId, otherVal] of other._entries) {
      const thisVal = this._entries.get(agentId) ?? 0;
      if (thisVal < otherVal) {
        return false;
      }
      if (thisVal > otherVal) {
        hasGreater = true;
      }
    }

    // Check agents only in this (not in other): these are > 0 while other is 0
    if (!hasGreater) {
      for (const [agentId] of this._entries) {
        if (!other._entries.has(agentId)) {
          hasGreater = true;
          break;
        }
      }
    }

    return hasGreater;
  }

  /**
   * Returns true if this clock and the other are concurrent
   * (neither dominates the other, and they are not equal).
   */
  isConcurrentWith(other: SparseVectorClock): boolean {
    let thisGreater = false;
    let otherGreater = false;

    // Compare agents present in other
    for (const [agentId, otherVal] of other._entries) {
      const thisVal = this._entries.get(agentId) ?? 0;
      if (thisVal > otherVal) {
        thisGreater = true;
      }
      if (otherVal > thisVal) {
        otherGreater = true;
      }
      if (thisGreater && otherGreater) {
        return true;
      }
    }

    // Check agents only in this (not in other)
    if (!thisGreater) {
      for (const [agentId] of this._entries) {
        if (!other._entries.has(agentId)) {
          thisGreater = true;
          break;
        }
      }
    }

    return thisGreater && otherGreater;
  }

  /**
   * Create a deep copy of this vector clock.
   */
  clone(): SparseVectorClock {
    return new SparseVectorClock(this._entries);
  }

  /**
   * Return the entries as a plain object for serialization.
   */
  toJSON(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [k, v] of this._entries) {
      result[k] = v;
    }
    return result;
  }

  /**
   * Return the internal entries map (read-only access pattern).
   */
  entries(): IterableIterator<[string, number]> {
    return this._entries.entries();
  }

  /**
   * Check if a specific agent is tracked.
   */
  has(agentId: string): boolean {
    return this._entries.has(agentId);
  }

  /**
   * Remove an agent from tracking.
   */
  remove(agentId: string): void {
    this._entries.delete(agentId);
  }
}
