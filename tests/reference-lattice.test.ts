import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REF_DIR = path.join(__dirname, '..', 'policies', 'reference');

describe('Reference Policy Lattice', () => {
  const policies = ['security.gap', 'deployment.gap', 'writing.gap', 'governance.gap'];

  for (const policy of policies) {
    it(`${policy} should exist and have content`, () => {
      const filePath = path.join(REF_DIR, policy);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content.length).toBeGreaterThan(100);
      expect(content).toContain('address:');
      expect(content).toContain('covenants:');
    });
  }

  it('README should document lattice structure', () => {
    const readme = fs.readFileSync(path.join(REF_DIR, 'README.md'), 'utf8');
    expect(readme).toContain('Policy Lattice');
    expect(readme).toContain('security.gap');
    expect(readme).toContain('deployment.gap');
    expect(readme).toContain('writing.gap');
    expect(readme).toContain('governance.gap');
  });

  it('all policies should be valid YAML-like GAP format', () => {
    for (const policy of policies) {
      const content = fs.readFileSync(path.join(REF_DIR, policy), 'utf8');
      expect(content).toContain('domain:');
      expect(content).toContain('severity: Hard');
    }
  });

  it('should have 4 policies total', () => {
    const files = fs.readdirSync(REF_DIR).filter(f => f.endsWith('.gap'));
    expect(files).toHaveLength(4);
  });
});
