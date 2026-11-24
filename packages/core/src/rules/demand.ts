import type { OrderItem } from '../schema-parts';
import { SECONDS_PER_DAY, dayOf, secondsIntoDay, type SimTime } from '../time';
import { ingredientNeeds, type RecipeLine } from './cooking';

// What the cafe asked of its ingredients and when, and what that says about the next hours (decision 034).
// The demand is counted when an order comes in, not when it is cooked: an order that is held for lack of
// an ingredient is demand all the same, and counting the cooking would make the empty hours look quiet.

export interface DemandSample {
  time: SimTime;
  ingredient_id: string;
  qty: number;
}

/** The ingredients that the orders asked for, each at the moment its order came in. */
export function demandSamples(
  orders: readonly { sim_time: SimTime; items: readonly OrderItem[] }[],
  recipe: readonly RecipeLine[],
): DemandSample[] {
  const samples: DemandSample[] = [];
  for (const order of orders) {
    const needs = ingredientNeeds(order.items, recipe);
    for (const ingredient_id of Object.keys(needs).sort()) {
      samples.push({
        time: order.sim_time,
        ingredient_id,
        qty: needs[ingredient_id] as number,
      });
    }
  }
  return samples;
}

/** How many days back the forecast looks. */
export const FORECAST_LOOKBACK_DAYS = 3;

/**
 * The demand per ingredient in the `horizonSec` seconds from `now`, as it was at the same time of day on
 * each of the last `lookbackDays` whole days (their average, rounded up). `null` on the first day: there is
 * no past to look at, and nothing is made up.
 */
export function forecastDemand(
  samples: readonly DemandSample[],
  now: SimTime,
  horizonSec: number,
  lookbackDays = FORECAST_LOOKBACK_DAYS,
): Record<string, number> | null {
  const today = dayOf(now);
  const days = Math.min(lookbackDays, today);
  if (days <= 0) return null;

  const totals: Record<string, number> = {};
  for (let back = 1; back <= days; back += 1) {
    const from = (today - back) * SECONDS_PER_DAY + secondsIntoDay(now);
    const to = from + horizonSec;
    for (const sample of samples) {
      if (sample.time >= from && sample.time < to) {
        totals[sample.ingredient_id] = (totals[sample.ingredient_id] ?? 0) + sample.qty;
      }
    }
  }
  return Object.fromEntries(
    Object.entries(totals).map(([ingredient, total]) => [ingredient, Math.ceil(total / days)]),
  );
}
