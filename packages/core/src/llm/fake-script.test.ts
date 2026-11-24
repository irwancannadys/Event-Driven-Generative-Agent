import { describe, expect, it } from 'vitest';
import type { DayMetrics } from '../rules/day-metrics';
import type { PolicyIngredient } from '../rules/policy-review';
import { simTime } from '../time';
import { reviewContext, stockContext } from './context';
import { DEFAULT_FAKE_SCRIPT } from './fake-script';
import { FakeLLM } from './fake-llm';
import { validateDecision, type ValidationWorld } from './validate';

const world: ValidationWorld = {
  ingredients: new Map([
    ['susu', { qty: 900, capacity_qty: 6000, base_min_qty: 1000 }],
    ['kopi', { qty: 1900, capacity_qty: 2000, base_min_qty: 300 }],
  ]),
};
const fake = () => new FakeLLM(DEFAULT_FAKE_SCRIPT);

describe('the default script, for a proposal of stock', () => {
  const lines = [
    {
      ingredient_id: 'susu',
      name: 'Susu',
      unit: 'ml',
      qty: 900,
      min_qty: 1000,
      capacity_qty: 6000,
      expected: 3200,
      shortfall: 3300,
    },
    {
      ingredient_id: 'kopi',
      name: 'Kopi',
      unit: 'g',
      qty: 1900,
      min_qty: 300,
      capacity_qty: 2000,
      expected: 100,
      shortfall: -1500,
    },
  ];

  it('orders a tenth more than what is missing, only for what is missing, in a way the validator accepts', () => {
    const request = {
      purpose: 'stock_proposal' as const,
      ...stockContext({ kind: 'forecast', now: simTime(1, 10), lines }),
    };
    const { output } = fake().completeNow(request);
    expect(output).toMatchObject({
      items: [{ ingredient_id: 'susu', qty: 3630 }],
      urgency: 'high',
    });
    expect(validateDecision('stock_proposal', output, world).ok).toBe(true);
  });

  it('never asks for more than fits on the shelf', () => {
    const request = {
      purpose: 'stock_proposal' as const,
      ...stockContext({
        kind: 'low_stock',
        now: simTime(0, 11),
        lines: [{ ...lines[0]!, expected: null, shortfall: 5100 }],
      }),
    };
    const { output } = fake().completeNow(request) as { output: { items: { qty: number }[] } };
    expect(output.items[0]?.qty).toBe(5100); // 6000 - 900: all the room there is
  });
});

describe('the default script, for the nightly review', () => {
  const ingredients: PolicyIngredient[] = [
    {
      ingredient_id: 'susu',
      name: 'Susu',
      unit: 'ml',
      base_min_qty: 1000,
      min_qty: 1000,
      capacity_qty: 6000,
    },
    {
      ingredient_id: 'kopi',
      name: 'Kopi',
      unit: 'g',
      base_min_qty: 300,
      min_qty: 300,
      capacity_qty: 2000,
    },
  ];
  const metrics = (overrides: Partial<DayMetrics> = {}): DayMetrics => ({
    day: 0,
    orders: 75,
    done: 70,
    held: 9,
    held_by_ingredient: { susu: 9 },
    stockout_sec: { susu: 2400 },
    complaints: 4,
    ...overrides,
  });
  const ask = (m: DayMetrics, blocked: string[] = []) => ({
    purpose: 'policy_review' as const,
    ...reviewContext({ metrics: m, ingredients, lessons: [], blocked }),
  });

  it('asks for a minimum twice as high for the ingredient with the most trouble, and the validator accepts it', () => {
    const { output } = fake().completeNow(ask(metrics()));
    expect(output).toMatchObject({ change: { ingredient_id: 'susu', min_qty: 2000 } });
    expect(validateDecision('policy_review', output, world).ok).toBe(true);
  });

  it('proposes nothing on a quiet day, and nothing for an ingredient that a note blocks', () => {
    const quiet = metrics({ held: 0, held_by_ingredient: {}, stockout_sec: {} });
    expect((fake().completeNow(ask(quiet)).output as { change?: unknown }).change).toBeUndefined();
    const blocked = fake().completeNow(ask(metrics(), ['susu'])).output as { change?: unknown };
    expect(blocked.change).toBeUndefined();
  });

  it('stays within the bounds it was told, and the summary is the one the admin wrote', () => {
    const high = [{ ...ingredients[0]!, min_qty: 2800 }, ingredients[1]!];
    const request = {
      purpose: 'policy_review' as const,
      ...reviewContext({ metrics: metrics(), ingredients: high, lessons: [], blocked: [] }),
    };
    const { output } = fake().completeNow(request) as {
      output: { change: { min_qty: number }; summary: string };
    };
    expect(output.change.min_qty).toBe(3000);
    expect(output.summary).toContain('Hari 0: 75 pesanan');
  });
});
