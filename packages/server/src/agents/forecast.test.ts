import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAKE_SCRIPT,
  FakeLLM,
  RECIPE_ITEMS,
  SECONDS_PER_DAY,
  TASK_DURATION_SEC,
  makeScenario,
  simTime,
  type StoredEvent,
} from '@cafe/core';
import { listEvents } from '../events/store';
import { bootSimulation } from '../sim/simulation';
import { ev } from '../test-support/events';
import { appendInTransaction, createTestDb } from '../test-support/world';
import { transact } from '../usecases/context';
import { enqueueWork } from './engine';

// The stock admin looks ahead at 10:00 and 15:00 (decision 034). On day 1 she knows what the same hours asked
// of the ingredients on day 0: the history is made of 40 coffees with milk that came in at 11:00 on day 0.

const CUPS = 40;
const MILK_PER_CUP = RECIPE_ITEMS.find(
  (line) => line.menu_item_id === 'kopi_susu' && line.ingredient_id === 'susu',
)?.qty_per_portion as number;

function boot(options: { llm?: boolean; history?: boolean } = {}) {
  const db = createTestDb();
  const fake = options.llm === false ? undefined : new FakeLLM(DEFAULT_FAKE_SCRIPT);
  const sim = bootSimulation({
    db,
    scenario: makeScenario(42, { crowdPct: 0, complaintChancePct: 0 }),
    ...(fake && { llm: fake }),
  });
  if (options.history !== false) {
    appendInTransaction(
      db,
      ev.orderCreated(1, [{ menu_item_id: 'kopi_susu', qty: CUPS }], simTime(0, 11)),
    );
  }
  return { db, sim, fake };
}

const goTo = (sim: ReturnType<typeof boot>['sim'], time: number) =>
  sim.clock.advance(time - sim.clock.now());
const events = (db: ReturnType<typeof boot>['db'], ...types: string[]): StoredEvent[] =>
  listEvents(db).filter((event) => types.includes(event.type));
/** The questions about what to order: the nightly review of the day also thinks, and is not what these tests are about. */
const stockQuestions = (db: ReturnType<typeof boot>['db']) =>
  events(db, 'agent_think_requested').filter(
    (event) => (event.payload as { purpose: string }).purpose === 'stock_proposal',
  );
const forecasting = (db: ReturnType<typeof boot>['db']) =>
  events(db, 'agent_task_assigned').filter(
    (event) => (event.payload as { label?: string }).label === 'forecasting',
  );

describe('the look ahead at 10:00', () => {
  it('sends the admin to the shelf at 10:00, when the same hours of the day before asked more than the shelf has', () => {
    const { db, sim } = boot();
    goTo(sim, simTime(1, 9, 59) + 59);
    expect(forecasting(db)).toEqual([]);
    goTo(sim, simTime(1, 10));
    const [task] = forecasting(db);
    expect(task).toMatchObject({ sim_time: simTime(1, 10), actor: 'stock_admin' });
    expect(task?.payload).toMatchObject({ duration_sim_sec: TASK_DURATION_SEC.forecasting });
    // she is at the shelf already (her home): she works, with the label of the task
    expect(
      events(db, 'agent_state_changed').find((event) => event.sim_time === simTime(1, 10))?.payload,
    ).toMatchObject({
      agent_id: 'stock_admin',
      state: 'working',
      station: 'stock_shelf',
      label: 'forecasting',
    });
  });

  it('then decides what to order: the milk the day before asked for, less what is on the shelf, as a report for the boss', () => {
    const { db, sim, fake } = boot();
    goTo(sim, simTime(1, 10) + TASK_DURATION_SEC.forecasting);
    const [think] = events(db, 'agent_think_requested').filter(
      (event) => event.sim_time >= simTime(1, 10),
    );
    expect(think?.payload).toMatchObject({ agent_id: 'stock_admin', purpose: 'stock_proposal' });
    expect(think?.sim_time).toBe(simTime(1, 10) + TASK_DURATION_SEC.forecasting);
    const [proposed] = events(db, 'restock_proposed');
    expect(proposed).toMatchObject({ origin: 'llm', actor: 'stock_admin' });
    // 40 cups = 6000 ml of milk in the four hours, the minimum is 1000, 2500 are on the shelf: 4500 are missing,
    // and only 3500 fit; the model orders a tenth more than what is missing, up to the room there is
    expect(proposed?.payload).toMatchObject({ items: [{ ingredient_id: 'susu', qty: 3500 }] });
    expect(MILK_PER_CUP * CUPS).toBe(6000);
    // the model was told what the forecast says
    expect(fake?.calls.at(-1)?.request.context).toContain('Cek sebelum jam sibuk');
    expect(fake?.calls.at(-1)?.request.context).toContain('perkiraan pakai 6000');
    // and the report goes to the boss's desk
    const task = events(db, 'agent_task_assigned').filter(
      (event) => event.sim_time === simTime(1, 10) + TASK_DURATION_SEC.forecasting,
    );
    expect(
      task.some((event) => (event.payload as { station?: string }).station === 'boss_desk'),
    ).toBe(true);
  });

  it('is decided by the rules when there is no model', () => {
    const { db, sim } = boot({ llm: false });
    goTo(sim, simTime(1, 10) + TASK_DURATION_SEC.forecasting);
    expect(events(db, 'restock_proposed')[0]).toMatchObject({ origin: 'rule' });
    expect(events(db, 'agent_decided')[0]).toMatchObject({ origin: 'rule' });
  });
});

describe('when she does not look ahead', () => {
  it('has no past to look at on the first day, so no trip to the shelf and no question for the model', () => {
    const { db, sim, fake } = boot();
    goTo(sim, simTime(0, 16));
    expect(forecasting(db)).toEqual([]);
    expect(stockQuestions(db)).toEqual([]);
    expect(fake?.calls).toEqual([]);
  });

  it('does nothing when the shelf lasts for what the same hours asked', () => {
    const { db, sim, fake } = boot({ history: false });
    appendInTransaction(
      db,
      ev.orderCreated(1, [{ menu_item_id: 'kopi_susu', qty: 1 }], simTime(0, 11)),
    );
    goTo(sim, simTime(1, 10, 10));
    expect(forecasting(db)).toEqual([]);
    expect(fake?.calls.filter((call) => call.request.purpose === 'stock_proposal')).toEqual([]);
  });

  it('does not look when she is busy with something else, and does not come back for it', () => {
    const { db, sim } = boot();
    goTo(sim, simTime(1, 9, 30));
    transact(sim.ctx, (emit) =>
      enqueueWork(sim.ctx, emit, 'stock_admin', 'stock_shelf', {
        label: 'waiting_retry',
        duration_sim_sec: 2 * 3600,
      }),
    );
    goTo(sim, simTime(1, 10, 30));
    expect(forecasting(db)).toEqual([]);
    expect(stockQuestions(db)).toEqual([]);
  });

  it('leaves out an ingredient that a proposal or an order already covers', () => {
    const { db, sim } = boot();
    appendInTransaction(db, ev.restockProposed(9, [{ ingredient_id: 'susu', qty: 3500 }]));
    goTo(sim, simTime(1, 10, 10));
    expect(forecasting(db)).toEqual([]);
  });

  it('looks again at 15:00, with what the afternoon of the day before asked', () => {
    const { db, sim } = boot({ history: false });
    appendInTransaction(
      db,
      ev.orderCreated(1, [{ menu_item_id: 'kopi_susu', qty: 40 }], simTime(0, 15, 30)),
    );
    goTo(sim, simTime(1, 14, 59));
    expect(forecasting(db)).toEqual([]);
    goTo(sim, simTime(1, 15));
    expect(forecasting(db)).toHaveLength(1);
    expect(forecasting(db)[0]?.sim_time).toBe(simTime(1, 15));
  });

  it('only counts what the day before asked in the hours ahead, not the hours before them', () => {
    const { db, sim } = boot({ history: false });
    // 40 cups at 08:00 on day 0: not in the window 10:00 to 14:00
    appendInTransaction(
      db,
      ev.orderCreated(1, [{ menu_item_id: 'kopi_susu', qty: 40 }], simTime(0, 8)),
    );
    goTo(sim, simTime(1, 10, 10));
    expect(forecasting(db)).toEqual([]);
    expect(SECONDS_PER_DAY).toBe(86400);
  });
});
