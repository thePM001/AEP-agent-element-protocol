import { describe, it, expect } from 'vitest';

// Basic transpiler patterns
function detectGapStructure(content: string): boolean {
  return content.includes('address:') && content.includes('covenants:');
}

function detectRegoStructure(content: string): boolean {
  return content.includes('package ') && content.includes('deny[');
}

function detectCedarStructure(content: string): boolean {
  return content.includes('permit(') || content.includes('forbid(');
}

describe('Policy Transpilers', () => {
  it('GAP structure should contain address and covenants', () => {
    const gap = 'address:\n  domain: test\ncovenants:\n  - text: rule';
    expect(detectGapStructure(gap)).toBe(true);
  });

  it('Rego structure should contain package and deny', () => {
    const rego = 'package test\n\ndefault allow = false\ndeny[msg] { input.action == "bad" }';
    expect(detectRegoStructure(rego)).toBe(true);
  });

  it('Cedar structure should contain permit or forbid', () => {
    const cedar = 'permit(principal, action, resource) when { resource.owner == principal };';
    expect(detectCedarStructure(cedar)).toBe(true);
  });
});
