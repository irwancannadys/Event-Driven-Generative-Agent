import {
  cookDurationSec,
  ingredientNeeds,
  planCooking,
  thresholdSignals,
  type MissingIngredient,
} from '@cafe/core';
import { readMenu, readOrder, readOrderItems, readRecipe, readStock } from '../db/queries';
import { DomainError, transact, type Context } from './context';

export type StartCookingResult =
  { held: false; duration_sim_sec: number } | { held: true; missing: MissingIngredient[] };

/**
 * The cook picks up an order that is waiting (status `placed`).
 * - Enough ingredients: `cooking_started`, then one `stock_decreased` per ingredient, then `stock_low`
 *   and/or `stock_out` for every ingredient that crossed a threshold for the first time.
 * - Not enough: `order_held` and the stock stays untouched (all or nothing).
 * It all happens in one transaction. Stage 3 will let the cook agent call this; for now a script does.
 */
export function startCooking(ctx: Context, orderId: number): StartCookingResult {
  return transact(ctx, (emit) => {
    const order = readOrder(ctx.db, orderId);
    if (!order) throw new DomainError('order_not_found', `order ${orderId} does not exist`);
    if (order.status !== 'placed') {
      throw new DomainError(
        'order_not_placed',
        `order ${orderId} cannot be started: it is ${order.status}`,
      );
    }

    const items = readOrderItems(ctx.db, orderId);
    let needs;
    try {
      needs = ingredientNeeds(items, readRecipe(ctx.db));
    } catch (error) {
      throw new DomainError('no_recipe', (error as Error).message);
    }
    const stockRows = readStock(ctx.db);
    const stock = Object.fromEntries(stockRows.map((row) => [row.ingredient_id, row.qty]));
    const plan = planCooking(needs, stock);

    if (!plan.ok) {
      emit({
        type: 'order_held',
        actor: 'cook',
        origin: 'rule',
        payload: { order_id: orderId, missing: plan.missing },
      });
      return { held: true, missing: plan.missing };
    }

    const duration_sim_sec = cookDurationSec(items, readMenu(ctx.db));
    emit({
      type: 'cooking_started',
      actor: 'cook',
      origin: 'rule',
      payload: { order_id: orderId, duration_sim_sec },
    });
    for (const decrement of plan.decrements) {
      emit({
        type: 'stock_decreased',
        actor: 'cook',
        origin: 'rule',
        payload: { ...decrement, order_id: orderId },
      });
    }
    for (const decrement of plan.decrements) {
      const row = stockRows.find(
        (candidate) => candidate.ingredient_id === decrement.ingredient_id,
      );
      if (!row) continue; // planCooking only plans ingredients that have a stock row
      const signals = thresholdSignals({
        qtyAfter: decrement.new_qty,
        minQty: row.min_qty,
        lowFlagged: row.low_flagged,
        outFlagged: row.out_flagged,
      });
      if (signals.low) {
        emit({
          type: 'stock_low',
          actor: 'system',
          origin: 'rule',
          payload: {
            ingredient_id: decrement.ingredient_id,
            qty: decrement.new_qty,
            min_qty: row.min_qty,
          },
        });
      }
      if (signals.out) {
        emit({
          type: 'stock_out',
          actor: 'system',
          origin: 'rule',
          payload: { ingredient_id: decrement.ingredient_id },
        });
      }
    }
    return { held: false, duration_sim_sec };
  });
}

/** The order is ready. Only an order that is being cooked can be completed. */
export function completeCooking(ctx: Context, orderId: number): void {
  transact(ctx, (emit) => {
    const order = readOrder(ctx.db, orderId);
    if (!order) throw new DomainError('order_not_found', `order ${orderId} does not exist`);
    if (order.status !== 'cooking') {
      throw new DomainError(
        'order_not_cooking',
        `order ${orderId} cannot be completed: it is ${order.status}`,
      );
    }
    emit({ type: 'cooking_done', actor: 'cook', origin: 'rule', payload: { order_id: orderId } });
  });
}
