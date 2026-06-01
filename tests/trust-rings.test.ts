import { describe, it, expect } from 'vitest';

const TRUST_RINGS = ['sandbox', 'user', 'system', 'enterprise'];
const RING_ORDER: Record<string, number> = { sandbox: 0, user: 1, system: 2, enterprise: 3 };

function canAccess(agentRing: string, requiredRing: string): boolean {
  return RING_ORDER[agentRing] >= RING_ORDER[requiredRing];
}

describe('Trust Rings', () => {
  it('should have 4 rings in correct order', () => {
    expect(TRUST_RINGS).toHaveLength(4);
    expect(TRUST_RINGS[0]).toBe('sandbox');
    expect(TRUST_RINGS[3]).toBe('enterprise');
  });

  it('enterprise should access all rings', () => {
    expect(canAccess('enterprise', 'sandbox')).toBe(true);
    expect(canAccess('enterprise', 'user')).toBe(true);
    expect(canAccess('enterprise', 'system')).toBe(true);
    expect(canAccess('enterprise', 'enterprise')).toBe(true);
  });

  it('sandbox should only access sandbox', () => {
    expect(canAccess('sandbox', 'sandbox')).toBe(true);
    expect(canAccess('sandbox', 'user')).toBe(false);
    expect(canAccess('sandbox', 'system')).toBe(false);
  });

  it('user should access user and sandbox', () => {
    expect(canAccess('user', 'sandbox')).toBe(true);
    expect(canAccess('user', 'user')).toBe(true);
    expect(canAccess('user', 'system')).toBe(false);
  });
});
