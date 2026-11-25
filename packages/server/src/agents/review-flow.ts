import {
  DEFAULT_TEXT,
  TASK_DURATION_SEC,
  blocksRepeat,
  dayMetrics,
  dayOf,
  evaluatePolicy,
  reviewContext,
  reviewFacts,
  reviewPolicyRule,
  type PolicyIngredient,
  type StoredEvent,
} from '@cafe/core';
import { readMemories, readOpenPolicyIngredients, readStock, type ReportRow } from '../db/queries';
import { listEvents } from '../events/store';
import { nextId, type Context, type Emit } from '../usecases/context';
import { decide, validationWorld, type Decided } from './decide';
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

/** Ingredients that must not be proposed: a proposal for them waits at the boss, or a note says not to try again. */
function blockedIngredients(ctx: Context): Set<string> {
  return new Set([
    ...readOpenPolicyIngredients(ctx.db),
    ...readMemories(ctx.db, 'stock_admin')
      .filter((entry) => entry.ingredient_id !== null && blocksRepeat(entry.text))
      .map((entry) => entry.ingredient_id as string),
  ]);
}

function note(
  emit: Emit,
  kind: 'observation' | 'reflection',
  text: string,
  ingredient_id?: string,
): void {
  emit({
    type: 'memory_created',
    actor: 'stock_admin',
    origin: 'rule',
    payload: {
      agent_id: 'stock_admin',
      kind,
      ...(ingredient_id !== undefined && { ingredient_id }),
      text,
    },
  });
}

/**
 * What came of the changes of policy the boss approved: the first night after a whole day under the new minimum,
 * she compares that day with the day the change was proposed for and writes down whether it helped. A change
 * that did not help is a note that says not to try it again. Every change is looked at once.
 */
function reflectOnChanges(
  ctx: Context,
  emit: Emit,
  day: number,
  events: readonly StoredEvent[],
  ingredients: readonly PolicyIngredient[],
): void {
  const reflections = readMemories(ctx.db, 'stock_admin').filter(
    (entry) => entry.kind === 'reflection',
  );
  for (const change of events) {
    if (change.type !== 'policy_changed') continue;
    const { ingredient_id, from, to, report_id } = change.payload;
    if (dayOf(change.sim_time) >= day) continue; // not a whole day under the new minimum yet
    if (
      reflections.some(
        (entry) => entry.ingredient_id === ingredient_id && entry.sim_time > change.sim_time,
      )
    ) {
      continue; // looked at already
    }
    const proposal = events.find(
      (event) => event.type === 'policy_proposed' && event.payload.report.report_id === report_id,
    );
    if (!proposal) continue;
    const outcome = evaluatePolicy(
      dayMetrics(events, dayOf(proposal.sim_time)),
      dayMetrics(events, day),
      ingredient_id,
    );
    const ingredient = ingredients.find((entry) => entry.ingredient_id === ingredient_id);
    note(
      emit,
      'reflection',
      DEFAULT_TEXT.reflectionText({
        name: ingredient?.name ?? ingredient_id,
        unit: ingredient?.unit ?? '',
        from,
        to,
        verdict: outcome.verdict,
        held_before: outcome.held_before,
        held_after: outcome.held_after,
        stockout_minutes_before: Math.round(outcome.stockout_before / 60),
        stockout_minutes_after: Math.round(outcome.stockout_after / 60),
      }),
      ingredient_id,
    );
  }
}

/** She has read the day. She decides what to say about it and what to propose, and writes both down. */
export function decideReview(ctx: Context, emit: Emit, day: number): void {
  if (reviewWritten(ctx, day)) return; // a day is reviewed once, also after a restart

  const epoch = ctx.db
    .prepare("SELECT COALESCE(MAX(id), 0) FROM events WHERE type = 'world_initialized'")
    .pluck()
    .get() as number;
  const events = listEvents(ctx.db, { afterId: epoch });
  const metrics = dayMetrics(events, day);

  const stock = readStock(ctx.db);
  const ingredients: PolicyIngredient[] = stock.map((row) => ({
    ingredient_id: row.ingredient_id,
    name: row.name,
    unit: row.unit,
    base_min_qty: row.base_min_qty,
    min_qty: row.min_qty,
    capacity_qty: row.capacity_qty,
  }));
  // First what came of what she proposed before: the notes she writes now are part of what she knows tonight.
  reflectOnChanges(ctx, emit, day, events, ingredients);
  const notes = readMemories(ctx.db, 'stock_admin');
  const blocked = blockedIngredients(ctx);

  decide(
    ctx,
    emit,
    {
      agent: 'stock_admin',
      purpose: 'policy_review',
      built: reviewContext({
        metrics,
        ingredients,
        lessons: notes.slice(-5).map((note) => note.text),
        blocked: [...blocked],
      }),
      world: () => ({ ...validationWorld(ctx), blocked: blockedIngredients(ctx) }),
      fallback: reviewPolicyRule(metrics, ingredients, { blocked }),
      refresh: () => reviewPolicyRule(metrics, ingredients, { blocked: blockedIngredients(ctx) }),
    },
    (decided, emitDecided) => {
      if (reviewWritten(ctx, day)) return; // the review was written while she thought
      writeReview(ctx, emitDecided, day, metrics, ingredients, decided);
    },
  );
}

/** What follows from the decision: the review, the note of the night, and the proposal for the boss if there is one. */
function writeReview(
  ctx: Context,
  emit: Emit,
  day: number,
  metrics: ReturnType<typeof dayMetrics>,
  ingredients: readonly PolicyIngredient[],
  decided: Decided<'policy_review'>,
): void {
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
  // What she saw tonight, about the ingredient that gave the most trouble when there was one.
  const facts = reviewFacts(metrics, ingredients);
  const worst = ingredients.find((entry) => entry.name === facts.worst[0]?.name);
  note(emit, 'observation', DEFAULT_TEXT.observationText(facts), worst?.ingredient_id);
  if (!change) return;

  // The minimum in force when the proposal is written, which may not be the one she read the day with.
  const current = readStock(ctx.db).find((row) => row.ingredient_id === change.ingredient_id);
  const named = ingredients.find((entry) => entry.ingredient_id === change.ingredient_id);
  if (!current || !named) return;
  const proposed = {
    name: named.name,
    unit: named.unit,
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
  const change = (report.subject as { change?: { ingredient_id: string; to: number } }).change;
  if (!change) return;
  const current = readStock(ctx.db).find((row) => row.ingredient_id === change.ingredient_id);
  if (!current) return;
  if (decision !== 'approved') {
    note(
      emit,
      'reflection',
      DEFAULT_TEXT.rejectedText({
        name: current.name,
        unit: current.unit,
        from: current.min_qty,
        to: change.to,
      }),
      change.ingredient_id,
    );
    return;
  }
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
