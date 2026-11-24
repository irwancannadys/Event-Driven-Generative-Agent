import {
  DEFAULT_TEXT,
  TASK_DURATION_SEC,
  blocksRepeat,
  dayMetrics,
  reviewContext,
  reviewPolicyRule,
  type PolicyIngredient,
} from '@cafe/core';
import { readMemories, readOpenPolicyIngredients, readStock, type ReportRow } from '../db/queries';
import { listEvents } from '../events/store';
import { nextId, type Context, type Emit } from '../usecases/context';
import { decide, validationWorld } from './decide';
import { enqueueWork } from './engine';

// The nightly review of the stock admin (decision 034): when the cafe has closed she reads the day from the
// log, writes what she saw, and proposes at most one change of policy to the boss: the minimum stock of one
// ingredient. The boss decides; when he approves, the minimum really changes.

/** The cafe has closed: the review of that day goes on her list. */
export function scheduleReview(ctx: Context, emit: Emit, day: number): void {
  enqueueWork(ctx, emit, 'stock_admin', 'stock_shelf', {
    label: 'reviewing_day',
    duration_sim_sec: TASK_DURATION_SEC.reviewing_day,
    ref: { type: 'day', id: day },
  });
}

function reviewWritten(ctx: Context, day: number): boolean {
  const rows = ctx.db
    .prepare("SELECT payload_json FROM events WHERE type = 'daily_review_created'")
    .pluck()
    .all() as string[];
  return rows.some((json) => (JSON.parse(json) as { day: number }).day === day);
}

/** She has read the day. She decides what to say about it and what to propose, and writes both down. */
export function decideReview(ctx: Context, emit: Emit, day: number): void {
  if (reviewWritten(ctx, day)) return; // a day is reviewed once, also after a restart

  const epoch = ctx.db
    .prepare("SELECT COALESCE(MAX(id), 0) FROM events WHERE type = 'world_initialized'")
    .pluck()
    .get() as number;
  const metrics = dayMetrics(listEvents(ctx.db, { afterId: epoch }), day);

  const stock = readStock(ctx.db);
  const ingredients: PolicyIngredient[] = stock.map((row) => ({
    ingredient_id: row.ingredient_id,
    name: row.name,
    unit: row.unit,
    base_min_qty: row.base_min_qty,
    min_qty: row.min_qty,
    capacity_qty: row.capacity_qty,
  }));
  const notes = readMemories(ctx.db, 'stock_admin');
  const blocked = new Set([
    ...readOpenPolicyIngredients(ctx.db),
    ...notes
      .filter((note) => note.ingredient_id !== null && blocksRepeat(note.text))
      .map((note) => note.ingredient_id as string),
  ]);

  const decided = decide(ctx, emit, {
    agent: 'stock_admin',
    purpose: 'policy_review',
    built: reviewContext({
      metrics,
      ingredients,
      lessons: notes.slice(-5).map((note) => note.text),
      blocked: [...blocked],
    }),
    world: { ...validationWorld(ctx), blocked },
    fallback: reviewPolicyRule(metrics, ingredients, { blocked }),
  });
  const { summary, change, rationale } = decided.decision;

  emit({
    type: 'daily_review_created',
    actor: 'stock_admin',
    origin: decided.origin,
    payload: {
      day,
      summary,
      metrics: {
        orders: metrics.orders,
        done: metrics.done,
        held: metrics.held,
        complaints: metrics.complaints,
        held_by_ingredient: metrics.held_by_ingredient,
        stockout_sec: metrics.stockout_sec,
      },
    },
  });
  if (!change) return;

  const current = ingredients.find((entry) => entry.ingredient_id === change.ingredient_id);
  if (!current) return;
  const proposed = {
    name: current.name,
    unit: current.unit,
    from: current.min_qty,
    to: change.min_qty,
  };
  const report_id = nextId(ctx.db, 'reports');
  emit({
    type: 'policy_proposed',
    actor: 'stock_admin',
    origin: decided.origin,
    payload: {
      report: {
        report_id,
        title: DEFAULT_TEXT.policyTitle(proposed),
        body: DEFAULT_TEXT.policyBody(proposed, rationale),
      },
      change: { ingredient_id: change.ingredient_id, from: current.min_qty, to: change.min_qty },
      rationale,
    },
  });
  enqueueWork(ctx, emit, 'stock_admin', 'boss_desk', {
    label: 'submitting_report',
    duration_sim_sec: TASK_DURATION_SEC.submitting_report,
    ref: { type: 'report', id: report_id },
  });
}

/**
 * The boss decided on a proposal of policy. Approved: the minimum stock of the ingredient changes from now on,
 * and that is written as an event (so a replay changes it too). Rejected: nothing changes.
 */
export function onPolicyReportDecided(
  ctx: Context,
  emit: Emit,
  report: ReportRow,
  decision: 'approved' | 'rejected',
): void {
  if (decision !== 'approved') return;
  const change = (report.subject as { change?: { ingredient_id: string; to: number } }).change;
  if (!change) return;
  const current = readStock(ctx.db).find((row) => row.ingredient_id === change.ingredient_id);
  if (!current) return;
  emit({
    type: 'policy_changed',
    actor: 'system',
    origin: 'rule',
    payload: {
      ingredient_id: change.ingredient_id,
      from: current.min_qty,
      to: change.to,
      report_id: report.id,
    },
  });
}
