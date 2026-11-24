import { describe, expect, it } from 'vitest';
import type { DayMetrics } from '../rules/day-metrics';
import type { PolicyIngredient } from '../rules/policy-review';
import { simTime } from '../time';
import { reviewContext, stockContext, type StockContextLine } from './context';

const line = (overrides: Partial<StockContextLine> = {}): StockContextLine => ({
  ingredient_id: 'susu',
  name: 'Susu',
  unit: 'ml',
  qty: 900,
  min_qty: 1000,
  capacity_qty: 6000,
  expected: 3200,
  shortfall: 3300,
  ...overrides,
});

describe('stockContext', () => {
  it('tells the time, and one line for every ingredient: the stock, the limits, the forecast and what is missing', () => {
    const { context, facts } = stockContext({
      kind: 'forecast',
      now: simTime(1, 10),
      lines: [line()],
    });
    expect(context).toBe(
      [
        'Pukul 10:00. Cek sebelum jam sibuk: apa yang perlu dipesan sebelum habis?',
        '- Susu: stok 900 ml, batas 1000, kapasitas 6000, perkiraan pakai 3200, kurang 3300',
      ].join('\n'),
    );
    expect(facts).toMatchObject({
      kind: 'forecast',
      lines: [{ ingredient_id: 'susu', shortfall: 3300 }],
    });
  });

  it('leaves the forecast out of the line when the proposal does not come from one', () => {
    const { context, facts } = stockContext({
      kind: 'low_stock',
      now: simTime(0, 11, 30),
      lines: [line({ expected: null, shortfall: 5100 })],
    });
    expect(context).toContain('Ada bahan yang tipis');
    expect(context).not.toContain('perkiraan');
    expect(facts.kind).toBe('low_stock');
  });

  it('is a few lines, not the whole world', () => {
    const { context } = stockContext({
      kind: 'forecast',
      now: simTime(1, 10),
      lines: [line(), line({ ingredient_id: 'kopi', name: 'Kopi' })],
    });
    expect(context.split('\n')).toHaveLength(3);
  });
});

describe('reviewContext', () => {
  const ingredients: PolicyIngredient[] = [
    {
      ingredient_id: 'susu',
      name: 'Susu',
      unit: 'ml',
      base_min_qty: 1000,
      min_qty: 1500,
      capacity_qty: 6000,
    },
  ];
  const metrics: DayMetrics = {
    day: 2,
    orders: 80,
    done: 75,
    held: 5,
    held_by_ingredient: { susu: 5 },
    stockout_sec: { susu: 1200 },
    complaints: 2,
  };

  it('has the summary of the day, a line per ingredient, the notes of the admin and the question', () => {
    const { context } = reviewContext({
      metrics,
      ingredients,
      lessons: ['Naik ke 1500 membantu.'],
      blocked: [],
    });
    expect(context).toContain('Hari 2: 80 pesanan');
    expect(context).toContain('- Susu: batas 1500 (awal 1000), menahan 5 pesanan, habis 20 menit');
    expect(context).toContain('Catatan:\n- Naik ke 1500 membantu.');
    expect(
      context.endsWith('Usulkan paling banyak satu perubahan batas minimum, atau tidak ada.'),
    ).toBe(true);
  });

  it('gives the model that does not read text the same thing as data, with the bounds of every ingredient', () => {
    const { facts } = reviewContext({ metrics, ingredients, lessons: [], blocked: ['teh'] });
    expect(facts).toMatchObject({
      kind: 'review',
      day: 2,
      blocked: ['teh'],
      ingredients: [
        { ingredient_id: 'susu', held: 5, stockout_sec: 1200, bounds: { min: 500, max: 3000 } },
      ],
    });
  });

  it('leaves out the notes when there are none', () => {
    expect(reviewContext({ metrics, ingredients, lessons: [], blocked: [] }).context).not.toContain(
      'Catatan',
    );
  });
});
