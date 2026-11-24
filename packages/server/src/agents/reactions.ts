import type { StoredEvent } from '@cafe/core';
import { readReport } from '../db/queries';
import type { Context, Emit } from '../usecases/context';
import { kick, readTask } from './engine';
import {
  answerAfterDecision,
  onComplaintReceived,
  onComplaintReportDecided,
  triageAndAnswer,
} from './complaint-flow';
import { decideForecast } from './forecast-flow';
import { decideReview, onPolicyReportDecided, scheduleReview } from './review-flow';
import { finishCooking, handOrderToCook, onOrderCreated, resumeHeldOrders } from './order-flow';
import {
  decideRestock,
  onRestockReportDecided,
  placeRestockOrders,
  scheduleStockCheck,
  submitReport,
} from './restock-flow';

/**
 * What the characters do in response to an event (decision 022). It runs for every event written in
 * a step, inside the step's transaction, in the order the events were written. The engine's own part:
 * a new task gets going when the agent is free, and a finished task gives way to the next one.
 */
export function reactToEvent(ctx: Context, event: StoredEvent, emit: Emit): void {
  switch (event.type) {
    case 'order_created':
      return onOrderCreated(ctx, event, emit);

    case 'stock_low':
    case 'stock_out':
      return scheduleStockCheck(ctx, emit);

    case 'report_decided': {
      const report = readReport(ctx.db, event.payload.report_id);
      if (report?.type === 'restock') {
        onRestockReportDecided(ctx, emit, report, event.payload.decision);
      } else if (report?.type === 'complaint') {
        onComplaintReportDecided(ctx, emit, report);
      } else if (report?.type === 'policy') {
        onPolicyReportDecided(ctx, emit, report, event.payload.decision);
      }
      return;
    }

    case 'day_closed':
      return scheduleReview(ctx, emit, event.payload.day);

    case 'complaint_received':
      return onComplaintReceived(ctx, emit, event.payload.complaint_id);

    case 'restock_arrived':
      return resumeHeldOrders(ctx, emit);

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

function onTaskFinished(
  ctx: Context,
  event: Extract<StoredEvent, { type: 'agent_task_finished' }>,
  emit: Emit,
): void {
  const task = readTask(ctx.db, event.payload.task_id);
  if (!task || task.kind !== 'work' || !task.label) return;
  const ref = task.ref;

  switch (task.label) {
    case 'recording_order':
      if (task.agent_id === 'cashier' && ref?.type === 'order')
        handOrderToCook(ctx, emit, Number(ref.id));
      return;
    case 'cooking':
      if (task.agent_id === 'cook' && ref?.type === 'order')
        finishCooking(ctx, emit, Number(ref.id));
      return;
    case 'checking_stock':
      return decideRestock(ctx, emit);
    case 'forecasting':
      return decideForecast(ctx, emit);
    case 'reviewing_day':
      if (ref?.type === 'day') return decideReview(ctx, emit, Number(ref.id));
      return;
    case 'submitting_report':
      if (ref?.type === 'report') submitReport(ctx, emit, task.agent_id, Number(ref.id));
      return;
    case 'placing_order':
      if (ref?.type === 'report') placeRestockOrders(ctx, emit, Number(ref.id));
      return;
    case 'waiting_retry':
      return scheduleStockCheck(ctx, emit);
    case 'noting_complaint':
      if (ref?.type === 'complaint') triageAndAnswer(ctx, emit, Number(ref.id));
      return;
    case 'replying_customer':
      if (ref?.type === 'complaint') answerAfterDecision(ctx, emit, Number(ref.id));
      return;
    default:
      return;
  }
}
