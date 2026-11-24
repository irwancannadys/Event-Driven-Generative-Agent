import { describe, expect, it } from 'vitest';
import { MENU_WEIGHT_IDS, SEED_MENU_IDS, arrivalsPerHour, makeScenario } from './scenario';

describe('makeScenario', () => {
  it('fills in the defaults', () => {
    expect(makeScenario(42)).toEqual({
      seed: 42,
      crowdPct: 100,
      complaintChancePct: 15,
      complaintWaitSec: 1200,
    });
  });

  it('accepts overrides', () => {
    expect(makeScenario(7, { crowdPct: 250, complaintChancePct: 0 })).toMatchObject({
      seed: 7,
      crowdPct: 250,
      complaintChancePct: 0,
    });
  });

  it('rejects values that make no sense', () => {
    expect(() => makeScenario(1.5)).toThrow(/seed/);
    expect(() => makeScenario(1, { crowdPct: -1 })).toThrow(/crowdPct/);
    expect(() => makeScenario(1, { crowdPct: 1001 })).toThrow(/crowdPct/);
    expect(() => makeScenario(1, { complaintChancePct: 101 })).toThrow(/complaintChancePct/);
    expect(() => makeScenario(1, { complaintWaitSec: 0 })).toThrow(/complaintWaitSec/);
  });
});

describe('arrival pattern', () => {
  it('is busiest at lunch and zero outside opening hours', () => {
    expect(arrivalsPerHour(7)).toBe(0);
    expect(arrivalsPerHour(8)).toBe(8);
    expect(arrivalsPerHour(12)).toBe(14);
    expect(arrivalsPerHour(13)).toBe(14);
    expect(arrivalsPerHour(15)).toBe(4);
    expect(arrivalsPerHour(19)).toBe(3);
    expect(arrivalsPerHour(20)).toBe(0);
    const hours = Array.from({ length: 24 }, (_, hour) => arrivalsPerHour(hour));
    expect(Math.max(...hours)).toBe(arrivalsPerHour(12));
  });
});

describe('menu weights', () => {
  it('cover exactly the menu items of the seed data', () => {
    expect([...MENU_WEIGHT_IDS].sort()).toEqual([...SEED_MENU_IDS].sort());
  });
});
