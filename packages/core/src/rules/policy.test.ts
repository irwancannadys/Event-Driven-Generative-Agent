import { describe, expect, it } from 'vitest';
import { POLICY_MAX_PCT, POLICY_MIN_PCT, policyBounds } from './policy';

describe('policyBounds', () => {
  it('lets a minimum move from half to three times the value the cafe started with', () => {
    expect(POLICY_MIN_PCT).toBe(50);
    expect(POLICY_MAX_PCT).toBe(300);
    expect(policyBounds(1000, 6000)).toEqual({ min: 500, max: 3000 });
  });

  it('never goes above the capacity of the shelf', () => {
    expect(policyBounds(1000, 2000)).toEqual({ min: 500, max: 2000 });
    expect(policyBounds(1000, 600)).toEqual({ min: 500, max: 600 });
    expect(policyBounds(1000, 300)).toEqual({ min: 300, max: 300 });
  });

  it('rounds to whole units, the lower bound up and the upper bound down', () => {
    expect(policyBounds(5, 100)).toEqual({ min: 3, max: 15 });
    expect(policyBounds(0, 100)).toEqual({ min: 0, max: 0 });
  });
});
