import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAKE_SCRIPT,
  FakeLLM,
  TASK_DURATION_SEC,
  makeScenario,
  simTime,
  type FakeLine,
  type StoredEvent,
} from '@cafe/core';
import { readStock } from '../db/queries';
import { listEvents } from '../events/store';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { bootSimulation } from '../sim/simulation';
import { ev } from '../test-support/events';
import { appendInTransaction, createTestDb } from '../test-support/world';
import { transact } from '../usecases/context';
import { decideReport } from '../usecases/reports';
import { decideReview } from './review-flow';

// The nightly review (decision 034): at 20:00 the stock admin takes 3 minutes to read the day, then writes her
// review, and proposes to the boss to raise the minimum of the ingredient that held the most orders.

const REVIEW_AT = simTime(0, 20);
const WRITTEN_AT = REVIEW_AT + TASK_DURATION_SEC.reviewing_day;

function boot(options: { llm?: FakeLLM | false; trouble?: boolean } = {}) {
  const db = createTestDb();
  const llm = options.llm === false ? undefined : (options.llm ?? new FakeLLM(DEFAULT_FAKE_SCRIPT));
  const sim = bootSimulation({
    db,
    scenario: makeScenario(42, { crowdPct: 0, complaintChancePct: 0 }),
    ...(llm && { llm }),
  });
  if (options.trouble !== false) {
    // three orders that waited for milk at lunch: the day has trouble with it
    appendInTransaction(
      db,
      ...[1, 2, 3].flatMap((id) => [
        ev.orderCreated(id, [{ menu_item_id: 'kopi_susu', qty: 1 }], simTime(0, 12, id)),
        ev.orderHeld(
          id,
          [{ ingredient_id: 'susu', needed: 150, available: 100 }],
          simTime(0, 12, id),
        ),
      ]),
    );
  }
  return { db, sim, llm };
}

const goTo = (sim: ReturnType<typeof boot>['sim'], time: number) =>
  sim.clock.advance(time - sim.clock.now());
const events = (db: ReturnType<typeof boot>['db'], ...types: string[]): StoredEvent[] =>
  listEvents(db).filter((event) => types.includes(event.type));
const reviews = (db: ReturnType<typeof boot>['db']) =>
  events(db, 'agent_task_assigned').filter(
    (event) => (event.payload as { label?: string }).label === 'reviewing_day',
  );

describe('the review at closing time', () => {
  it('goes on the list of the admin when the cafe closes, with the day it is about', () => {
    const { db, sim } = boot();
    goTo(sim, REVIEW_AT);
    expect(reviews(db)).toHaveLength(1);
    expect(reviews(db)[0]).toMatchObject({ sim_time: REVIEW_AT, actor: 'stock_admin' });
    expect(reviews(db)[0]?.payload).toMatchObject({
      label: 'reviewing_day',
      duration_sim_sec: TASK_DURATION_SEC.reviewing_day,
      ref: { type: 'day', id: 0 },
    });
    expect(events(db, 'daily_review_created')).toEqual([]); // she is still reading
  });

  it('is written 3 minutes later: the numbers of the day, counted from the log, and what she says about them', () => {
    const { db, sim } = boot();
    goTo(sim, WRITTEN_AT);
    const [review] = events(db, 'daily_review_created');
    expect(review).toMatchObject({ sim_time: WRITTEN_AT, actor: 'stock_admin', origin: 'llm' });
    expect(review?.payload).toMatchObject({
      day: 0,
      metrics: { orders: 3, done: 0, held: 3, complaints: 0, held_by_ingredient: { susu: 3 } },
    });
    expect((review?.payload as { summary: string }).summary).toContain('Hari 0: 3 pesanan');
    const [think, decided] = events(db, 'agent_think_requested', 'agent_decided').slice(-2);
    expect([think?.payload, decided?.payload]).toMatchObject([
      { purpose: 'policy_review' },
      { purpose: 'policy_review', think_event_id: think?.id },
    ]);
  });

  it('proposes to the boss to raise the minimum of the ingredient with the trouble, as a report on his desk', () => {
    const { db, sim } = boot();
    goTo(sim, WRITTEN_AT + 1000);
    const [proposed] = events(db, 'policy_proposed');
    expect(proposed).toMatchObject({ origin: 'llm', actor: 'stock_admin' });
    // the model asks for twice the minimum (1000 -> 2000), where the rule would ask for one and a half
    expect(proposed?.payload).toMatchObject({
      change: { ingredient_id: 'susu', from: 1000, to: 2000 },
    });
    const report = db
      .prepare("SELECT type, status, title FROM reports WHERE type = 'policy'")
      .get();
    expect(report).toEqual({
      type: 'policy',
      status: 'submitted', // she has walked to his desk and handed it in
      title: 'Usul kebijakan: batas minimum Susu 1000 jadi 2000 ml',
    });
    expect(events(db, 'report_submitted')).toHaveLength(1);
  });

  it('proposes with the rule when there is no model, one and a half times the minimum', () => {
    const { db, sim } = boot({ llm: false });
    goTo(sim, WRITTEN_AT);
    expect(events(db, 'policy_proposed')[0]).toMatchObject({ origin: 'rule' });
    expect(events(db, 'policy_proposed')[0]?.payload).toMatchObject({ change: { to: 1500 } });
  });

  it('writes a review and proposes nothing on a day without trouble, and does not go to the boss', () => {
    const { db, sim } = boot({ trouble: false });
    goTo(sim, WRITTEN_AT + 1000);
    expect(events(db, 'daily_review_created')).toHaveLength(1);
    expect(events(db, 'policy_proposed')).toEqual([]);
    expect(events(db, 'report_submitted')).toEqual([]);
    expect(
      (events(db, 'daily_review_created')[0]?.payload as { summary: string }).summary,
    ).toContain('Tidak ada bahan yang bermasalah');
  });

  it('reviews a day once, also when the question comes up again', () => {
    const { db, sim } = boot();
    goTo(sim, WRITTEN_AT);
    transact(sim.ctx, (emit) => decideReview(sim.ctx, emit, 0));
    expect(events(db, 'daily_review_created')).toHaveLength(1);
  });

  it('falls back to the rule when the model proposes something a boss may not be asked, and says why', () => {
    const wild: FakeLine[] = [
      {
        purpose: 'policy_review',
        answer: () => ({
          summary: 'Hari ini susu bermasalah.',
          change: { ingredient_id: 'susu', min_qty: 99_999 },
          rationale: 'Naikkan sebanyak-banyaknya.',
        }),
      },
    ];
    const { db, sim } = boot({ llm: new FakeLLM(wild) });
    goTo(sim, WRITTEN_AT);
    const decided = events(db, 'agent_decided').at(-1);
    expect(decided).toMatchObject({ origin: 'fallback' });
    expect(decided?.payload).toMatchObject({ fallback_reason: 'out_of_range', attempts: 3 });
    expect(events(db, 'policy_proposed')[0]).toMatchObject({ origin: 'fallback' });
    expect(events(db, 'policy_proposed')[0]?.payload).toMatchObject({ change: { to: 1500 } });
  });
});

describe('the decision of the boss', () => {
  const approve = (sim: ReturnType<typeof boot>['sim'], decision: 'approved' | 'rejected') => {
    const reportId = sim.ctx.db
      .prepare("SELECT id FROM reports WHERE type = 'policy'")
      .pluck()
      .get() as number;
    decideReport(sim.ctx, { report_id: reportId, decision });
  };

  it('changes the minimum stock from then on when he approves', () => {
    const { db, sim } = boot();
    goTo(sim, WRITTEN_AT + 1000);
    expect(readStock(db).find((row) => row.ingredient_id === 'susu')?.min_qty).toBe(1000);
    approve(sim, 'approved');
    const [changed] = events(db, 'policy_changed');
    expect(changed).toMatchObject({ actor: 'system', origin: 'rule' });
    expect(changed?.payload).toMatchObject({ ingredient_id: 'susu', from: 1000, to: 2000 });
    expect(readStock(db).find((row) => row.ingredient_id === 'susu')).toMatchObject({
      min_qty: 2000,
      base_min_qty: 1000,
    });
  });

  it('keeps it as it is when he rejects', () => {
    const { db, sim } = boot();
    goTo(sim, WRITTEN_AT + 1000);
    approve(sim, 'rejected');
    expect(events(db, 'policy_changed')).toEqual([]);
    expect(readStock(db).find((row) => row.ingredient_id === 'susu')?.min_qty).toBe(1000);
    expect(db.prepare("SELECT status FROM reports WHERE type = 'policy'").pluck().get()).toBe(
      'rejected',
    );
  });

  it('gives the same state when it is replayed, the change included', () => {
    const { db, sim } = boot();
    goTo(sim, WRITTEN_AT + 1000);
    approve(sim, 'approved');
    const live = snapshotProjections(db);
    rebuildProjections(db);
    expect(snapshotProjections(db)).toEqual(live);
    expect(live.stock_policy).toEqual([{ ingredient_id: 'susu', min_qty: 2000 }]);
  });

  it('does not propose the same ingredient again while the first proposal waits for his answer', () => {
    const { db, sim } = boot();
    goTo(sim, WRITTEN_AT + 1000);
    // the next night: more trouble with milk on day 1, but the boss has not decided yet
    appendInTransaction(
      db,
      ...[4, 5, 6].flatMap((id) => [
        ev.orderCreated(id, [{ menu_item_id: 'kopi_susu', qty: 1 }], simTime(1, 12, id)),
        ev.orderHeld(
          id,
          [{ ingredient_id: 'susu', needed: 150, available: 100 }],
          simTime(1, 12, id),
        ),
      ]),
    );
    goTo(sim, simTime(1, 20) + TASK_DURATION_SEC.reviewing_day + 10);
    expect(events(db, 'daily_review_created')).toHaveLength(2);
    expect(events(db, 'policy_proposed')).toHaveLength(1); // only the first night
  });
});
