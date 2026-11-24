import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '../events';
import { simTime } from '../time';
import { dayMetrics } from './day-metrics';

let id = 0;
/** An event for a test: only what `dayMetrics` looks at has to be right. */
const e = (type: string, sim_time: number, payload: object = {}): StoredEvent =>
  ({ id: (id += 1), type, sim_time, actor: 'world', origin: 'rule', payload }) as StoredEvent;

const at = (day: number, hours: number, minutes = 0) => simTime(day, hours, minutes);
const held = (time: number, ...ingredients: string[]) =>
  e('order_held', time, {
    order_id: 1,
    missing: ingredients.map((ingredient_id) => ({ ingredient_id, needed: 100, available: 0 })),
  });

describe('dayMetrics', () => {
  it('counts the orders, the cooked orders and the complaints of the day, and nothing of other days', () => {
    const log = [
      e('order_created', at(0, 12)),
      e('order_created', at(1, 9)),
      e('order_created', at(1, 10)),
      e('cooking_done', at(1, 11)),
      e('complaint_received', at(1, 12)),
      e('order_created', at(2, 9)),
    ];
    expect(dayMetrics(log, 1)).toMatchObject({ day: 1, orders: 2, done: 1, complaints: 1 });
    expect(dayMetrics(log, 0)).toMatchObject({ orders: 1, done: 0, complaints: 0 });
  });

  it('counts a held order once for every ingredient it missed, and the holds in all', () => {
    const log = [held(at(0, 11), 'susu'), held(at(0, 12), 'susu', 'kopi'), held(at(1, 9), 'teh')];
    const metrics = dayMetrics(log, 0);
    expect(metrics.held).toBe(2);
    expect(metrics.held_by_ingredient).toEqual({ susu: 2, kopi: 1 });
  });

  it('counts the time an ingredient was out, from stock_out until a delivery of it arrives', () => {
    const log = [
      e('stock_out', at(0, 11), { ingredient_id: 'susu' }),
      e('restock_arrived', at(0, 11, 40), {
        restock_id: 1,
        items: [{ ingredient_id: 'susu', qty: 1000 }],
      }),
    ];
    expect(dayMetrics(log, 0).stockout_sec).toEqual({ susu: 40 * 60 });
  });

  it('does not let the delivery of another ingredient end it, and ignores a second stock_out while it is out', () => {
    const log = [
      e('stock_out', at(0, 11), { ingredient_id: 'susu' }),
      e('stock_out', at(0, 11, 10), { ingredient_id: 'susu' }),
      e('restock_arrived', at(0, 11, 20), {
        restock_id: 1,
        items: [{ ingredient_id: 'kopi', qty: 100 }],
      }),
      e('restock_arrived', at(0, 11, 30), {
        restock_id: 2,
        items: [{ ingredient_id: 'susu', qty: 100 }],
      }),
    ];
    expect(dayMetrics(log, 0).stockout_sec).toEqual({ susu: 30 * 60 });
  });

  it('counts only the part of a stock-out that falls in the day, whether it began before or goes on after', () => {
    const log = [
      e('stock_out', at(0, 23), { ingredient_id: 'susu' }),
      e('restock_arrived', at(1, 8, 30), {
        restock_id: 1,
        items: [{ ingredient_id: 'susu', qty: 100 }],
      }),
    ];
    expect(dayMetrics(log, 0).stockout_sec).toEqual({ susu: 3600 }); // 23:00 to midnight
    expect(dayMetrics(log, 1).stockout_sec).toEqual({ susu: 8.5 * 3600 }); // midnight to 08:30
  });

  it('closes a stock-out that is still going at the end of the day, and starts the next day with it', () => {
    const log = [e('stock_out', at(0, 18), { ingredient_id: 'susu' })];
    expect(dayMetrics(log, 0).stockout_sec).toEqual({ susu: 6 * 3600 });
    expect(dayMetrics(log, 1).stockout_sec).toEqual({ susu: 24 * 3600 });
  });

  it('is empty for a day without anything', () => {
    expect(dayMetrics([], 3)).toEqual({
      day: 3,
      orders: 0,
      done: 0,
      held: 0,
      held_by_ingredient: {},
      stockout_sec: {},
      complaints: 0,
    });
  });
});
