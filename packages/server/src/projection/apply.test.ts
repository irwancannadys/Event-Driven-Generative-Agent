import { describe, expect, it } from 'vitest';
import { INITIAL_STOCK, INITIAL_VISITS, type Event } from '@cafe/core';
import { readStock } from '../db/queries';
import { AT, ev } from '../test-support/events';
import {
  appendInTransaction,
  countRows,
  createInitializedDb,
  createTestDb,
} from '../test-support/world';
import { ProjectionNotImplementedError } from './apply';

function worldInitialized(
  overrides: Partial<Extract<Event, { type: 'world_initialized' }>['payload']> = {},
): Event {
  return {
    type: 'world_initialized',
    sim_time: 0,
    actor: 'system',
    origin: 'system',
    payload: {
      seed: 42,
      initial_stock: INITIAL_STOCK,
      initial_visits: INITIAL_VISITS,
      ...overrides,
    },
  };
}

function orderStatus(db: ReturnType<typeof createTestDb>, id: number): unknown {
  return db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(id);
}

describe('world_initialized', () => {
  it('fills stock, regular state and the three tables', () => {
    const db = createInitializedDb();
    expect(Object.fromEntries(readStock(db).map((row) => [row.ingredient_id, row.qty]))).toEqual(
      INITIAL_STOCK,
    );
    expect(readStock(db).every((row) => !row.low_flagged && !row.out_flagged)).toBe(true);
    expect(
      db.prepare('SELECT regular_id, visits, present FROM regular_state ORDER BY 1').all(),
    ).toEqual([
      { regular_id: 'bu_sari', visits: 2, present: 0 },
      { regular_id: 'mas_joko', visits: 1, present: 0 },
      { regular_id: 'pak_budi', visits: 3, present: 0 },
    ]);
    expect(db.prepare('SELECT id, state FROM cafe_tables ORDER BY id').all()).toEqual([
      { id: 1, state: 'empty' },
      { id: 2, state: 'empty' },
      { id: 3, state: 'empty' },
    ]);
  });

  it('clears the previous projections when a new world starts', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.orderCreated(1),
      ev.cookingStarted(1),
      ev.stockDecreased(1, 'kopi', 18, 1182),
    );
    appendInTransaction(db, worldInitialized());
    expect(countRows(db, 'orders')).toBe(0);
    expect(countRows(db, 'order_items')).toBe(0);
    expect(readStock(db).find((row) => row.ingredient_id === 'kopi')?.qty).toBe(1200);
    expect(countRows(db, 'events')).toBe(5); // the log keeps everything
  });

  it('rejects an initial stock that misses an ingredient', () => {
    const db = createTestDb();
    const withoutKopi = Object.fromEntries(
      Object.entries(INITIAL_STOCK).filter(([id]) => id !== 'kopi'),
    );
    expect(() => appendInTransaction(db, worldInitialized({ initial_stock: withoutKopi }))).toThrow(
      /initial_stock is missing: kopi/,
    );
    expect(countRows(db, 'events')).toBe(0);
  });

  it('rejects an ingredient that does not exist', () => {
    const db = createTestDb();
    expect(() =>
      appendInTransaction(db, worldInitialized({ initial_stock: { ...INITIAL_STOCK, ghost: 5 } })),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('order projection', () => {
  it('creates the order and its lines', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.orderCreated(
        1,
        [
          { menu_item_id: 'kopi_susu', qty: 2 },
          { menu_item_id: 'roti_bakar', qty: 1 },
        ],
        30000,
      ),
    );
    expect(db.prepare('SELECT id, status, source, created_at_sim FROM orders').all()).toEqual([
      { id: 1, status: 'placed', source: 'walk_in', created_at_sim: 30000 },
    ]);
    expect(
      db.prepare('SELECT menu_item_id, qty FROM order_items ORDER BY menu_item_id').all(),
    ).toEqual([
      { menu_item_id: 'kopi_susu', qty: 2 },
      { menu_item_id: 'roti_bakar', qty: 1 },
    ]);
  });

  it('rejects the same menu item twice in one order', () => {
    const db = createInitializedDb();
    expect(() =>
      appendInTransaction(
        db,
        ev.orderCreated(1, [
          { menu_item_id: 'kopi_susu', qty: 1 },
          { menu_item_id: 'kopi_susu', qty: 1 },
        ]),
      ),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(countRows(db, 'orders')).toBe(0);
  });

  it('walks an order through placed, cooking, done and records when it finished', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1));
    expect(orderStatus(db, 1)).toBe('placed');
    appendInTransaction(db, ev.cookingStarted(1));
    expect(orderStatus(db, 1)).toBe('cooking');
    appendInTransaction(db, ev.cookingDone(1, 29000));
    expect(orderStatus(db, 1)).toBe('done');
    expect(db.prepare('SELECT done_at_sim FROM orders WHERE id = 1').pluck().get()).toBe(29000);
  });

  it('holds an order that was waiting to be cooked', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1), ev.orderHeld(1));
    expect(orderStatus(db, 1)).toBe('held');
  });

  it('refuses moves that are not allowed from the current status', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1));
    expect(() => appendInTransaction(db, ev.cookingDone(1))).toThrow(
      /cannot go from "cooking" to "done"/,
    );
    appendInTransaction(db, ev.cookingStarted(1));
    expect(() => appendInTransaction(db, ev.cookingStarted(1))).toThrow(/current status: cooking/);
    expect(() => appendInTransaction(db, ev.orderHeld(1))).toThrow(
      /cannot go from "placed" to "held"/,
    );
    expect(() => appendInTransaction(db, ev.cookingStarted(99))).toThrow(/not found/);
  });
});

describe('stock projection', () => {
  function cookingOrder() {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1), ev.cookingStarted(1));
    return db;
  }

  it('decreases the stock', () => {
    const db = cookingOrder();
    appendInTransaction(db, ev.stockDecreased(1, 'susu', 150, 2350));
    expect(readStock(db).find((row) => row.ingredient_id === 'susu')?.qty).toBe(2350);
  });

  it('rejects a decrease that does not match the current stock', () => {
    const db = cookingOrder();
    expect(() => appendInTransaction(db, ev.stockDecreased(1, 'susu', 150, 2000))).toThrow(
      /susu has 2500, minus 150 cannot be 2000/,
    );
    expect(readStock(db).find((row) => row.ingredient_id === 'susu')?.qty).toBe(2500);
  });

  it('rejects a decrease for an order that is not cooking, or an ingredient without stock', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1));
    expect(() => appendInTransaction(db, ev.stockDecreased(1, 'susu', 150, 2350))).toThrow(
      /order 1 is not cooking/,
    );
    appendInTransaction(db, ev.cookingStarted(1));
    expect(() => appendInTransaction(db, ev.stockDecreased(1, 'ghost', 1, 0))).toThrow(
      /no stock row for ingredient "ghost"/,
    );
  });

  it('sets the low flag once, and a second stock_low for the same ingredient is an error', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1), ev.cookingStarted(1));
    // 150 x 10 cups are not needed here: drive the stock down directly in one step.
    appendInTransaction(db, ev.stockDecreased(1, 'teh', 300, 50), ev.stockLow('teh', 50, 100));
    expect(readStock(db).find((row) => row.ingredient_id === 'teh')?.low_flagged).toBe(true);
    expect(() => appendInTransaction(db, ev.stockLow('teh', 50, 100))).toThrow(
      /signal was emitted twice/,
    );
  });

  it('sets the out flag only when the stock is really zero', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1), ev.cookingStarted(1));
    expect(() => appendInTransaction(db, ev.stockOut('teh'))).toThrow(
      /teh has 350, the event says 0/,
    );
    appendInTransaction(db, ev.stockDecreased(1, 'teh', 350, 0), ev.stockOut('teh'));
    expect(readStock(db).find((row) => row.ingredient_id === 'teh')?.out_flagged).toBe(true);
  });

  it('rejects a stock_low whose quantity disagrees with the stock', () => {
    const db = createInitializedDb();
    expect(() => appendInTransaction(db, ev.stockLow('teh', 40, 100))).toThrow(
      /teh has 350, the event says 40/,
    );
  });
});

describe('events without a projection', () => {
  it('records log-only events and changes nothing else', () => {
    const db = createInitializedDb();
    const before = countRows(db, 'stock');
    appendInTransaction(db, {
      type: 'day_opened',
      sim_time: 28800,
      actor: 'system',
      origin: 'scheduler',
      payload: { day: 0 },
    });
    expect(countRows(db, 'events')).toBe(2);
    expect(countRows(db, 'stock')).toBe(before);
  });

  it('fails loudly for an event whose projection is not built yet', () => {
    const db = createInitializedDb();
    // Rina's events belong to stage 5.
    const regularArrived: Event = {
      type: 'regular_arrived',
      sim_time: 30600,
      actor: 'world',
      origin: 'scheduler',
      payload: { regular_id: 'pak_budi', table_id: 1 },
    };
    expect(() => appendInTransaction(db, regularArrived)).toThrow(ProjectionNotImplementedError);
    expect(countRows(db, 'events')).toBe(1); // only world_initialized: the failed one rolled back
  });
});

describe('the customer and the moment of recording on an order (decision 032)', () => {
  const column = (db: ReturnType<typeof createTestDb>, name: string, id: number) =>
    db.prepare(`SELECT ${name} FROM orders WHERE id = ?`).pluck().get(id);
  const cookTask = (task_id: number, order_id: number, sim_time: number): Event => ({
    type: 'agent_task_assigned',
    sim_time,
    actor: 'cook',
    origin: 'rule',
    payload: {
      agent_id: 'cook',
      task_id,
      kind: 'work',
      label: 'cooking',
      duration_sim_sec: 180,
      ref: { type: 'order', id: order_id },
    },
  });

  it('keeps the customer of a walk-in order, and none for an order made by hand', () => {
    const db = createInitializedDb();
    const withCustomer = ev.orderCreated(1);
    if (withCustomer.type === 'order_created') withCustomer.payload.customer_id = 48_300;
    appendInTransaction(db, withCustomer, ev.orderCreated(2));
    expect(column(db, 'customer_id', 1)).toBe(48_300);
    expect(column(db, 'customer_id', 2)).toBeNull();
    expect(column(db, 'recorded_at_sim', 1)).toBeNull();
  });

  it('notes when the cook is given the order, and keeps the first moment when it is given again', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1), cookTask(1, 1, AT + 45));
    expect(column(db, 'recorded_at_sim', 1)).toBe(AT + 45);
    appendInTransaction(db, cookTask(2, 1, AT + 5000)); // held for want of milk, cooked again later
    expect(column(db, 'recorded_at_sim', 1)).toBe(AT + 45);
  });

  it('does not take any other task for the moment of recording', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1), {
      type: 'agent_task_assigned',
      sim_time: AT + 10,
      actor: 'cashier',
      origin: 'rule',
      payload: {
        agent_id: 'cashier',
        task_id: 1,
        kind: 'work',
        label: 'recording_order',
        duration_sim_sec: 45,
        ref: { type: 'order', id: 1 },
      },
    });
    expect(column(db, 'recorded_at_sim', 1)).toBeNull();
  });
});

describe('policy_proposed, policy_changed and memory_created (decision 034)', () => {
  it('puts a proposal for the boss among the reports, as a report of the kind policy', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.policyProposed(1));
    expect(db.prepare('SELECT id, type, status, subject_json FROM reports').get()).toEqual({
      id: 1,
      type: 'policy',
      status: 'drafted',
      subject_json: JSON.stringify({
        change: { ingredient_id: 'susu', from: 1000, to: 1500 },
        rationale: 'Susu sering menahan pesanan.',
      }),
    });
  });

  it('changes the minimum stock that is in force, and only that of the ingredient', () => {
    const db = createInitializedDb();
    expect(readStock(db).find((row) => row.ingredient_id === 'susu')).toMatchObject({
      min_qty: 1000,
      base_min_qty: 1000,
    });
    appendInTransaction(db, ev.policyChanged(1, { ingredient_id: 'susu', from: 1000, to: 1500 }));
    const rows = readStock(db);
    expect(rows.find((row) => row.ingredient_id === 'susu')).toMatchObject({
      min_qty: 1500,
      base_min_qty: 1000,
    });
    expect(rows.find((row) => row.ingredient_id === 'kopi')?.min_qty).toBe(
      rows.find((row) => row.ingredient_id === 'kopi')?.base_min_qty,
    );
  });

  it('can change it again, and the last change counts', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.policyChanged(1, { ingredient_id: 'susu', from: 1000, to: 1500 }),
      ev.policyChanged(2, { ingredient_id: 'susu', from: 1500, to: 2000 }),
    );
    expect(readStock(db).find((row) => row.ingredient_id === 'susu')?.min_qty).toBe(2000);
    expect(countRows(db, 'stock_policy')).toBe(1);
  });

  it('keeps a note of the stock admin, with the ingredient it is about when it has one', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.memoryCreated('Hari 0: 75 pesanan.', 'observation', undefined, 100),
      ev.memoryCreated('Batas Susu dinaikkan: membantu.', 'reflection', 'susu', 200),
    );
    expect(
      db
        .prepare(
          'SELECT agent_id, regular_id, kind, ingredient_id, text, sim_time FROM memories ORDER BY id',
        )
        .all(),
    ).toEqual([
      {
        agent_id: 'stock_admin',
        regular_id: null,
        kind: 'observation',
        ingredient_id: null,
        text: 'Hari 0: 75 pesanan.',
        sim_time: 100,
      },
      {
        agent_id: 'stock_admin',
        regular_id: null,
        kind: 'reflection',
        ingredient_id: 'susu',
        text: 'Batas Susu dinaikkan: membantu.',
        sim_time: 200,
      },
    ]);
  });

  it('judges whether a delivery brings the stock above the minimum by the new minimum', () => {
    const db = createInitializedDb();
    // milk is low (800 <= 1500) and flagged; a delivery to 1700 clears the flag with the minimum of 1500, not of 1000
    db.prepare("UPDATE stock SET qty = 800, low_flagged = 1 WHERE ingredient_id = 'susu'").run();
    appendInTransaction(
      db,
      ev.policyChanged(1, { ingredient_id: 'susu', from: 1000, to: 1500 }),
      ev.restockProposed(2, [{ ingredient_id: 'susu', qty: 800 }]),
      ev.reportSubmitted(2),
      ev.reportDecided(2, 'approved'),
      ev.restockOrdered(1, 2, [{ ingredient_id: 'susu', qty: 800 }], 'on_time', 7200),
      ev.restockArrived(1, [{ ingredient_id: 'susu', qty: 800 }]),
    );
    const row = readStock(db).find((entry) => entry.ingredient_id === 'susu');
    expect(row).toMatchObject({ qty: 1600, low_flagged: false });
    db.prepare("UPDATE stock SET qty = 800, low_flagged = 1 WHERE ingredient_id = 'susu'").run();
    appendInTransaction(
      db,
      ev.restockOrdered(2, 2, [{ ingredient_id: 'susu', qty: 400 }], 'on_time', 7200),
    );
    appendInTransaction(db, ev.restockArrived(2, [{ ingredient_id: 'susu', qty: 400 }]));
    // 1200 is above the old minimum (1000) but not above the new one (1500): the flag stays
    expect(readStock(db).find((entry) => entry.ingredient_id === 'susu')).toMatchObject({
      qty: 1200,
      low_flagged: true,
    });
  });
});
