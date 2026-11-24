import { describe, expect, it } from 'vitest';
import { makeScenario, walkDurationSec, type StoredEvent } from '@cafe/core';
import type { Db } from '../db/database';
import { readStock } from '../db/queries';
import { listEvents } from '../events/store';
import { rebuildProjections } from '../projection/rebuild';
import { snapshotProjections } from '../projection/snapshot';
import { FIRST_BOOT_START, bootSimulation, type Simulation } from '../sim/simulation';
import { createTestDb } from '../test-support/world';
import { transact } from '../usecases/context';
import { createOrder } from '../usecases/orders';
import { readAgent } from './engine';

const START = FIRST_BOOT_START;

// The timeline of the basic story, from the moment the order comes in:
//   0 s      the cashier starts writing it down                      (45 s)
//   45 s     the cook starts cooking, the milk reaches its minimum, the admin goes to check (90 s)
//   135 s    the admin decides and sets off for the boss's desk
//   +248 s   she arrives and hands in the report (60 s)
//   +248 s   she walks back to the shelf
const WRITE = 45;
const CHECK = 90;
const TO_BOSS = walkDurationSec('stock_shelf', 'boss_desk');
const SUBMIT = 60;
const DECIDED_AT_DESK = WRITE + CHECK; // 135: the proposal is written
const SUBMITTED_AT = DECIDED_AT_DESK + TO_BOSS + SUBMIT; // 443
const HOME_AT = SUBMITTED_AT + TO_BOSS; // 691
const PLACING = 60;
const MILK_LEAD = 7200;

type Outcome = 'on_time' | 'late' | 'out';

function world(outcome?: Outcome) {
  const db = createTestDb();
  if (outcome) {
    db.prepare('UPDATE suppliers_mock SET weight_on_time = ?, weight_late = ?, weight_out = ?').run(
      outcome === 'on_time' ? 100 : 0,
      outcome === 'late' ? 100 : 0,
      outcome === 'out' ? 100 : 0,
    );
  }
  const sim = bootSimulation({ db, scenario: makeScenario(42, { crowdPct: 0 }) });
  return { db, sim };
}

const cups = (sim: Simulation, qty: number) =>
  createOrder(sim.ctx, { items: [{ menu_item_id: 'kopi_susu', qty }] }).order_id;

function runTo(sim: Simulation, secondsAfterStart: number): void {
  sim.clock.advance(START + secondsAfterStart - sim.clock.now());
}

function decide(sim: Simulation, report_id: number, decision: 'approved' | 'rejected'): void {
  transact(sim.ctx, (emit) =>
    emit({
      type: 'report_decided',
      actor: 'boss',
      origin: 'boss',
      payload: { report_id, decision },
    }),
  );
}

function log(db: Db, ...types: string[]): StoredEvent[] {
  return listEvents(db).filter((event) => types.includes(event.type));
}

const at = (event: StoredEvent | undefined) => (event ? event.sim_time - START : undefined);
const reportStatus = (db: Db, id: number) =>
  db.prepare('SELECT status FROM reports WHERE id = ?').pluck().get(id);
const stock = (db: Db, id: string) => readStock(db).find((row) => row.ingredient_id === id);

describe('from a low stock to a report on the boss desk', () => {
  it('sends the admin to check the shelf, who then writes a "fill up to full" proposal', () => {
    const { db, sim } = world();
    cups(sim, 10);
    runTo(sim, 200);

    const low = log(db, 'stock_low');
    expect(low).toHaveLength(1);
    expect(at(low[0])).toBe(WRITE); // the milk reaches 1000 ml when the cook starts
    const think = log(db, 'agent_think_requested')[0] as StoredEvent;
    const decided = log(db, 'agent_decided')[0] as StoredEvent;
    const proposed = log(db, 'restock_proposed')[0] as StoredEvent;
    expect([at(think), at(decided), at(proposed)]).toEqual([
      DECIDED_AT_DESK,
      DECIDED_AT_DESK,
      DECIDED_AT_DESK,
    ]);
    expect(decided.payload).toMatchObject({
      agent_id: 'stock_admin',
      purpose: 'stock_proposal',
      think_event_id: think.id,
      decision: { items: [{ ingredient_id: 'susu', qty: 5000 }], urgency: 'normal' },
    });
    expect(decided.origin).toBe('rule');
    expect(proposed.payload).toMatchObject({
      report: { report_id: 1, title: 'Usul belanja: Susu' },
      items: [{ ingredient_id: 'susu', qty: 5000 }],
    });
  });

  it('walks the report to the boss desk, hands it in, and goes back to the shelf', () => {
    const { db, sim } = world();
    cups(sim, 10);
    runTo(sim, SUBMITTED_AT - 1);
    expect(reportStatus(db, 1)).toBe('drafted');
    expect(readAgent(db, 'stock_admin')).toMatchObject({ state: 'working', station: 'boss_desk' });
    runTo(sim, SUBMITTED_AT);
    expect(reportStatus(db, 1)).toBe('submitted');
    expect(at(log(db, 'report_submitted')[0])).toBe(SUBMITTED_AT);
    expect(log(db, 'report_submitted')[0]?.actor).toBe('stock_admin');
    expect(readAgent(db, 'stock_admin')).toMatchObject({
      state: 'walking',
      station: 'stock_shelf',
    });
    runTo(sim, HOME_AT);
    expect(readAgent(db, 'stock_admin')).toMatchObject({ state: 'idle', station: 'stock_shelf' });
  });

  it('waits for the boss: a report nobody decides on keeps everything on hold', () => {
    const { db, sim } = world();
    cups(sim, 10);
    runTo(sim, 20000);
    expect(reportStatus(db, 1)).toBe('submitted');
    expect(log(db, 'restock_ordered')).toHaveLength(0);
    expect(readAgent(db, 'stock_admin').state).toBe('idle');
  });

  it('writes one report for everything that is low, after one check', () => {
    const { db, sim } = world();
    // Milk and rice both end up at their minimum in the same cooking step.
    createOrder(sim.ctx, {
      items: [
        { menu_item_id: 'kopi_susu', qty: 10 },
        { menu_item_id: 'nasi_goreng', qty: 16 },
      ],
    });
    runTo(sim, 400);
    expect(
      log(db, 'stock_low').map(
        (event) => (event.payload as { ingredient_id: string }).ingredient_id,
      ),
    ).toEqual(['nasi', 'susu']);
    expect(log(db, 'agent_think_requested')).toHaveLength(1);
    expect(log(db, 'restock_proposed')).toHaveLength(1);
    const items = (log(db, 'restock_proposed')[0]?.payload as { items: unknown }).items;
    expect(items).toEqual([
      { ingredient_id: 'nasi', qty: 8000 - 800 },
      { ingredient_id: 'susu', qty: 5000 },
    ]);
  });

  it('does not propose again for what is already on the boss desk, but does for something new', () => {
    const { db, sim } = world();
    cups(sim, 10);
    runTo(sim, 600);
    expect(log(db, 'restock_proposed')).toHaveLength(1);
    // Rice runs low as well while the milk proposal is still waiting for the boss.
    createOrder(sim.ctx, { items: [{ menu_item_id: 'nasi_goreng', qty: 16 }] });
    runTo(sim, 8000);
    const reports = log(db, 'restock_proposed').map((event) =>
      (event.payload as { items: { ingredient_id: string }[] }).items.map(
        (item) => item.ingredient_id,
      ),
    );
    expect(reports).toEqual([['susu'], ['nasi']]);
  });
});

describe('when the boss approves', () => {
  it('lets the admin order at the supplier once she is back, one order per ingredient', () => {
    const { db, sim } = world('on_time');
    cups(sim, 10);
    runTo(sim, 500);
    decide(sim, 1, 'approved');
    runTo(sim, 2000);

    expect(reportStatus(db, 1)).toBe('approved');
    const ordered = log(db, 'restock_ordered');
    expect(ordered).toHaveLength(1);
    // She was still walking back when the boss decided, so the order is placed after she arrived.
    expect(at(ordered[0])).toBe(HOME_AT + PLACING);
    expect(ordered[0]?.actor).toBe('stock_admin');
    expect(ordered[0]?.origin).toBe('generator');
    expect(ordered[0]?.payload).toEqual({
      restock_id: 1,
      report_id: 1,
      items: [{ ingredient_id: 'susu', qty: 5000 }],
      supplier: 'on_time',
      eta_sim_time: START + HOME_AT + PLACING + MILK_LEAD,
    });
  });

  it('fills the stock when the delivery arrives, and clears the low flag', () => {
    const { db, sim } = world('on_time');
    cups(sim, 10);
    runTo(sim, 500);
    decide(sim, 1, 'approved');
    const arrival = HOME_AT + PLACING + MILK_LEAD;
    runTo(sim, arrival - 1);
    expect(stock(db, 'susu')).toMatchObject({ qty: 1000, low_flagged: true });
    runTo(sim, arrival);
    expect(at(log(db, 'restock_arrived')[0])).toBe(arrival);
    expect(stock(db, 'susu')).toMatchObject({ qty: 6000, low_flagged: false });
    expect(db.prepare('SELECT status FROM restock_orders').pluck().get()).toBe('arrived');
  });

  it('stretches the lead time when the supplier is late', () => {
    const { db, sim } = world('late');
    cups(sim, 10);
    runTo(sim, 500);
    decide(sim, 1, 'approved');
    runTo(sim, 40000);
    const ordered = log(db, 'restock_ordered')[0] as StoredEvent;
    expect(ordered.payload).toMatchObject({
      supplier: 'late',
      eta_sim_time: ordered.sim_time + MILK_LEAD * 2,
    });
    expect(at(log(db, 'restock_arrived')[0])).toBe(HOME_AT + PLACING + MILK_LEAD * 2);
  });

  it('writes a failed order when the supplier is out, and the admin proposes again', () => {
    const { db, sim } = world('out');
    cups(sim, 10);
    runTo(sim, 500);
    decide(sim, 1, 'approved');
    runTo(sim, 3000);

    const ordered = log(db, 'restock_ordered')[0] as StoredEvent;
    const failed = log(db, 'restock_failed')[0] as StoredEvent;
    expect(ordered.payload).toMatchObject({ supplier: 'out', eta_sim_time: null });
    expect(failed.sim_time).toBe(ordered.sim_time);
    expect(failed.origin).toBe('generator');
    expect(log(db, 'restock_arrived')).toHaveLength(0);
    // The milk is not covered any more, so she checks and writes a new proposal for the boss.
    expect(log(db, 'restock_proposed')).toHaveLength(2);
    expect(reportStatus(db, 2)).toBe('submitted');
  });

  it('puts a held order back on the stove once the delivery has arrived', () => {
    const { db, sim } = world('on_time');
    const big = cups(sim, 16); // 2400 ml of the 2500: 100 ml are left
    const small = cups(sim, 2); // 300 ml: more than is left
    runTo(sim, 500);
    decide(sim, 1, 'approved');
    runTo(sim, 4000);
    expect(db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(big)).toBe('done');
    expect(db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(small)).toBe('held');

    const arrival = HOME_AT + PLACING + MILK_LEAD;
    runTo(sim, arrival + 400);
    const resumed = log(db, 'order_resumed')[0] as StoredEvent;
    expect(at(resumed)).toBe(arrival);
    expect(resumed.payload).toEqual({ order_id: small });
    const restarts = log(db, 'cooking_started').filter(
      (event) => (event.payload as { order_id: number }).order_id === small,
    );
    expect(restarts.map(at)).toEqual([arrival]);
    expect(at(log(db, 'cooking_done').at(-1))).toBe(arrival + 2 * 180);
    expect(db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(small)).toBe('done');
    expect(stock(db, 'susu')?.qty).toBe(6000 - 300);
  });
});

describe('when the boss rejects', () => {
  it('has the admin wait an hour, look at the shelf again, and propose once more', () => {
    const { db, sim } = world();
    cups(sim, 10);
    runTo(sim, 500);
    decide(sim, 1, 'rejected');
    expect(reportStatus(db, 1)).toBe('rejected');
    runTo(sim, HOME_AT + 3600 - 1);
    expect(log(db, 'restock_proposed')).toHaveLength(1);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) FROM agent_tasks WHERE status = 'active' AND params_json LIKE '%waiting_retry%'",
        )
        .pluck()
        .get(),
    ).toBe(1);
    runTo(sim, HOME_AT + 3600 + CHECK);
    expect(log(db, 'restock_proposed')).toHaveLength(2);
    expect(at(log(db, 'restock_proposed')[1])).toBe(HOME_AT + 3600 + CHECK);
    expect(log(db, 'restock_ordered')).toHaveLength(0);
  });
});

describe('restarting in the middle of the restock story', () => {
  const APPROVE_AT = 500;
  const END = 12000;

  function story(restartAt?: number) {
    const { db, sim: first } = world('on_time');
    cups(first, 10);
    cups(first, 2);
    let sim = first;
    const restart = () => {
      sim = bootSimulation({ db, scenario: makeScenario(42, { crowdPct: 0 }) });
      expect(sim.recovered).toBe(true);
    };
    if (restartAt !== undefined && restartAt < APPROVE_AT) {
      runTo(sim, restartAt);
      restart();
    }
    runTo(sim, APPROVE_AT);
    decide(sim, 1, 'approved');
    if (restartAt !== undefined && restartAt >= APPROVE_AT) {
      runTo(sim, restartAt);
      restart();
    }
    runTo(sim, END);
    return { db, log: listEvents(db) };
  }

  const straight = story();

  it('has a story worth checking: a proposal, an order, a delivery, and cooked orders', () => {
    const types = straight.log.map((event) => event.type);
    for (const type of [
      'restock_proposed',
      'report_submitted',
      'report_decided',
      'restock_ordered',
      'restock_arrived',
      'cooking_done',
    ]) {
      expect(types, type).toContain(type);
    }
  });

  const cuts = [
    1,
    44,
    45,
    100,
    135,
    300,
    383,
    443,
    450,
    499, // before the boss decides
    500,
    600,
    HOME_AT,
    HOME_AT + 30,
    HOME_AT + PLACING, // after the decision, around the ordering
    3000,
    HOME_AT + PLACING + MILK_LEAD - 1,
    HOME_AT + PLACING + MILK_LEAD,
    HOME_AT + PLACING + MILK_LEAD + 1,
    10000, // the supplier's delivery
  ];
  it.each(cuts)('gives the identical log when the server restarts at %i s', (restartAt) => {
    expect(story(restartAt).log).toEqual(straight.log);
  });

  it('builds the same state from the log as the live run has', () => {
    const live = snapshotProjections(straight.db);
    rebuildProjections(straight.db);
    expect(snapshotProjections(straight.db)).toEqual(live);
  });
});
