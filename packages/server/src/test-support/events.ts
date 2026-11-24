import { OPEN_TIME_SEC, type Event, type OrderItem } from '@cafe/core';

// Small builders for valid events, used by the tests. Everything happens at 08:00 unless stated.

export const AT = OPEN_TIME_SEC;

export const ev = {
  orderCreated(
    order_id: number,
    items: OrderItem[] = [{ menu_item_id: 'kopi_susu', qty: 1 }],
    sim_time = AT,
  ): Event {
    return {
      type: 'order_created',
      sim_time,
      actor: 'world',
      origin: 'generator',
      payload: { order_id, source: 'walk_in', items },
    };
  },

  orderHeld(
    order_id: number,
    missing = [{ ingredient_id: 'susu', needed: 150, available: 100 }],
    sim_time = AT,
  ): Event {
    return {
      type: 'order_held',
      sim_time,
      actor: 'cook',
      origin: 'rule',
      payload: { order_id, missing },
    };
  },

  cookingStarted(order_id: number, duration_sim_sec = 180, sim_time = AT): Event {
    return {
      type: 'cooking_started',
      sim_time,
      actor: 'cook',
      origin: 'rule',
      payload: { order_id, duration_sim_sec },
    };
  },

  stockDecreased(
    order_id: number,
    ingredient_id: string,
    qty: number,
    new_qty: number,
    sim_time = AT,
  ): Event {
    return {
      type: 'stock_decreased',
      sim_time,
      actor: 'cook',
      origin: 'rule',
      payload: { ingredient_id, qty, new_qty, order_id },
    };
  },

  cookingDone(order_id: number, sim_time = AT): Event {
    return { type: 'cooking_done', sim_time, actor: 'cook', origin: 'rule', payload: { order_id } };
  },

  stockLow(ingredient_id: string, qty: number, min_qty: number, sim_time = AT): Event {
    return {
      type: 'stock_low',
      sim_time,
      actor: 'system',
      origin: 'rule',
      payload: { ingredient_id, qty, min_qty },
    };
  },

  stockOut(ingredient_id: string, sim_time = AT): Event {
    return {
      type: 'stock_out',
      sim_time,
      actor: 'system',
      origin: 'rule',
      payload: { ingredient_id },
    };
  },
};
