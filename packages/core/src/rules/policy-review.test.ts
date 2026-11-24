import { describe, expect, it } from 'vitest';
import { PolicyReviewSchema } from '../llm/contracts';
import { validateDecision, type ValidationWorld } from '../llm/validate';
import type { DayMetrics } from './day-metrics';
import {
  REVIEW_MIN_HELD,
  evaluatePolicy,
  pickPolicyChange,
  reviewFacts,
  reviewPolicyRule,
  type PolicyIngredient,
} from './policy-review';

const ingredient = (overrides: Partial<PolicyIngredient> = {}): PolicyIngredient => ({
  ingredient_id: 'susu',
  name: 'Susu',
  unit: 'ml',
  base_min_qty: 1000,
  min_qty: 1000,
  capacity_qty: 6000,
  ...overrides,
});
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
const none = { blocked: new Set<string>() };

describe('pickPolicyChange', () => {
  it('asks for a minimum one and a half times as high for the ingredient that held the most orders', () => {
    const pick = pickPolicyChange(
      metrics({ held_by_ingredient: { susu: 9, kopi: 3 } }),
      [
        ingredient(),
        ingredient({ ingredient_id: 'kopi', name: 'Kopi', min_qty: 300, base_min_qty: 300 }),
      ],
      none,
    );
    expect(pick).toMatchObject({ min_qty: 1500 });
    expect(pick?.ingredient.ingredient_id).toBe('susu');
  });

  it('needs enough trouble: a hold or two is nothing, a long stock-out is enough', () => {
    expect(REVIEW_MIN_HELD).toBe(2);
    const calm = metrics({ held: 1, held_by_ingredient: { susu: 1 }, stockout_sec: { susu: 600 } });
    expect(pickPolicyChange(calm, [ingredient()], none)).toBeNull();
    const out = metrics({ held: 0, held_by_ingredient: {}, stockout_sec: { susu: 1200 } });
    expect(pickPolicyChange(out, [ingredient()], none)?.min_qty).toBe(1500);
  });

  it('leaves out an ingredient that a lesson blocks, and goes to the next one', () => {
    const both = [
      ingredient(),
      ingredient({ ingredient_id: 'kopi', name: 'Kopi', min_qty: 300, base_min_qty: 300 }),
    ];
    const trouble = metrics({ held_by_ingredient: { susu: 9, kopi: 4 } });
    expect(
      pickPolicyChange(trouble, both, { blocked: new Set(['susu']) })?.ingredient.ingredient_id,
    ).toBe('kopi');
    expect(pickPolicyChange(trouble, both, { blocked: new Set(['susu', 'kopi']) })).toBeNull();
  });

  it('stays within what a boss may be asked: no higher than 3x the start, and not above the shelf', () => {
    const high = ingredient({ min_qty: 2800 }); // 1.5x is 4200, the most is 3000
    expect(pickPolicyChange(metrics(), [high], none)?.min_qty).toBe(3000);
    expect(pickPolicyChange(metrics(), [ingredient({ min_qty: 3000 })], none)).toBeNull(); // already at the most
    expect(pickPolicyChange(metrics(), [ingredient({ capacity_qty: 1200 })], none)?.min_qty).toBe(
      1200,
    );
  });

  it('is the same for the same input, and breaks a tie by ingredient id', () => {
    const tie = metrics({ held_by_ingredient: { kopi: 3, susu: 3 }, stockout_sec: {} });
    const both = [
      ingredient(),
      ingredient({ ingredient_id: 'kopi', name: 'Kopi', min_qty: 300, base_min_qty: 300 }),
    ];
    expect(pickPolicyChange(tie, both, none)?.ingredient.ingredient_id).toBe('kopi');
  });
});

describe('reviewPolicyRule', () => {
  const world: ValidationWorld = {
    ingredients: new Map([['susu', { qty: 800, capacity_qty: 6000, base_min_qty: 1000 }]]),
  };

  it('writes a summary of the day and the change, in the shape of the contract, and one that a boss may be asked', () => {
    const review = reviewPolicyRule(metrics(), [ingredient()], none);
    expect(PolicyReviewSchema.safeParse(review).success).toBe(true);
    expect(validateDecision('policy_review', review, world).ok).toBe(true);
    expect(review.change).toEqual({ ingredient_id: 'susu', min_qty: 1500 });
    expect(review.summary).toContain('Hari 0: 75 pesanan');
    expect(review.summary).toContain('Susu (9x menahan pesanan, habis 40 menit)');
  });

  it('says that nothing needs changing on a day without trouble, and still writes the summary', () => {
    const calm = metrics({ held: 0, held_by_ingredient: {}, stockout_sec: {}, complaints: 0 });
    const review = reviewPolicyRule(calm, [ingredient()], none);
    expect(review.change).toBeUndefined();
    expect(review.summary).toContain('Tidak ada bahan yang bermasalah');
    expect(PolicyReviewSchema.safeParse(review).success).toBe(true);
  });
});

describe('reviewFacts', () => {
  it('lists the ingredients with trouble, worst first, at most three', () => {
    const many = ['a', 'b', 'c', 'd'].map((id) =>
      ingredient({ ingredient_id: id, name: id.toUpperCase() }),
    );
    const facts = reviewFacts(
      metrics({ held_by_ingredient: { a: 1, b: 5, c: 3, d: 2 }, stockout_sec: { a: 3000 } }),
      many,
    );
    expect(facts.worst.map((item) => item.name)).toEqual(['B', 'C', 'D']);
    expect(facts.worst[0]).toMatchObject({ held: 5, stockout_minutes: 0 });
  });
});

describe('evaluatePolicy', () => {
  it('says it helped when fewer orders were held', () => {
    const after = metrics({ held_by_ingredient: { susu: 2 }, stockout_sec: { susu: 300 } });
    expect(evaluatePolicy(metrics(), after, 'susu')).toEqual({
      verdict: 'helped',
      held_before: 9,
      held_after: 2,
      stockout_before: 2400,
      stockout_after: 300,
    });
  });

  it('says it helped when as many were held but the stock-out was clearly shorter', () => {
    const after = metrics({ held_by_ingredient: { susu: 9 }, stockout_sec: { susu: 1900 } });
    expect(evaluatePolicy(metrics(), after, 'susu').verdict).toBe('helped'); // 1900 <= 0.8 * 2400
    const barely = metrics({ held_by_ingredient: { susu: 9 }, stockout_sec: { susu: 2300 } });
    expect(evaluatePolicy(metrics(), barely, 'susu').verdict).toBe('no_help');
  });

  it('says it did not help when more or as many were held and the stock-out was no shorter', () => {
    const worse = metrics({ held_by_ingredient: { susu: 12 }, stockout_sec: { susu: 3000 } });
    expect(evaluatePolicy(metrics(), worse, 'susu').verdict).toBe('no_help');
  });

  it('has nothing to judge when the ingredient gave no trouble before', () => {
    const calm = metrics({ held_by_ingredient: {}, stockout_sec: {} });
    expect(evaluatePolicy(calm, metrics(), 'susu').verdict).toBe('unclear');
  });
});
