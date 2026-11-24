import { describe, expect, it } from 'vitest';
import { drawSupplier, etaFor, type SupplierOutcome } from './supplier';

const weights = { weight_on_time: 70, weight_late: 25, weight_out: 5, late_multiplier_pct: 200 };

describe('drawSupplier', () => {
  it('gives the same outcome for the same seed and restock', () => {
    expect(drawSupplier(42, 1, weights)).toBe(drawSupplier(42, 1, weights));
  });

  it('follows the weights over many restocks (70 / 25 / 5)', () => {
    const counts: Record<SupplierOutcome, number> = { on_time: 0, late: 0, out: 0 };
    const draws = 10000;
    for (let restockId = 1; restockId <= draws; restockId += 1) {
      counts[drawSupplier(42, restockId, weights)] += 1;
    }
    expect(Math.abs(counts.on_time / draws - 0.7)).toBeLessThan(0.03);
    expect(Math.abs(counts.late / draws - 0.25)).toBeLessThan(0.03);
    expect(Math.abs(counts.out / draws - 0.05)).toBeLessThan(0.02);
  });

  it('respects weights that leave only one possible outcome', () => {
    const onlyLate = { ...weights, weight_on_time: 0, weight_out: 0 };
    for (let restockId = 1; restockId <= 100; restockId += 1) {
      expect(drawSupplier(1, restockId, onlyLate)).toBe('late');
    }
  });
});

describe('etaFor', () => {
  it('adds the lead time when on time, and stretches it when late', () => {
    expect(etaFor(30000, 7200, 'on_time', 200)).toBe(37200);
    expect(etaFor(30000, 7200, 'late', 200)).toBe(44400);
    expect(etaFor(30000, 5400, 'late', 150)).toBe(30000 + 8100);
  });

  it('rounds a stretched lead time up to whole seconds', () => {
    expect(etaFor(0, 101, 'late', 150)).toBe(152);
  });

  it('has no arrival when the supplier is out of stock', () => {
    expect(etaFor(30000, 7200, 'out', 200)).toBeNull();
  });
});
