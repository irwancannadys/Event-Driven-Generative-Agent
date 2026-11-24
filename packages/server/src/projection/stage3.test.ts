import { describe, expect, it } from 'vitest';
import { AGENT_HOME_STATION, INITIAL_STOCK, INITIAL_VISITS } from '@cafe/core';
import { readStock } from '../db/queries';
import { ev } from '../test-support/events';
import { appendInTransaction, countRows, createInitializedDb } from '../test-support/world';
import { rebuildProjections } from './rebuild';
import { snapshotProjections } from './snapshot';

type Db = ReturnType<typeof createInitializedDb>;

const stockOf = (db: Db, id: string) => readStock(db).find((row) => row.ingredient_id === id);

/** An order that used up milk down to the low mark, so that a restock makes sense. */
function withLowMilk(db: Db): void {
  appendInTransaction(
    db,
    ev.orderCreated(1, [{ menu_item_id: 'kopi_susu', qty: 1 }]),
    ev.cookingStarted(1),
    ev.stockDecreased(1, 'susu', 1550, 950),
    ev.stockLow('susu', 950, 1000),
  );
}

const report = {
  report_id: 2,
  title: 'Komplain: layanan lambat (pesanan #1)',
  body: 'Pesanan #1 menunggu 45 menit.',
};

describe('agents', () => {
  it('start idle at their home stations when the world begins', () => {
    const db = createInitializedDb();
    expect(db.prepare('SELECT id, role, station, state FROM agents ORDER BY id').all()).toEqual([
      { id: 'cashier', role: 'cashier', station: AGENT_HOME_STATION.cashier, state: 'idle' },
      { id: 'cook', role: 'cook', station: 'kitchen', state: 'idle' },
      { id: 'stock_admin', role: 'stock_admin', station: 'stock_shelf', state: 'idle' },
      { id: 'waiter', role: 'waiter', station: 'table_2', state: 'idle' },
    ]);
  });

  it('are reset, together with their tasks, when a new world begins', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.agentTaskAssigned('cook', 1, { kind: 'work', label: 'cooking', duration_sim_sec: 60 }),
    );
    appendInTransaction(db, {
      type: 'world_initialized',
      sim_time: 0,
      actor: 'system',
      origin: 'system',
      payload: { seed: 1, initial_stock: INITIAL_STOCK, initial_visits: INITIAL_VISITS },
    });
    expect(countRows(db, 'agent_tasks')).toBe(0);
    expect(countRows(db, 'agents')).toBe(4);
  });
});

describe('agent tasks', () => {
  it('are queued with their details when assigned', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.agentTaskAssigned('cook', 1, {
        kind: 'work',
        label: 'cooking',
        duration_sim_sec: 180,
        ref: { type: 'order', id: 5 },
      }),
      ev.agentTaskAssigned('cashier', 2, {
        kind: 'goto',
        station: 'boss_desk',
        duration_sim_sec: 132,
      }),
    );
    expect(
      db
        .prepare(
          'SELECT id, agent_id, kind, status, duration_sim_sec, params_json FROM agent_tasks ORDER BY id',
        )
        .all(),
    ).toEqual([
      {
        id: 1,
        agent_id: 'cook',
        kind: 'work',
        status: 'queued',
        duration_sim_sec: 180,
        params_json: '{"label":"cooking","ref":{"type":"order","id":5}}',
      },
      {
        id: 2,
        agent_id: 'cashier',
        kind: 'goto',
        status: 'queued',
        duration_sim_sec: 132,
        params_json: '{"station":"boss_desk"}',
      },
    ]);
  });

  it('start with an ETA, which moves the agent and notes when the task ends', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.agentTaskAssigned('cashier', 1, {
        kind: 'goto',
        station: 'boss_desk',
        duration_sim_sec: 132,
      }),
    );
    appendInTransaction(
      db,
      ev.agentStateChanged(
        'cashier',
        'walking',
        'boss_desk',
        { task_id: 1, eta_sim_time: 28932 },
        28800,
      ),
    );
    expect(db.prepare("SELECT state, station FROM agents WHERE id = 'cashier'").get()).toEqual({
      state: 'walking',
      station: 'boss_desk',
    });
    expect(
      db.prepare('SELECT status, started_at_sim, ends_at_sim FROM agent_tasks WHERE id = 1').get(),
    ).toEqual({
      status: 'active',
      started_at_sim: 28800,
      ends_at_sim: 28932,
    });
  });

  it('finish, and then the agent can go idle again', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.agentTaskAssigned('cook', 1, { kind: 'work', label: 'cooking', duration_sim_sec: 60 }),
      ev.agentStateChanged('cook', 'working', 'kitchen', {
        task_id: 1,
        label: 'cooking',
        eta_sim_time: 28860,
      }),
    );
    appendInTransaction(
      db,
      ev.agentTaskFinished('cook', 1, 28860),
      ev.agentStateChanged('cook', 'idle', 'kitchen', {}, 28860),
    );
    expect(db.prepare('SELECT status FROM agent_tasks WHERE id = 1').pluck().get()).toBe('done');
    expect(db.prepare("SELECT state FROM agents WHERE id = 'cook'").pluck().get()).toBe('idle');
  });

  it('can be finished without ever starting (a cooking task that had to be skipped)', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.agentTaskAssigned('cook', 1, { kind: 'work', label: 'cooking', duration_sim_sec: 60 }),
    );
    appendInTransaction(db, ev.agentTaskFinished('cook', 1));
    expect(db.prepare('SELECT status FROM agent_tasks WHERE id = 1').pluck().get()).toBe('done');
  });

  it('refuse impossible moves', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.agentTaskAssigned('cook', 1, { kind: 'work', label: 'cooking', duration_sim_sec: 60 }),
      ev.agentTaskAssigned('cook', 2, { kind: 'work', label: 'cooking', duration_sim_sec: 60 }),
      ev.agentStateChanged('cook', 'working', 'kitchen', { task_id: 1, eta_sim_time: 28860 }),
    );
    // a second task cannot start while one is active
    expect(() =>
      appendInTransaction(
        db,
        ev.agentStateChanged('cook', 'working', 'kitchen', { task_id: 2, eta_sim_time: 28920 }),
      ),
    ).toThrow(/already has an active task/);
    // idle with an active task
    expect(() => appendInTransaction(db, ev.agentStateChanged('cook', 'idle', 'kitchen'))).toThrow(
      /cannot be idle with an active task/,
    );
    // walking or working without a task
    expect(() =>
      appendInTransaction(db, ev.agentStateChanged('cashier', 'working', 'cashier')),
    ).toThrow(/without a task/);
    // a task without an ETA
    expect(() =>
      appendInTransaction(
        db,
        ev.agentStateChanged('cashier', 'working', 'cashier', { task_id: 1 }),
      ),
    ).toThrow(/without an eta/);
    // a task that is not in that agent's queue
    expect(() =>
      appendInTransaction(
        db,
        ev.agentStateChanged('cashier', 'working', 'cashier', { task_id: 2, eta_sim_time: 1 }),
      ),
    ).toThrow(/not waiting in the queue/);
    // finishing twice, or a task that does not exist
    appendInTransaction(db, ev.agentTaskFinished('cook', 1));
    expect(() => appendInTransaction(db, ev.agentTaskFinished('cook', 1))).toThrow(
      /not queued or active/,
    );
    expect(() => appendInTransaction(db, ev.agentTaskFinished('cook', 99))).toThrow(
      /not queued or active/,
    );
  });
});

describe('held orders', () => {
  it('go back to placed when they are resumed, and only then', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1), ev.orderHeld(1));
    expect(() => appendInTransaction(db, ev.orderResumed(2))).toThrow(/not found/);
    appendInTransaction(db, ev.orderResumed(1));
    expect(db.prepare('SELECT status FROM orders WHERE id = 1').pluck().get()).toBe('placed');
    expect(() => appendInTransaction(db, ev.orderResumed(1))).toThrow(
      /cannot go from "held" to "placed"/,
    );
  });
});

describe('reports and restocking', () => {
  it('follow drafted, submitted, approved in that order', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.restockProposed(1));
    expect(db.prepare('SELECT type, status, subject_json FROM reports').get()).toEqual({
      type: 'restock',
      status: 'drafted',
      subject_json: JSON.stringify({
        items: [{ ingredient_id: 'susu', qty: 5050 }],
        urgency: 'normal',
        rationale: 'Susu tinggal 950 ml (batas 1000). Usul: isi sampai penuh.',
      }),
    });
    expect(() => appendInTransaction(db, ev.reportDecided(1, 'approved'))).toThrow(
      /is not submitted \(status: drafted\)/,
    );
    appendInTransaction(db, ev.reportSubmitted(1, 'stock_admin', 29000));
    expect(db.prepare('SELECT status, submitted_at_sim FROM reports').get()).toEqual({
      status: 'submitted',
      submitted_at_sim: 29000,
    });
    expect(() => appendInTransaction(db, ev.reportSubmitted(1))).toThrow(
      /is not drafted \(status: submitted\)/,
    );
    appendInTransaction(db, ev.reportDecided(1, 'approved', 29500));
    expect(db.prepare('SELECT status, decided_at_sim FROM reports').get()).toEqual({
      status: 'approved',
      decided_at_sim: 29500,
    });
    expect(() => appendInTransaction(db, ev.reportDecided(1, 'rejected'))).toThrow(
      /is not submitted \(status: approved\)/,
    );
    expect(() => appendInTransaction(db, ev.reportDecided(9, 'approved'))).toThrow(/not found/);
  });

  it('can be rejected', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.restockProposed(1),
      ev.reportSubmitted(1),
      ev.reportDecided(1, 'rejected'),
    );
    expect(db.prepare('SELECT status FROM reports').pluck().get()).toBe('rejected');
  });

  it('are ordered only after approval, and the order records when it should arrive', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.restockProposed(1), ev.reportSubmitted(1));
    expect(() => appendInTransaction(db, ev.restockOrdered(1, 1))).toThrow(
      /report 1 is not approved/,
    );
    appendInTransaction(db, ev.reportDecided(1, 'approved'));
    appendInTransaction(
      db,
      ev.restockOrdered(1, 1, [{ ingredient_id: 'susu', qty: 5050 }], 'late', 40000, 29600),
    );
    expect(db.prepare('SELECT * FROM restock_orders').get()).toEqual({
      id: 1,
      report_id: 1,
      items_json: '[{"ingredient_id":"susu","qty":5050}]',
      supplier: 'late',
      status: 'ordered',
      ordered_at_sim: 29600,
      eta_sim: 40000,
      arrived_at_sim: null,
    });
  });

  it('fail when the supplier is out, and only then', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.restockProposed(1),
      ev.reportSubmitted(1),
      ev.reportDecided(1, 'approved'),
    );
    appendInTransaction(
      db,
      ev.restockOrdered(1, 1, undefined, 'on_time'),
      ev.restockOrdered(2, 1, [{ ingredient_id: 'kopi', qty: 100 }], 'out'),
    );
    expect(() => appendInTransaction(db, ev.restockFailed(1))).toThrow(
      /did not have a supplier that is out/,
    );
    appendInTransaction(db, ev.restockFailed(2));
    expect(db.prepare('SELECT status FROM restock_orders WHERE id = 2').pluck().get()).toBe(
      'failed',
    );
    expect(() => appendInTransaction(db, ev.restockFailed(2))).toThrow(/not waiting for delivery/);
    expect(() => appendInTransaction(db, ev.restockFailed(9))).toThrow(
      /did not have a supplier that is out/,
    );
  });

  function approvedMilkOrder(): Db {
    const db = createInitializedDb();
    withLowMilk(db);
    appendInTransaction(
      db,
      ev.restockProposed(1),
      ev.reportSubmitted(1),
      ev.reportDecided(1, 'approved'),
      ev.restockOrdered(1, 1),
    );
    return db;
  }

  it('raise the stock when the delivery arrives, and clear the flag once above the minimum', () => {
    const db = approvedMilkOrder();
    expect(stockOf(db, 'susu')).toMatchObject({ qty: 950, low_flagged: true });
    appendInTransaction(db, ev.restockArrived(1, [{ ingredient_id: 'susu', qty: 5050 }], 36000));
    expect(stockOf(db, 'susu')).toMatchObject({
      qty: 6000,
      low_flagged: false,
      out_flagged: false,
    });
    expect(db.prepare('SELECT status, arrived_at_sim FROM restock_orders').get()).toEqual({
      status: 'arrived',
      arrived_at_sim: 36000,
    });
  });

  it('keep the low flag when the delivery is too small to get above the minimum', () => {
    const db = createInitializedDb();
    withLowMilk(db);
    appendInTransaction(
      db,
      ev.restockProposed(1, [{ ingredient_id: 'susu', qty: 20 }]),
      ev.reportSubmitted(1),
      ev.reportDecided(1, 'approved'),
      ev.restockOrdered(1, 1, [{ ingredient_id: 'susu', qty: 20 }]),
    );
    appendInTransaction(db, ev.restockArrived(1, [{ ingredient_id: 'susu', qty: 20 }]));
    expect(stockOf(db, 'susu')).toMatchObject({ qty: 970, low_flagged: true });
  });

  it('clear the out flag as soon as there is any stock again, while the low flag stays', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.orderCreated(1, [{ menu_item_id: 'es_teh_manis', qty: 1 }]),
      ev.cookingStarted(1),
      ev.stockDecreased(1, 'teh', 350, 0),
      ev.stockLow('teh', 0, 100),
      ev.stockOut('teh'),
    );
    expect(stockOf(db, 'teh')).toMatchObject({ qty: 0, low_flagged: true, out_flagged: true });
    appendInTransaction(
      db,
      ev.restockProposed(1, [{ ingredient_id: 'teh', qty: 50 }]),
      ev.reportSubmitted(1),
      ev.reportDecided(1, 'approved'),
      ev.restockOrdered(1, 1, [{ ingredient_id: 'teh', qty: 50 }]),
    );
    appendInTransaction(db, ev.restockArrived(1, [{ ingredient_id: 'teh', qty: 50 }]));
    expect(stockOf(db, 'teh')).toMatchObject({ qty: 50, low_flagged: true, out_flagged: false });
  });

  it('refuse a delivery that does not match the order, a second delivery, or a failed order', () => {
    const db = approvedMilkOrder();
    expect(() =>
      appendInTransaction(db, ev.restockArrived(1, [{ ingredient_id: 'susu', qty: 100 }])),
    ).toThrow(/does not match the order/);
    appendInTransaction(db, ev.restockArrived(1));
    expect(() => appendInTransaction(db, ev.restockArrived(1))).toThrow(/not waiting for delivery/);
    expect(() => appendInTransaction(db, ev.restockArrived(7))).toThrow(/not waiting for delivery/);
  });
});

describe('complaints', () => {
  function complaintAbout(db: Db): void {
    appendInTransaction(db, ev.orderCreated(1), ev.complaintReceived(1, 1));
  }

  it('can be triaged with a report for the boss, which is linked to the complaint', () => {
    const db = createInitializedDb();
    complaintAbout(db);
    appendInTransaction(db, ev.complaintTriaged(1, { report }));
    expect(
      db
        .prepare(
          'SELECT status, category, severity, suggested_compensation, report_id FROM complaints',
        )
        .get(),
    ).toEqual({
      status: 'triaged',
      category: 'slow_service',
      severity: 2,
      suggested_compensation: 'discount_10',
      report_id: 2,
    });
    expect(db.prepare('SELECT type, status, subject_json FROM reports WHERE id = 2').get()).toEqual(
      {
        type: 'complaint',
        status: 'drafted',
        subject_json: '{"complaint_id":1}',
      },
    );
  });

  it('can be triaged without a report when no boss is needed', () => {
    const db = createInitializedDb();
    complaintAbout(db);
    appendInTransaction(db, ev.complaintTriaged(1));
    expect(db.prepare('SELECT status, report_id FROM complaints').get()).toEqual({
      status: 'triaged',
      report_id: null,
    });
    expect(countRows(db, 'reports')).toBe(0);
  });

  it('end with a reply that records the compensation that was finally given', () => {
    const db = createInitializedDb();
    complaintAbout(db);
    appendInTransaction(db, ev.complaintTriaged(1, { report }));
    appendInTransaction(db, ev.complaintReplied(1, 'discount_10', 33000));
    expect(
      db.prepare('SELECT status, final_compensation, replied_at_sim FROM complaints').get(),
    ).toEqual({
      status: 'replied',
      final_compensation: 'discount_10',
      replied_at_sim: 33000,
    });
  });

  it('keep to their order: triage first, reply second, each once', () => {
    const db = createInitializedDb();
    complaintAbout(db);
    expect(() => appendInTransaction(db, ev.complaintReplied(1))).toThrow(/is not triaged/);
    appendInTransaction(db, ev.complaintTriaged(1));
    expect(() => appendInTransaction(db, ev.complaintTriaged(1))).toThrow(/not waiting for triage/);
    appendInTransaction(db, ev.complaintReplied(1));
    expect(() => appendInTransaction(db, ev.complaintReplied(1))).toThrow(/is not triaged/);
  });
});

describe('a whole story rebuilt from the log', () => {
  it('gives the same state as the live run', () => {
    const db = createInitializedDb();
    withLowMilk(db);
    appendInTransaction(
      db,
      ev.agentTaskAssigned('stock_admin', 1, {
        kind: 'work',
        label: 'checking_stock',
        duration_sim_sec: 90,
      }),
      ev.agentStateChanged('stock_admin', 'working', 'stock_shelf', {
        task_id: 1,
        label: 'checking_stock',
        eta_sim_time: 28890,
      }),
      ev.agentTaskFinished('stock_admin', 1),
      ev.agentStateChanged('stock_admin', 'idle', 'stock_shelf'),
      ev.restockProposed(1),
      ev.reportSubmitted(1),
      ev.reportDecided(1, 'approved'),
      ev.restockOrdered(1, 1),
      ev.restockArrived(1),
      ev.orderCreated(2),
      ev.orderHeld(2),
      ev.orderResumed(2),
      ev.complaintReceived(1, 2),
      ev.complaintTriaged(1, { report }),
      ev.reportSubmitted(2, 'cashier'),
      ev.reportDecided(2, 'approved'),
      ev.complaintReplied(1, 'discount_10'),
    );
    const live = snapshotProjections(db);
    rebuildProjections(db);
    expect(snapshotProjections(db)).toEqual(live);
  });
});
