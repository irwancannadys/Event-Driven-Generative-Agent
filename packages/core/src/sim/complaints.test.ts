import { describe, expect, it } from 'vitest';
import { complaintCause } from './complaints';
import { makeScenario } from './scenario';

const order = { id: 7, created_at_sim: 30000 };

describe('complaintCause', () => {
  it('never complains before the order waited long enough', () => {
    const always = makeScenario(42, { complaintChancePct: 100 });
    expect(complaintCause(order, 30000, always)).toBeNull();
    expect(complaintCause(order, 30000 + 1199, always)).toBeNull();
    expect(complaintCause(order, 30000 + 1200, always)).toBe('slow_service');
  });

  it('always complains at 100% and never at 0%, once the wait is over', () => {
    const late = 30000 + 5000;
    expect(complaintCause(order, late, makeScenario(42, { complaintChancePct: 100 }))).toBe(
      'slow_service',
    );
    expect(complaintCause(order, late, makeScenario(42, { complaintChancePct: 0 }))).toBeNull();
  });

  it('gives an order the same answer no matter when or how often it is checked', () => {
    const scenario = makeScenario(42);
    for (let id = 1; id <= 200; id += 1) {
      const waiting = { id, created_at_sim: 0 };
      const first = complaintCause(waiting, 1300, scenario);
      for (const now of [1301, 1500, 3600, 80000]) {
        expect(complaintCause(waiting, now, scenario), `order ${id} at ${now}`).toBe(first);
      }
    }
  });

  it('follows the chance setting over many orders (about 15%)', () => {
    const scenario = makeScenario(42);
    let complaints = 0;
    const orders = 5000;
    for (let id = 1; id <= orders; id += 1) {
      if (complaintCause({ id, created_at_sim: 0 }, 5000, scenario) !== null) complaints += 1;
    }
    expect(Math.abs(complaints / orders - 0.15)).toBeLessThan(0.02);
  });

  it('is decided by the seed', () => {
    const answers = (seed: number) =>
      Array.from({ length: 300 }, (_, i) =>
        complaintCause({ id: i + 1, created_at_sim: 0 }, 5000, makeScenario(seed)),
      );
    expect(answers(42)).toEqual(answers(42));
    expect(answers(7)).not.toEqual(answers(42));
  });
});
