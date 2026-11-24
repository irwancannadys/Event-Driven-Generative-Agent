import { describe, expect, it } from 'vitest';
import { OPEN_TIME_SEC } from '@cafe/core';
import { ManualClock } from './manual-clock';

describe('ManualClock', () => {
  it('starts at opening time by default', () => {
    expect(new ManualClock().now()).toBe(OPEN_TIME_SEC);
    expect(new ManualClock(0).now()).toBe(0);
  });

  it('moves only when told to', () => {
    const clock = new ManualClock();
    expect(clock.now()).toBe(clock.now());
    clock.advance(180);
    expect(clock.now()).toBe(OPEN_TIME_SEC + 180);
  });

  it('rejects fractional or negative amounts', () => {
    const clock = new ManualClock();
    expect(() => clock.advance(1.5)).toThrow(/non-negative integer/);
    expect(() => clock.advance(-1)).toThrow(/non-negative integer/);
    expect(() => new ManualClock(-5)).toThrow(/non-negative integer/);
  });

  it('can jump forward but never back', () => {
    const clock = new ManualClock(1000);
    clock.set(2000);
    expect(clock.now()).toBe(2000);
    expect(() => clock.set(1999)).toThrow(/cannot go back/);
    clock.set(2000);
    expect(clock.now()).toBe(2000);
  });
});
