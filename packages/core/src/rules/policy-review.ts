import type { PolicyReviewSchema } from '../llm/contracts';
import { DEFAULT_TEXT, fit, type OutcomeText, type ReviewFacts, type TextSet } from '../text';
import type { z } from 'zod';
import type { DayMetrics } from './day-metrics';
import { policyBounds } from './policy';

// The nightly review of the stock admin (decision 034), as a rule: which ingredient gave the most trouble
// today and whether its minimum stock should go up. It is the answer when no model answers, and the yardstick
// for the answer of a model. And the rule that judges, the day after, whether a change helped.

export type PolicyReview = z.infer<typeof PolicyReviewSchema>;

/** An ingredient is only worth a proposal when it held orders this many times, or was out for this long. */
export const REVIEW_MIN_HELD = 2;
export const REVIEW_MIN_OUT_SEC = 15 * 60;
/** A proposal raises the minimum by this much (percent of the current minimum). */
export const REVIEW_RAISE_PCT = 150;

export interface PolicyIngredient {
  ingredient_id: string;
  name: string;
  unit: string;
  /** The minimum stock the cafe started with, and the one that is in force now. */
  base_min_qty: number;
  min_qty: number;
  capacity_qty: number;
}

export interface PolicyLessons {
  /** Ingredients not to propose again: a change did not help, or the boss refused it. */
  blocked: ReadonlySet<string>;
}

/** The trouble an ingredient gave today, for sorting and for the words of the summary. */
export function troubleOf(metrics: DayMetrics, ingredient: PolicyIngredient) {
  return {
    held: metrics.held_by_ingredient[ingredient.ingredient_id] ?? 0,
    stockout_sec: metrics.stockout_sec[ingredient.ingredient_id] ?? 0,
  };
}

/** The facts of a day in the shape the texts want: the ingredients with trouble, worst first. */
export function reviewFacts(
  metrics: DayMetrics,
  ingredients: readonly PolicyIngredient[],
): ReviewFacts {
  const worst = ingredients
    .map((ingredient) => ({ ingredient, ...troubleOf(metrics, ingredient) }))
    .filter((entry) => entry.held > 0 || entry.stockout_sec >= 60)
    .sort(
      (a, b) =>
        b.held - a.held ||
        b.stockout_sec - a.stockout_sec ||
        (a.ingredient.ingredient_id < b.ingredient.ingredient_id ? -1 : 1),
    )
    .slice(0, 3)
    .map((entry) => ({
      name: entry.ingredient.name,
      unit: entry.ingredient.unit,
      held: entry.held,
      stockout_minutes: Math.round(entry.stockout_sec / 60),
    }));
  return {
    day: metrics.day,
    orders: metrics.orders,
    done: metrics.done,
    held: metrics.held,
    complaints: metrics.complaints,
    worst,
  };
}

/**
 * The ingredient to ask a higher minimum for, and what to ask: the one with the most held orders (then the
 * longest out), if it gave enough trouble, was not blocked by a lesson, and the minimum can still go up.
 */
export function pickPolicyChange(
  metrics: DayMetrics,
  ingredients: readonly PolicyIngredient[],
  lessons: PolicyLessons,
): { ingredient: PolicyIngredient; min_qty: number } | null {
  const ranked = ingredients
    .map((ingredient) => ({ ingredient, ...troubleOf(metrics, ingredient) }))
    .filter(
      (entry) =>
        !lessons.blocked.has(entry.ingredient.ingredient_id) &&
        (entry.held >= REVIEW_MIN_HELD || entry.stockout_sec >= REVIEW_MIN_OUT_SEC),
    )
    .sort(
      (a, b) =>
        b.held - a.held ||
        b.stockout_sec - a.stockout_sec ||
        (a.ingredient.ingredient_id < b.ingredient.ingredient_id ? -1 : 1),
    );
  for (const entry of ranked) {
    const { ingredient } = entry;
    const bounds = policyBounds(ingredient.base_min_qty, ingredient.capacity_qty);
    const raised = Math.min(
      bounds.max,
      Math.max(
        ingredient.min_qty + 1,
        Math.ceil((ingredient.min_qty * REVIEW_RAISE_PCT) / 100 / 10) * 10,
      ),
    );
    if (raised > ingredient.min_qty) return { ingredient, min_qty: raised };
  }
  return null;
}

/** The review as a rule: the summary of the day, and the change that picks out. */
export function reviewPolicyRule(
  metrics: DayMetrics,
  ingredients: readonly PolicyIngredient[],
  lessons: PolicyLessons,
  text: TextSet = DEFAULT_TEXT,
): PolicyReview {
  const facts = reviewFacts(metrics, ingredients);
  const pick = pickPolicyChange(metrics, ingredients, lessons);
  const summary = fit(text.reviewSummary(facts), 300);
  if (!pick) return { summary, rationale: fit(text.reviewRationale(null, 0), 200) };
  const held = metrics.held_by_ingredient[pick.ingredient.ingredient_id] ?? 0;
  return {
    summary,
    change: { ingredient_id: pick.ingredient.ingredient_id, min_qty: pick.min_qty },
    rationale: fit(
      text.reviewRationale(
        {
          name: pick.ingredient.name,
          unit: pick.ingredient.unit,
          from: pick.ingredient.min_qty,
          to: pick.min_qty,
        },
        held,
      ),
      200,
    ),
  };
}

export interface PolicyOutcome {
  verdict: OutcomeText['verdict'];
  held_before: number;
  held_after: number;
  stockout_before: number;
  stockout_after: number;
}

/**
 * Whether a raised minimum helped: the day it was decided against the day after. It helped when fewer orders
 * were held, or the same number but the ingredient was out clearly shorter (at least a fifth). When neither
 * day had trouble with the ingredient there is nothing to judge.
 */
export function evaluatePolicy(
  before: DayMetrics,
  after: DayMetrics,
  ingredientId: string,
): PolicyOutcome {
  const held_before = before.held_by_ingredient[ingredientId] ?? 0;
  const held_after = after.held_by_ingredient[ingredientId] ?? 0;
  const stockout_before = before.stockout_sec[ingredientId] ?? 0;
  const stockout_after = after.stockout_sec[ingredientId] ?? 0;
  let verdict: PolicyOutcome['verdict'];
  if (held_before === 0 && stockout_before === 0) verdict = 'unclear';
  else if (
    held_after < held_before ||
    (held_after === held_before && stockout_before > 0 && stockout_after <= stockout_before * 0.8)
  )
    verdict = 'helped';
  else verdict = 'no_help';
  return { verdict, held_before, held_after, stockout_before, stockout_after };
}
