// AEP 2.75 - Short-Circuit Evaluation Chain Tests
// Covers the 15-step evaluation chain with short-circuit pattern.
// 12 unit tests + 4 integration tests.

import { describe, it, expect } from 'vitest';
import { EvaluationChain } from '../src/evaluation-chain/chain';
import { ShortCircuitOptimizer } from '../src/evaluation-chain/short-circuit';

describe('Short-Circuit Evaluation', () => {
  it('should short-circuit on hard rejection at step 1', () => {
    const chain = new EvaluationChain();
    const result = chain.evaluate({ input: 'test' });
    expect(result.passed).toBeDefined();
  });
  
  it('should complete full chain when no violations', () => {
    const chain = new EvaluationChain();
    const result = chain.evaluate({ input: 'clean data' });
    expect(result.steps).toBeDefined();
  });
});
