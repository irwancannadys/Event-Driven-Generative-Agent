import { describe, expect, it } from 'vitest';
import { measureDays } from './stage5';

describe('measuring the cafe that learns', () => {
  it('adds up the same trouble every time for the same world', () => {
    const first = measureDays({ seed: 42, days: 2, variant: 'both', crowdPct: 150 });
    const second = measureDays({ seed: 42, days: 2, variant: 'both', crowdPct: 150 });
    expect(second).toEqual(first);
    expect(first.days).toHaveLength(2);
    expect(first.held).toBe(first.days.reduce((sum, day) => sum + day.held, 0));
  });

  it('changes no policy without learning, and some with it', () => {
    const base = { seed: 42, days: 2, crowdPct: 150 } as const;
    expect(measureDays({ ...base, variant: 'baseline' }).policyChanges).toBe(0);
    expect(measureDays({ ...base, variant: 'forecast' }).policyChanges).toBe(0);
    expect(measureDays({ ...base, variant: 'policy' }).policyChanges).toBeGreaterThan(0);
    expect(measureDays({ ...base, variant: 'both' }).policyChanges).toBeGreaterThan(0);
  });
});
