import { describe, expect, it } from 'vitest';
import { makeScenario, simTime, TASK_DURATION_SEC, type StoredEvent } from '@cafe/core';
import type { Db } from '../db/database';
import { listEvents } from '../events/store';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { FIRST_BOOT_START, bootSimulation } from '../sim/simulation';
import { DeferredLLM, flushPromises } from '../test-support/deferred-llm';
import { ev } from '../test-support/events';
import { appendInTransaction, createTestDb } from '../test-support/world';
import { transact } from '../usecases/context';
import { createOrder } from '../usecases/orders';
import { decide, validationWorld } from './decide';
import { scheduleStockCheck } from './restock-flow';

// A model that takes its time (decision 037). The cafe of llm-restock.test.ts (ten cups of coffee, the milk
// reaches its minimum, the admin checks the shelf), but the model answers when the test says so: the question
// is written in one step, the answer is applied in another, and the clock runs in between.

const THINKS_AT = FIRST_BOOT_START + 45 + 90;
const GOOD = {
  items: [{ ingredient_id: 'susu', qty: 3000 }],
  urgency: 'high',
  rationale: 'Pesan susu sebelum jam sibuk.',
};

async function boot() {
  const db = createTestDb();
  const llm = new DeferredLLM();
  const sim = bootSimulation({ db, scenario: makeScenario(42, { crowdPct: 0 }), llm });
  createOrder(sim.ctx, { items: [{ menu_item_id: 'kopi_susu', qty: 10 }] });
  sim.clock.advance(THINKS_AT + 5 - sim.clock.now());
  await flushPromises(); // the question goes to the model right after the step
  return { db, sim, llm };
}

const log = (db: Db, ...types: string[]): StoredEvent[] =>
  listEvents(db).filter((event) => types.includes(event.type));
const stateOfAdmin = (db: Db) =>
  db.prepare("SELECT state FROM agents WHERE id = 'stock_admin'").pluck().get();
interface CallRow {
  valid: number;
  fallback_used: number;
  model: string;
  latency_ms: number;
  output_json: string | null;
}
const calls = (db: Db) =>
  db
    .prepare(
      'SELECT valid, fallback_used, model, latency_ms, output_json FROM llm_calls ORDER BY id',
    )
    .all() as CallRow[];

describe('the question to a model that takes its time', () => {
  it('is written in one step, the admin starts to think, and the model is asked after that step', async () => {
    const { db, sim, llm } = await boot();
    const [think] = log(db, 'agent_think_requested');
    expect(think).toMatchObject({ actor: 'stock_admin', sim_time: THINKS_AT });
    expect(think?.payload).toMatchObject({ purpose: 'stock_proposal' });
    const after = listEvents(db).filter((event) => event.id > (think?.id ?? 0));
    expect(after[0]).toMatchObject({
      type: 'agent_state_changed',
      payload: { agent_id: 'stock_admin', state: 'thinking' },
    });
    expect(log(db, 'agent_decided')).toEqual([]);
    expect(stateOfAdmin(db)).toBe('thinking');
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.context).toContain('Susu: stok');
    expect(sim.thinker?.open).toBe(1);
  });

  it('lets the clock run while she thinks, and applies the answer in a step of its own, later', async () => {
    const { db, sim, llm } = await boot();
    const [think] = log(db, 'agent_think_requested');
    sim.clock.advance(600);
    expect(stateOfAdmin(db)).toBe('thinking');
    expect(log(db, 'restock_proposed')).toEqual([]);

    llm.answer(GOOD, { model: 'qwen-test', latencyMs: 2345 });
    await sim.thinker?.idle();

    const [decided] = log(db, 'agent_decided');
    expect(decided).toMatchObject({ actor: 'stock_admin', origin: 'llm' });
    expect(decided?.sim_time).toBe(THINKS_AT + 5 + 600);
    expect(decided?.payload).toMatchObject({
      purpose: 'stock_proposal',
      think_event_id: think?.id,
      llm_call_id: 1,
    });
    const [proposed] = log(db, 'restock_proposed');
    expect(proposed).toMatchObject({ origin: 'llm', sim_time: decided?.sim_time });
    expect(proposed?.payload).toMatchObject({
      items: [{ ingredient_id: 'susu', qty: 3000 }],
      urgency: 'high',
    });
    expect(calls(db)).toEqual([
      {
        valid: 1,
        fallback_used: 0,
        model: 'qwen-test',
        latency_ms: 2345,
        output_json: JSON.stringify(GOOD),
      },
    ]);
    expect(stateOfAdmin(db)).not.toBe('thinking');
    // she is free again and carries the report to the boss
    const tasks = log(db, 'agent_task_assigned').filter((event) => event.id > (decided?.id ?? 0));
    expect(tasks.map((event) => (event.payload as { label?: string }).label)).toContain(
      'submitting_report',
    );
  });

  it('is asked again with the reason when the answer is refused, and the second answer can be good', async () => {
    const { db, sim, llm } = await boot();
    llm.answer('this is not JSON');
    await flushPromises();
    expect(stateOfAdmin(db)).toBe('thinking');
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.feedback).toContain('not valid JSON');
    llm.answer(GOOD);
    await sim.thinker?.idle();
    const [decided] = log(db, 'agent_decided');
    expect(decided).toMatchObject({ origin: 'llm' });
    expect(decided?.payload).toMatchObject({ attempts: 2 });
    expect(calls(db).map((call) => call.valid)).toEqual([0, 1]);
  });

  it('falls back to the rules after three refused answers, and says why', async () => {
    const { db, sim, llm } = await boot();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      llm.answer('{"items":[]}');
      await flushPromises();
    }
    await sim.thinker?.idle();
    const [decided] = log(db, 'agent_decided');
    expect(decided).toMatchObject({ origin: 'fallback' });
    expect(decided?.payload).toMatchObject({ fallback_reason: 'invalid_json', attempts: 3 });
    const [proposed] = log(db, 'restock_proposed');
    expect(proposed).toMatchObject({ origin: 'fallback' });
    expect((proposed?.payload as { items: { ingredient_id: string }[] }).items[0]).toMatchObject({
      ingredient_id: 'susu',
    });
    expect(calls(db).map((call) => [call.valid, call.fallback_used])).toEqual([
      [0, 0],
      [0, 0],
      [0, 1],
    ]);
    expect(stateOfAdmin(db)).not.toBe('thinking');
  });

  it('keeps a call that got no answer at all, and counts it as a timeout', async () => {
    const { db, sim, llm } = await boot();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      llm.fail('connection refused');
      await flushPromises();
    }
    await sim.thinker?.idle();
    const [decided] = log(db, 'agent_decided');
    expect(decided).toMatchObject({ origin: 'fallback' });
    expect(decided?.payload).toMatchObject({ fallback_reason: 'timeout', attempts: 3 });
    // how long it took is the wall clock, so it is not compared here
    expect(
      calls(db).map(({ valid, fallback_used, model, output_json }) => ({
        valid,
        fallback_used,
        model,
        output_json,
      })),
    ).toEqual([
      { valid: 0, fallback_used: 0, model: 'unavailable', output_json: null },
      { valid: 0, fallback_used: 0, model: 'unavailable', output_json: null },
      { valid: 0, fallback_used: 1, model: 'unavailable', output_json: null },
    ]);
    expect(log(db, 'restock_proposed')[0]).toMatchObject({ origin: 'fallback' });
  });

  it('checks the answer against the world as it is when it arrives: a proposal that came meanwhile makes it stale', async () => {
    const { db, sim, llm } = await boot();
    // while she thinks, someone else's proposal for the milk reaches the boss
    appendInTransaction(
      db,
      ev.restockProposed(77, [{ ingredient_id: 'susu', qty: 4000 }], sim.clock.now()),
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      llm.answer(GOOD);
      await flushPromises();
    }
    await sim.thinker?.idle();
    const [decided] = log(db, 'agent_decided');
    expect(decided).toMatchObject({ origin: 'fallback' });
    expect(decided?.payload).toMatchObject({ fallback_reason: 'stale' });
    // what she wanted to order has been taken care of: no second proposal, and she is free
    expect(log(db, 'restock_proposed')).toHaveLength(1);
    expect(stateOfAdmin(db)).not.toBe('thinking');
  });

  it('does not start another task while she thinks, and starts it when the answer has been applied', async () => {
    const { db, sim, llm } = await boot();
    transact(sim.ctx, (emit) => scheduleStockCheck(sim.ctx, emit));
    sim.clock.advance(120);
    expect(stateOfAdmin(db)).toBe('thinking');
    llm.answer(GOOD);
    await sim.thinker?.idle();
    expect(stateOfAdmin(db)).not.toBe('thinking');
    expect(stateOfAdmin(db)).not.toBe('idle'); // the tasks that waited have begun
  });

  it('is never asked for a thought of a step that was rolled back', async () => {
    const db = createTestDb();
    const llm = new DeferredLLM();
    const sim = bootSimulation({ db, scenario: makeScenario(42, { crowdPct: 0 }), llm });
    const ctx = sim.ctx;
    expect(() =>
      transact(ctx, (emit) => {
        decide(
          ctx,
          emit,
          {
            agent: 'stock_admin',
            purpose: 'stock_proposal',
            built: { context: 'x', facts: {} },
            world: () => validationWorld(ctx),
            fallback: GOOD as never,
          },
          () => undefined,
        );
        throw new Error('the step failed');
      }),
    ).toThrow('the step failed');
    await flushPromises();
    expect(llm.calls).toEqual([]);
    expect(log(db, 'agent_think_requested')).toEqual([]);
    expect(stateOfAdmin(db)).toBe('idle');
    expect(sim.thinker?.open).toBe(0);
  });

  it('leaves the question open when the server stops: nothing is written, the next boot finishes it', async () => {
    const { db, sim, llm } = await boot();
    sim.thinker?.close();
    llm.answer(GOOD);
    await sim.thinker?.idle();
    expect(log(db, 'agent_decided')).toEqual([]);
    expect(stateOfAdmin(db)).toBe('thinking');
    expect(calls(db)).toEqual([]);
  });

  it('is read from the log by a replay, which never asks the model again', async () => {
    const { db, sim, llm } = await boot();
    llm.answer(GOOD);
    await sim.thinker?.idle();
    const asked = llm.calls.length;
    const live = snapshotProjections(db);
    rebuildProjections(db);
    expect(llm.calls).toHaveLength(asked);
    expect(snapshotProjections(db)).toEqual(live);
  });
});

describe('the review of the night with a model that takes its time', () => {
  const REVIEW_AT = simTime(0, 20);
  const WRITTEN_AT = REVIEW_AT + TASK_DURATION_SEC.reviewing_day;

  async function bootReview() {
    const db = createTestDb();
    const llm = new DeferredLLM();
    const sim = bootSimulation({
      db,
      scenario: makeScenario(42, { crowdPct: 0, complaintChancePct: 0 }),
      llm,
    });
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
    sim.clock.advance(WRITTEN_AT + 5 - sim.clock.now());
    await flushPromises();
    return { db, sim, llm };
  }

  const REVIEW = {
    summary: 'Hari 0: susu menahan tiga pesanan.',
    change: { ingredient_id: 'susu', min_qty: 2000 },
    rationale: 'Naikkan batas susu supaya dipesan lebih awal.',
  };

  it('asks after the 3 minutes of reading, and writes nothing of the review until the model has answered', async () => {
    const { db, sim, llm } = await bootReview();
    expect(log(db, 'agent_think_requested').at(-1)?.payload).toMatchObject({
      purpose: 'policy_review',
    });
    expect(stateOfAdmin(db)).toBe('thinking');
    expect(log(db, 'daily_review_created')).toEqual([]);
    expect(llm.calls[0]?.context).toContain('Hari 0: 3 pesanan');
    expect(sim.thinker?.open).toBe(1);
  });

  it('writes the review, the note and the proposal for the boss when the answer comes, and she is free again', async () => {
    const { db, sim, llm } = await bootReview();
    sim.clock.advance(1800);
    llm.answer(REVIEW);
    await sim.thinker?.idle();
    const [review] = log(db, 'daily_review_created');
    expect(review).toMatchObject({ origin: 'llm', sim_time: WRITTEN_AT + 5 + 1800 });
    expect(review?.payload).toMatchObject({
      day: 0,
      summary: 'Hari 0: susu menahan tiga pesanan.',
    });
    const [proposed] = log(db, 'policy_proposed');
    expect(proposed).toMatchObject({ origin: 'llm' });
    expect(proposed?.payload).toMatchObject({
      change: { ingredient_id: 'susu', from: 1000, to: 2000 },
    });
    expect(
      log(db, 'memory_created').some(
        (event) => event.type === 'memory_created' && event.payload.kind === 'observation',
      ),
    ).toBe(true);
    expect(stateOfAdmin(db)).not.toBe('thinking');
  });

  it('is reviewed once: an answer for a day that has been reviewed meanwhile writes nothing more', async () => {
    const { db, sim, llm } = await bootReview();
    appendInTransaction(db, {
      type: 'daily_review_created',
      sim_time: sim.clock.now(),
      actor: 'stock_admin',
      origin: 'rule',
      payload: {
        day: 0,
        summary: 'Hari 0: ditulis lebih dulu.',
        metrics: {
          orders: 3,
          done: 0,
          held: 3,
          complaints: 0,
          held_by_ingredient: { susu: 3 },
          stockout_sec: {},
        },
      },
    });
    llm.answer(REVIEW);
    await sim.thinker?.idle();
    expect(log(db, 'daily_review_created')).toHaveLength(1);
    expect(log(db, 'policy_proposed')).toEqual([]);
  });
});
