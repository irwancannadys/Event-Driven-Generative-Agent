import type { StoredEvent } from '../events';
import { SECONDS_PER_DAY, type SimTime } from '../time';

// What one day looked like, counted from the log (decision 034). The stock admin reviews her day with
// these numbers, and the day after a policy change they say whether it helped. Pure: the log goes in, the
// numbers come out.

export interface DayMetrics {
  day: number;
  /** Orders that came in, and orders that were cooked. */
  orders: number;
  done: number;
  /** How many times an order was held for lack of ingredients, and for which ingredient (an order can miss several). */
  held: number;
  held_by_ingredient: Record<string, number>;
  /** Seconds this day that an ingredient was out (from `stock_out` until a delivery arrived). */
  stockout_sec: Record<string, number>;
  complaints: number;
}

/**
 * The metrics of `day`. `events` has to hold the log up to the end of that day, in order: a stock-out that
 * began the day before and went on into this one counts for the part that falls in this day.
 */
export function dayMetrics(events: readonly StoredEvent[], day: number): DayMetrics {
  const start = day * SECONDS_PER_DAY;
  const end = start + SECONDS_PER_DAY;
  const metrics: DayMetrics = {
    day,
    orders: 0,
    done: 0,
    held: 0,
    held_by_ingredient: {},
    stockout_sec: {},
    complaints: 0,
  };
  const outSince = new Map<string, SimTime>();
  const closeOut = (ingredient: string, until: SimTime): void => {
    const since = outSince.get(ingredient);
    if (since === undefined) return;
    outSince.delete(ingredient);
    const from = Math.max(since, start);
    const to = Math.min(until, end);
    if (to > from) {
      metrics.stockout_sec[ingredient] = (metrics.stockout_sec[ingredient] ?? 0) + (to - from);
    }
  };

  for (const event of events) {
    if (event.sim_time >= end) break;
    const inDay = event.sim_time >= start;
    switch (event.type) {
      case 'order_created':
        if (inDay) metrics.orders += 1;
        break;
      case 'cooking_done':
        if (inDay) metrics.done += 1;
        break;
      case 'complaint_received':
        if (inDay) metrics.complaints += 1;
        break;
      case 'order_held':
        if (!inDay) break;
        metrics.held += 1;
        for (const line of event.payload.missing) {
          metrics.held_by_ingredient[line.ingredient_id] =
            (metrics.held_by_ingredient[line.ingredient_id] ?? 0) + 1;
        }
        break;
      case 'stock_out':
        if (!outSince.has(event.payload.ingredient_id)) {
          outSince.set(event.payload.ingredient_id, event.sim_time);
        }
        break;
      case 'restock_arrived':
        for (const line of event.payload.items) closeOut(line.ingredient_id, event.sim_time);
        break;
      default:
        break;
    }
  }
  for (const ingredient of [...outSince.keys()]) closeOut(ingredient, end);
  return metrics;
}
