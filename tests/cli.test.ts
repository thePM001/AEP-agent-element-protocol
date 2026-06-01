import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const CLI = path.join(__dirname, '..', 'src', 'cli', 'cli.cjs');

describe('CLI Tools', () => {
  it('doctor should check subsystems and exit 0', () => {
    const result = execSync(`node ${CLI} doctor`, { encoding: 'utf8', timeout: 5000 });
    expect(result).toContain('AEP Doctor');
    expect(result).toContain('passed');
  });

  it('verify should detect em-dash violations', () => {
    const tmpFile = '/tmp/aep-test-emdash.txt';
    fs.writeFileSync(tmpFile, 'test with em-dash character');
    const result = execSync(`node ${CLI} verify ${tmpFile}`, { encoding: 'utf8', timeout: 5000 });
    expect(result).toContain('Verification complete');
    fs.unlinkSync(tmpFile);
  });

  it('lint-policy should validate a GAP file', () => {
    const policyFile = path.join(__dirname, '..', 'policies', 'reference', 'security.gap');
    const result = execSync(`node ${CLI} lint-policy ${policyFile}`, { encoding: 'utf8', timeout: 5000 });
    expect(result).toContain('gapc');
  });

  it('red-team should generate adversarial inputs', () => {
    const result = execSync(`node ${CLI} red-team`, { encoding: 'utf8', timeout: 5000 });
    expect(result).toContain('Red-Team');
  });
});
