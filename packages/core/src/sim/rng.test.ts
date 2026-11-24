import { describe, expect, it } from 'vitest';
import { pickWeighted, rand, randInt } from './rng';

describe('rand', () => {
  it('gives the same number for the same seed and key, every time', () => {
    expect(rand(42, 'order_arrival@28800')).toBe(rand(42, 'order_arrival@28800'));
    expect(rand(42, 'a')).toBe(rand(42, 'a'));
  });

  it('gives different numbers for a different seed or key', () => {
    expect(rand(42, 'a')).not.toBe(rand(7, 'a'));
    expect(rand(42, 'a')).not.toBe(rand(42, 'b'));
    expect(rand(42, 'a')).not.toBe(rand(42, 'a '));
  });

  it('keeps pinned values: changing the algorithm changes every generated day', () => {
    // If one of these fails on purpose, regenerate the golden day too (UPDATE_GOLDEN=1).
    expect(rand(42, 'a')).toBe(0.11263153528057879);
    expect(rand(42, 'order_arrival@28800')).toBe(0.9451506165063888);
    expect(rand(7, 'a')).toBe(0.3033565644748819);
    expect(rand(0, '')).toBe(0.0821428419510497);
  });

  it('stays inside [0, 1)', () => {
    for (let i = 0; i < 20000; i += 1) {
      const value = rand(42, `k${i}`);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is spread evenly: mean near 0.5 and ten buckets of similar size', () => {
    const draws = 20000;
    const buckets = new Array<number>(10).fill(0);
    let sum = 0;
    for (let i = 0; i < draws; i += 1) {
      const value = rand(42, `spread${i}`);
      sum += value;
      buckets[Math.floor(value * 10)] = (buckets[Math.floor(value * 10)] ?? 0) + 1;
    }
    expect(Math.abs(sum / draws - 0.5)).toBeLessThan(0.01);
    for (const count of buckets) {
      expect(count).toBeGreaterThan(1700);
      expect(count).toBeLessThan(2300);
    }
  });

  it('rejects a seed that is not an integer', () => {
    expect(() => rand(1.5, 'a')).toThrow(/seed must be an integer/);
    expect(() => rand(Number.NaN, 'a')).toThrow(/seed must be an integer/);
  });
});

describe('randInt', () => {
  it('stays inside [0, n) and reaches every value', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const value = randInt(42, `die${i}`, 6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('is repeatable and rejects a bad n', () => {
    expect(randInt(42, 'dice', 6)).toBe(5);
    expect(() => randInt(42, 'x', 0)).toThrow(/positive integer/);
    expect(() => randInt(42, 'x', 2.5)).toThrow(/positive integer/);
  });
});

describe('pickWeighted', () => {
  const options = [
    { value: 'kopi_susu', weight: 30 },
    { value: 'es_teh_manis', weight: 20 },
    { value: 'roti_bakar', weight: 10 },
  ];

  it('is repeatable for the same seed and key', () => {
    expect(pickWeighted(42, 'item', options)).toBe(pickWeighted(42, 'item', options));
  });

  it('picks in proportion to the weights', () => {
    const counts: Record<string, number> = {};
    const draws = 12000;
    for (let i = 0; i < draws; i += 1) {
      const value = pickWeighted(42, `w${i}`, options);
      counts[value] = (counts[value] ?? 0) + 1;
    }
    const share = (value: string) => (counts[value] ?? 0) / draws;
    expect(Math.abs(share('kopi_susu') - 30 / 60)).toBeLessThan(0.02);
    expect(Math.abs(share('es_teh_manis') - 20 / 60)).toBeLessThan(0.02);
    expect(Math.abs(share('roti_bakar') - 10 / 60)).toBeLessThan(0.02);
  });

  it('never picks an option with weight zero', () => {
    const withZero = [
      { value: 'never', weight: 0 },
      { value: 'always', weight: 1 },
    ];
    for (let i = 0; i < 500; i += 1) {
      expect(pickWeighted(1, `z${i}`, withZero)).toBe('always');
    }
  });

  it('rejects empty, all-zero or negative weights', () => {
    expect(() => pickWeighted(1, 'x', [])).toThrow(/positive weight/);
    expect(() => pickWeighted(1, 'x', [{ value: 'a', weight: 0 }])).toThrow(/positive weight/);
    expect(() => pickWeighted(1, 'x', [{ value: 'a', weight: -1 }])).toThrow(/non-negative/);
  });
});
