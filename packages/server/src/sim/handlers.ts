import { complaintCause, type DueItem, type Scenario } from '@cafe/core';
import { DomainError, nextId, transact, type Context } from '../usecases/context';
import { createOrder } from '../usecases/orders';
import { finishTask } from '../agents/engine';
import { scheduleForecast } from '../agents/forecast-flow';

/** Does what a due item says. Runs with `ctx.clock.now()` equal to the time of the item. */
export function handleDueItem(ctx: Context, item: DueItem, scenario: Scenario): void {
  switch (item.kind) {
    case 'day_opened':
    case 'day_closed':
      transact(ctx, (emit) => {
        emit({
          type: item.kind,
          actor: 'system',
          origin: 'scheduler',
          payload: { day: item.day },
        });
      });
      return;

    case 'regular_expected':
      transact(ctx, (emit) => {
        emit({
          type: 'regular_expected',
          actor: 'system',
          origin: 'scheduler',
          payload: {
            regular_id: item.regular_id,
            table_id: item.table_id,
            expected_at: item.expected_at,
          },
        });
      });
      return;

    case 'customer_arrival':
      // A customer comes in at the door; it places its order when it has walked to the cashier.
      transact(ctx, (emit) => {
        emit({
          type: 'customer_arrived',
          actor: 'world',
          origin: 'generator',
          payload: { customer_id: item.customer_id },
        });
      });
      return;

    case 'order_arrival':
      // The generator uses the same door as POST /orders (decision 020).
      createOrder(ctx, { items: item.items, customer_id: item.customer_id });
      return;

    case 'stock_forecast':
      // The stock admin looks ahead, when she has the time and there is something to order.
      transact(ctx, (emit) => scheduleForecast(ctx, emit));
      return;

    case 'complaint_check':
      checkComplaints(ctx, scenario);
      return;

    case 'task_end':
      // The agent's time is up. The reactions decide what comes next (decision 022).
      transact(ctx, (emit) => finishTask(emit, item.agent_id, item.task_id));
      return;

    case 'restock_arrival':
      handleRestockArrival(ctx, item.restock_id);
      return;
  }
}

/** The supplier delivers what was ordered. */
function handleRestockArrival(ctx: Context, restockId: number): void {
  const itemsJson = ctx.db
    .prepare("SELECT items_json FROM restock_orders WHERE id = ? AND status = 'ordered'")
    .pluck()
    .get(restockId) as string | undefined;
  if (itemsJson === undefined) throw new Error(`restock ${restockId} is not waiting for delivery`);
  transact(ctx, (emit) => {
    emit({
      type: 'restock_arrived',
      actor: 'world',
      origin: 'generator',
      payload: { restock_id: restockId, items: JSON.parse(itemsJson) },
    });
  });
}

interface WaitingOrderRow {
  id: number;
  created_at_sim: number;
}

/**
 * Looks at the orders that nobody served yet and lets the customer complain when the rules say so
 * (`complaintCause`). Each order complains at most once.
 */
export function checkComplaints(ctx: Context, scenario: Scenario): void {
  const now = ctx.clock.now();
  const candidates = ctx.db
    .prepare(
      `SELECT o.id, o.created_at_sim
       FROM orders o
       WHERE o.status <> 'done'
         AND o.created_at_sim <= ?
         AND NOT EXISTS (SELECT 1 FROM complaints c WHERE c.order_id = o.id)
       ORDER BY o.id`,
    )
    .all(now - scenario.complaintWaitSec) as WaitingOrderRow[];

  const complaining = candidates.flatMap((order) => {
    const cause = complaintCause(order, now, scenario);
    return cause === null ? [] : [{ order, cause }];
  });
  if (complaining.length === 0) return;

  transact(ctx, (emit) => {
    for (const { order, cause } of complaining) {
      emit({
        type: 'complaint_received',
        actor: 'world',
        origin: 'generator',
        payload: {
          complaint_id: nextId(ctx.db, 'complaints'),
          order_id: order.id,
          cause,
        },
      });
    }
  });
}

export { DomainError };
