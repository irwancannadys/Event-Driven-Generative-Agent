import {
  TASK_DURATION_SEC,
  cookDurationSec,
  ingredientNeeds,
  planCooking,
  type StoredEvent,
} from '@cafe/core';
import { readMenu, readOrder, readOrderItems, readRecipe, readStock } from '../db/queries';
import type { Context, Emit } from '../usecases/context';
import { enqueueWork } from './engine';

// The life of an order among the characters: the cashier writes it down, the cook cooks it, and an
// order that was held for lack of ingredients is picked up again when a delivery arrives.

/** A walk-in order reaches the cashier, who writes it down. */
export function onOrderCreated(
  ctx: Context,
  event: Extract<StoredEvent, { type: 'order_created' }>,
  emit: Emit,
): void {
  if (event.payload.source !== 'walk_in') return; // a regular is served by Rina (stage 5)
  enqueueWork(ctx, emit, 'cashier', 'cashier', {
    label: 'recording_order',
    duration_sim_sec: TASK_DURATION_SEC.recording_order,
    ref: { type: 'order', id: event.payload.order_id },
  });
}

/** The order is written down: the cook gets a cooking task as long as the recipes say. */
export function handOrderToCook(ctx: Context, emit: Emit, orderId: number): void {
  if (!readOrder(ctx.db, orderId)) return;
  enqueueCooking(ctx, emit, orderId);
}

function enqueueCooking(ctx: Context, emit: Emit, orderId: number): void {
  const duration = cookDurationSec(readOrderItems(ctx.db, orderId), readMenu(ctx.db));
  enqueueWork(ctx, emit, 'cook', 'kitchen', {
    label: 'cooking',
    duration_sim_sec: duration,
    ref: { type: 'order', id: orderId },
  });
}

/** The cooking time is up. An order that was held instead (its task was skipped) is not done. */
export function finishCooking(ctx: Context, emit: Emit, orderId: number): void {
  if (readOrder(ctx.db, orderId)?.status !== 'cooking') return;
  emit({ type: 'cooking_done', actor: 'cook', origin: 'rule', payload: { order_id: orderId } });
}

/**
 * A delivery arrived: held orders get another chance, first in first out (decision 024). The stock is
 * counted down as orders are picked, so no more orders are resumed than the new stock can carry.
 * Orders that still do not fit stay held and wait for the next delivery.
 */
export function resumeHeldOrders(ctx: Context, emit: Emit): void {
  const held = ctx.db
    .prepare("SELECT id FROM orders WHERE status = 'held' ORDER BY id")
    .pluck()
    .all() as number[];
  if (held.length === 0) return;

  const recipe = readRecipe(ctx.db);
  const stock = Object.fromEntries(readStock(ctx.db).map((row) => [row.ingredient_id, row.qty]));
  for (const orderId of held) {
    const plan = planCooking(ingredientNeeds(readOrderItems(ctx.db, orderId), recipe), stock);
    if (!plan.ok) continue;
    for (const decrement of plan.decrements) stock[decrement.ingredient_id] = decrement.new_qty;
    emit({
      type: 'order_resumed',
      actor: 'system',
      origin: 'rule',
      payload: { order_id: orderId },
    });
    enqueueCooking(ctx, emit, orderId);
  }
}
