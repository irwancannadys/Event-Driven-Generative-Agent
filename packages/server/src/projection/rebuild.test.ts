import { describe, expect, it } from 'vitest';
import { INITIAL_STOCK, INITIAL_VISITS } from '@cafe/core';
import { ev } from '../test-support/events';
import { scenarioEvents } from '../test-support/scenario';
import {
  appendInTransaction,
  countRows,
  createInitializedDb,
  createTestDb,
} from '../test-support/world';
import { rebuildProjections } from './rebuild';
import { snapshotProjections } from './snapshot';

describe('snapshotProjections', () => {
  it('lists every projection table in a stable order', () => {
    const snapshot = snapshotProjections(createInitializedDb());
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'agent_tasks',
        'agents',
        'cafe_tables',
        'complaints',
        'memories',
        'order_items',
        'orders',
        'regular_state',
        'reports',
        'restock_orders',
        'stock',
      ].sort(),
    );
    expect(snapshot.stock).toHaveLength(8);
  });
});

describe('rebuildProjections', () => {
  it('gives the same state as the live run (replay equals live)', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ...scenarioEvents());
    const live = snapshotProjections(db);
    const applied = rebuildProjections(db);
    expect(applied).toBe(1 + scenarioEvents().length);
    expect(snapshotProjections(db)).toEqual(live);
  });

  it('restores projections that were lost (recovery after a restart)', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ...scenarioEvents());
    const live = snapshotProjections(db);
    for (const table of ['order_items', 'orders', 'stock', 'regular_state', 'cafe_tables']) {
      db.exec(`DELETE FROM ${table}`);
    }
    expect(countRows(db, 'stock')).toBe(0);
    rebuildProjections(db);
    expect(snapshotProjections(db)).toEqual(live);
  });

  it('starts from the last world_initialized and ignores what came before', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1));
    appendInTransaction(db, {
      type: 'world_initialized',
      sim_time: 0,
      actor: 'system',
      origin: 'system',
      payload: { seed: 7, initial_stock: INITIAL_STOCK, initial_visits: INITIAL_VISITS },
    });
    appendInTransaction(db, ev.orderCreated(1, [{ menu_item_id: 'es_teh_manis', qty: 2 }]));
    const live = snapshotProjections(db);
    expect(rebuildProjections(db)).toBe(2);
    expect(snapshotProjections(db)).toEqual(live);
    expect(db.prepare('SELECT menu_item_id FROM order_items').pluck().all()).toEqual([
      'es_teh_manis',
    ]);
  });

  it('refuses to rebuild a log that has no world_initialized', () => {
    expect(() => rebuildProjections(createTestDb())).toThrow(/no world_initialized/);
  });

  it('changes nothing when an event in the log contradicts the state', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1), ev.cookingStarted(1));
    const before = snapshotProjections(db);
    // A corrupt row written behind the store's back: the stock would not be 5 after this.
    db.prepare(
      `INSERT INTO events (type, sim_time, actor, origin, payload_json)
       VALUES ('stock_decreased', 28800, 'cook', 'rule', ?)`,
    ).run(JSON.stringify({ ingredient_id: 'kopi', qty: 18, new_qty: 5, order_id: 1 }));
    expect(() => rebuildProjections(db)).toThrow(/cannot be 5/);
    expect(snapshotProjections(db)).toEqual(before);
  });
});
