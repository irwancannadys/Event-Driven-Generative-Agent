import { describe, expect, it } from 'vitest';
import { TASK_DURATION_SEC, makeScenario, simTime, type StoredEvent } from '@cafe/core';
import type { Db } from '../db/database';
import { listEvents } from '../events/store';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { FIRST_BOOT_START, bootSimulation } from '../sim/simulation';
import { DeferredLLM, flushPromises } from '../test-support/deferred-llm';
import { ev } from '../test-support/events';
import { appendInTransaction, createTestDb } from '../test-support/world';
import { createOrder } from '../usecases/orders';

// The server stops while the stock admin is thinking (decision 037): the log has the question, and she is
// still thinking. The next boot finishes the thought with the rules, once, and does not ask the model.

const SCENARIO = makeScenario(42, { crowdPct: 0, complaintChancePct: 0 });

const log = (db: Db, ...types: string[]): StoredEvent[] =>
  listEvents(db).filter((event) => types.includes(event.type));
const stateOfAdmin = (db: Db) =>
  db.prepare("SELECT state FROM agents WHERE id = 'stock_admin'").pluck().get();

/** The cafe of async-decide.test.ts: the admin is thinking about what to order, and the server stops. */
async function stoppedWhileOrdering() {
  const db = createTestDb();
  const llm = new DeferredLLM();
  const sim = bootSimulation({ db, scenario: SCENARIO, llm });
  createOrder(sim.ctx, { items: [{ menu_item_id: 'kopi_susu', qty: 10 }] });
  sim.clock.advance(FIRST_BOOT_START + 45 + 90 + 5 - sim.clock.now());
  await flushPromises();
  sim.thinker?.close();
  return { db, think: log(db, 'agent_think_requested')[0] as StoredEvent };
}

/** The nightly review: the admin is thinking about the day, and the server stops. */
async function stoppedWhileReviewing() {
  const db = createTestDb();
  const llm = new DeferredLLM();
  const sim = bootSimulation({ db, scenario: SCENARIO, llm });
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
  sim.clock.advance(simTime(0, 20) + TASK_DURATION_SEC.reviewing_day + 5 - sim.clock.now());
  await flushPromises();
  sim.thinker?.close();
  return { db, think: log(db, 'agent_think_requested').at(-1) as StoredEvent };
}

describe('a stop while the stock admin thinks about what to order', () => {
  it('is finished by the rules at the next boot, which does not ask the model', async () => {
    const { db, think } = await stoppedWhileOrdering();
    expect(stateOfAdmin(db)).toBe('thinking');
    const llm = new DeferredLLM();
    const sim = bootSimulation({ db, scenario: SCENARIO, llm });
    await flushPromises();
    expect(sim.settledThoughts).toBe(1);
    expect(llm.calls).toEqual([]);

    const [decided] = log(db, 'agent_decided');
    expect(decided).toMatchObject({ actor: 'stock_admin', origin: 'fallback' });
    expect(decided?.payload).toMatchObject({
      purpose: 'stock_proposal',
      think_event_id: think.id,
      fallback_reason: 'timeout',
    });
    const [proposed] = log(db, 'restock_proposed');
    expect(proposed).toMatchObject({ origin: 'fallback' });
    expect((proposed?.payload as { items: { ingredient_id: string }[] }).items[0]).toMatchObject({
      ingredient_id: 'susu',
    });
    expect(stateOfAdmin(db)).not.toBe('thinking');
    // she is free to carry the report
    expect(
      log(db, 'agent_task_assigned').some(
        (event) => (event.payload as { label?: string }).label === 'submitting_report',
      ),
    ).toBe(true);
  });

  it('is finished once: a second boot changes nothing', async () => {
    const { db } = await stoppedWhileOrdering();
    bootSimulation({ db, scenario: SCENARIO });
    const written = listEvents(db).length;
    const again = bootSimulation({ db, scenario: SCENARIO });
    expect(again.settledThoughts).toBe(0);
    expect(listEvents(db)).toHaveLength(written);
  });

  it('is finished also when the next boot has no model at all', async () => {
    const { db } = await stoppedWhileOrdering();
    const sim = bootSimulation({ db, scenario: SCENARIO });
    expect(sim.settledThoughts).toBe(1);
    expect(log(db, 'restock_proposed')[0]).toMatchObject({ origin: 'fallback' });
    expect(stateOfAdmin(db)).not.toBe('thinking');
  });

  it('is dropped when what she wanted to order has been taken care of meanwhile: she is free, nothing is written', async () => {
    const { db } = await stoppedWhileOrdering();
    appendInTransaction(
      db,
      ev.restockProposed(
        77,
        [{ ingredient_id: 'susu', qty: 4000 }],
        listEvents(db).at(-1)?.sim_time,
      ),
    );
    const sim = bootSimulation({ db, scenario: SCENARIO });
    expect(sim.settledThoughts).toBe(1);
    expect(log(db, 'agent_decided')).toEqual([]);
    expect(log(db, 'restock_proposed')).toHaveLength(1);
    expect(stateOfAdmin(db)).not.toBe('thinking');
    expect(bootSimulation({ db, scenario: SCENARIO }).settledThoughts).toBe(0);
  });

  it('leaves a state that a replay of the log gives again', async () => {
    const { db } = await stoppedWhileOrdering();
    bootSimulation({ db, scenario: SCENARIO });
    const live = snapshotProjections(db);
    rebuildProjections(db);
    expect(snapshotProjections(db)).toEqual(live);
  });
});

describe('a stop while the stock admin thinks about the review of the night', () => {
  it('is finished by the rules: the review and the proposal are written, from the fallback', async () => {
    const { db, think } = await stoppedWhileReviewing();
    expect(stateOfAdmin(db)).toBe('thinking');
    const sim = bootSimulation({ db, scenario: SCENARIO });
    expect(sim.settledThoughts).toBe(1);
    const decided = log(db, 'agent_decided').at(-1);
    expect(decided).toMatchObject({ origin: 'fallback' });
    expect(decided?.payload).toMatchObject({
      purpose: 'policy_review',
      think_event_id: think.id,
      fallback_reason: 'timeout',
    });
    expect(log(db, 'daily_review_created')).toHaveLength(1);
    expect(log(db, 'daily_review_created')[0]).toMatchObject({ origin: 'fallback' });
    expect(log(db, 'policy_proposed')[0]).toMatchObject({ origin: 'fallback' });
    expect(stateOfAdmin(db)).not.toBe('thinking');
  });

  it('only frees her when the day was reviewed meanwhile', async () => {
    const { db } = await stoppedWhileReviewing();
    appendInTransaction(db, {
      type: 'daily_review_created',
      sim_time: listEvents(db).at(-1)?.sim_time ?? 0,
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
    const sim = bootSimulation({ db, scenario: SCENARIO });
    expect(sim.settledThoughts).toBe(1);
    expect(log(db, 'daily_review_created')).toHaveLength(1);
    expect(log(db, 'policy_proposed')).toEqual([]);
    expect(stateOfAdmin(db)).not.toBe('thinking');
  });
});

describe('a boot without a thought that was cut short', () => {
  it('has nothing to finish', () => {
    const db = createTestDb();
    bootSimulation({ db, scenario: SCENARIO });
    expect(bootSimulation({ db, scenario: SCENARIO }).settledThoughts).toBe(0);
  });
});
