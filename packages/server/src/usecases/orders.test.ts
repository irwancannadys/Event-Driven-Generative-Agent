import { describe, expect, it } from 'vitest';
import { INITIAL_STOCK } from '@cafe/core';
import { readStock } from '../db/queries';
import { createTestDb, createTestWorld, countRows } from '../test-support/world';
import { DomainError } from './context';
import { createOrder } from './orders';
import { hasWorld, initializeWorld } from './world';

describe('initializeWorld', () => {
  it('writes world_initialized from the seed data and fills the projections', () => {
    const db = createTestDb();
    expect(hasWorld(db)).toBe(false);
    const events: unknown[] = [];
    const clock = { now: () => 0, advance: () => undefined };
    const stored = initializeWorld(
      { db, clock, publish: (batch) => events.push(...batch) },
      { seed: 7 },
    );
    expect(stored.type).toBe('world_initialized');
    expect(stored.payload).toMatchObject({ seed: 7, initial_stock: INITIAL_STOCK });
    expect(hasWorld(db)).toBe(true);
    expect(events).toHaveLength(1);
    expect(readStock(db)).toHaveLength(8);
  });
});

describe('createOrder', () => {
  it('records the order and gives out increasing ids', () => {
    const { db, ctx } = createTestWorld();
    expect(createOrder(ctx, { items: [{ menu_item_id: 'kopi_susu', qty: 1 }] })).toEqual({
      order_id: 1,
    });
    expect(createOrder(ctx, { items: [{ menu_item_id: 'roti_bakar', qty: 2 }] })).toEqual({
      order_id: 2,
    });
    expect(db.prepare('SELECT id, status, source FROM orders ORDER BY id').all()).toEqual([
      { id: 1, status: 'placed', source: 'walk_in' },
      { id: 2, status: 'placed', source: 'walk_in' },
    ]);
  });

  it('writes order_created as the world, through the generator, at the clock time', () => {
    const { ctx, clock, published } = createTestWorld();
    clock.advance(600);
    createOrder(ctx, { items: [{ menu_item_id: 'kopi_susu', qty: 1 }] });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: 'order_created',
      actor: 'world',
      origin: 'generator',
      sim_time: clock.now(),
      payload: { order_id: 1, source: 'walk_in', items: [{ menu_item_id: 'kopi_susu', qty: 1 }] },
    });
  });

  it('merges lines of the same menu item into one', () => {
    const { db, ctx } = createTestWorld();
    createOrder(ctx, {
      items: [
        { menu_item_id: 'kopi_susu', qty: 1 },
        { menu_item_id: 'roti_bakar', qty: 1 },
        { menu_item_id: 'kopi_susu', qty: 2 },
      ],
    });
    expect(
      db.prepare('SELECT menu_item_id, qty FROM order_items ORDER BY menu_item_id').all(),
    ).toEqual([
      { menu_item_id: 'kopi_susu', qty: 3 },
      { menu_item_id: 'roti_bakar', qty: 1 },
    ]);
  });

  it('rejects an unknown menu item and writes nothing', () => {
    const { db, ctx, published } = createTestWorld();
    const attempt = () => createOrder(ctx, { items: [{ menu_item_id: 'sate', qty: 1 }] });
    expect(attempt).toThrow(DomainError);
    expect(attempt).toThrow(/unknown menu item "sate"/);
    expect(countRows(db, 'orders')).toBe(0);
    expect(published).toEqual([]);
  });

  it('rejects an empty order and quantities that are not positive whole numbers', () => {
    const { ctx } = createTestWorld();
    for (const items of [
      [],
      [{ menu_item_id: 'kopi_susu', qty: 0 }],
      [{ menu_item_id: 'kopi_susu', qty: -1 }],
      [{ menu_item_id: 'kopi_susu', qty: 1.5 }],
    ]) {
      expect(() => createOrder(ctx, { items }), JSON.stringify(items)).toThrow(/at least one item/);
    }
  });
});
