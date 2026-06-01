import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function buildMerkleRoot(entries: string[]): string {
  if (entries.length === 0) return sha256('');
  if (entries.length === 1) return sha256(entries[0]);
  
  let level = entries.map(e => sha256(e));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(sha256(level[i] + level[i + 1]));
      } else {
        next.push(level[i]);
      }
    }
    level = next;
  }
  return level[0];
}

describe('Merkle-Tree Audit', () => {
  it('single entry should produce a hash', () => {
    const root = buildMerkleRoot(['entry1']);
    expect(root).toHaveLength(64);
  });

  it('two entries should produce different root than single', () => {
    const root1 = buildMerkleRoot(['a']);
    const root2 = buildMerkleRoot(['a', 'b']);
    expect(root1).not.toBe(root2);
  });

  it('same entries should produce same root', () => {
    const root1 = buildMerkleRoot(['a', 'b', 'c']);
    const root2 = buildMerkleRoot(['a', 'b', 'c']);
    expect(root1).toBe(root2);
  });

  it('tampered entry should produce different root', () => {
    const root1 = buildMerkleRoot(['a', 'b', 'c']);
    const root2 = buildMerkleRoot(['a', 'x', 'c']);
    expect(root1).not.toBe(root2);
  });
});
