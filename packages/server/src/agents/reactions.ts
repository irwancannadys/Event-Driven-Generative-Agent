import { TASK_DURATION_SEC, cookDurationSec, type StoredEvent } from '@cafe/core';
import { readMenu, readOrder, readOrderItems } from '../db/queries';
import type { Context, Emit } from '../usecases/context';
import { enqueueWork, kick, readTask } from './engine';

/**
 * What the characters do in response to an event (decision 022). It runs for every event written in
 * a step, inside the step's transaction, in the order the events were written. The engine's own part:
 * a new task gets going when the agent is free, and a finished task gives way to the next one.
 */
export function reactToEvent(ctx: Context, event: StoredEvent, emit: Emit): void {
  switch (event.type) {
    case 'order_created':
      return onOrderCreated(ctx, event, emit);

    case 'agent_task_assigned':
      kick(ctx, emit, event.payload.agent_id);
      return;

    case 'agent_task_finished':
      // What the finished task means for the cafe first, then the agent moves on.
      onTaskFinished(ctx, event, emit);
      kick(ctx, emit, event.payload.agent_id);
      return;

    default:
      return;
  }
}

/** A walk-in order reaches the cashier, who writes it down. */
function onOrderCreated(
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

function onTaskFinished(
  ctx: Context,
  event: Extract<StoredEvent, { type: 'agent_task_finished' }>,
  emit: Emit,
): void {
  const task = readTask(ctx.db, event.payload.task_id);
  if (!task || task.kind !== 'work' || !task.label) return;

  if (
    task.agent_id === 'cashier' &&
    task.label === 'recording_order' &&
    task.ref?.type === 'order'
  ) {
    handOrderToCook(ctx, emit, Number(task.ref.id));
    return;
  }
  if (task.agent_id === 'cook' && task.label === 'cooking' && task.ref?.type === 'order') {
    finishCooking(ctx, emit, Number(task.ref.id));
  }
}

/** The order is written down: the cook gets a cooking task as long as the recipes say. */
function handOrderToCook(ctx: Context, emit: Emit, orderId: number): void {
  if (!readOrder(ctx.db, orderId)) return;
  const duration = cookDurationSec(readOrderItems(ctx.db, orderId), readMenu(ctx.db));
  enqueueWork(ctx, emit, 'cook', 'kitchen', {
    label: 'cooking',
    duration_sim_sec: duration,
    ref: { type: 'order', id: orderId },
  });
}

/** The cooking time is up. An order that was held instead (its task was skipped) is not done. */
function finishCooking(ctx: Context, emit: Emit, orderId: number): void {
  if (readOrder(ctx.db, orderId)?.status !== 'cooking') return;
  emit({ type: 'cooking_done', actor: 'cook', origin: 'rule', payload: { order_id: orderId } });
}
