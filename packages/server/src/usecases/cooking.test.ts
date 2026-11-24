import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '@cafe/core';
import { readStock } from '../db/queries';
import { snapshotProjections } from '../projection/snapshot';
import { rebuildProjections } from '../projection/rebuild';
import { createTestWorld, type TestWorld } from '../test-support/world';
import { DomainError } from './context';
import { completeCooking, startCooking } from './cooking';
import { createOrder } from './orders';

function order(world: TestWorld, menu_item_id: string, qty = 1): number {
  return createOrder(world.ctx, { items: [{ menu_item_id, qty }] }).order_id;
}

function qtyOf(world: TestWorld, ingredient_id: string): number | undefined {
  return readStock(world.db).find((row) => row.ingredient_id === ingredient_id)?.qty;
}

function types(events: StoredEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('startCooking', () => {
  it('starts cooking and takes the ingredients, sorted by ingredient id', () => {
    const world = createTestWorld();
    const id = order(world, 'kopi_susu');
    world.published.length = 0;

    const result = startCooking(world.ctx, id);

    expect(result).toEqual({ held: false, duration_sim_sec: 180 });
    expect(types(world.published)).toEqual([
      'cooking_started',
      'stock_decreased',
      'stock_decreased',
      'stock_decreased',
    ]);
    expect(
      world.published
        .slice(1)
        .map((event) => (event.payload as { ingredient_id: string }).ingredient_id),
    ).toEqual(['gula', 'kopi', 'susu']);
    expect(qtyOf(world, 'kopi')).toBe(1182);
    expect(qtyOf(world, 'susu')).toBe(2350);
    expect(qtyOf(world, 'gula')).toBe(1190);
    expect(world.db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(id)).toBe(
      'cooking',
    );
  });

  it('writes the events as the cook, by rule, at the clock time', () => {
    const world = createTestWorld();
    const id = order(world, 'kopi_susu');
    world.clock.advance(120);
    world.published.length = 0;
    startCooking(world.ctx, id);
    for (const event of world.published) {
      expect(event.actor).toBe('cook');
      expect(event.origin).toBe('rule');
      expect(event.sim_time).toBe(world.clock.now());
    }
  });

  it('emits stock_low exactly once, at the cup that crosses the minimum (milk, cup 10)', () => {
    const world = createTestWorld();
    for (let cup = 1; cup <= 11; cup += 1) {
      const id = order(world, 'kopi_susu');
      startCooking(world.ctx, id);
      world.clock.advance(180);
      completeCooking(world.ctx, id);
    }
    const lows = world.published.filter((event) => event.type === 'stock_low');
    expect(lows).toHaveLength(1);
    expect(lows[0]?.payload).toEqual({ ingredient_id: 'susu', qty: 1000, min_qty: 1000 });
    expect(lows[0]?.actor).toBe('system');
    // The event right before it belongs to the cooking of order 10.
    const index = world.published.indexOf(lows[0] as StoredEvent);
    const startOfThatCooking = [...world.published.slice(0, index)]
      .reverse()
      .find((event) => event.type === 'cooking_started');
    expect(startOfThatCooking?.payload).toMatchObject({ order_id: 10 });
    expect(readStock(world.db).find((row) => row.ingredient_id === 'susu')?.low_flagged).toBe(true);
    expect(qtyOf(world, 'susu')).toBe(2500 - 11 * 150);
  });

  it('emits stock_low and stock_out together when the stock drops from fine to zero', () => {
    const world = createTestWorld();
    const id = order(world, 'nasi_goreng', 20);
    world.published.length = 0;
    startCooking(world.ctx, id);
    expect(world.published.slice(1).map((event) => [event.type, event.payload])).toEqual([
      ['stock_decreased', { ingredient_id: 'nasi', qty: 4000, new_qty: 0, order_id: id }],
      ['stock_decreased', { ingredient_id: 'telur', qty: 20, new_qty: 10, order_id: id }],
      ['stock_low', { ingredient_id: 'nasi', qty: 0, min_qty: 1000 }],
      ['stock_out', { ingredient_id: 'nasi' }],
      ['stock_low', { ingredient_id: 'telur', qty: 10, min_qty: 10 }],
    ]);
  });

  it('holds an order when an ingredient is short, and leaves the stock untouched', () => {
    const world = createTestWorld();
    startCooking(world.ctx, order(world, 'nasi_goreng', 20));
    const id = order(world, 'nasi_goreng');
    world.published.length = 0;

    const result = startCooking(world.ctx, id);

    expect(result).toEqual({
      held: true,
      missing: [{ ingredient_id: 'nasi', needed: 200, available: 0 }],
    });
    expect(types(world.published)).toEqual(['order_held']);
    expect(qtyOf(world, 'nasi')).toBe(0);
    expect(qtyOf(world, 'telur')).toBe(10);
    expect(world.db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(id)).toBe('held');
  });

  it('is all or nothing across ingredients: a short milk stock leaves coffee and sugar alone', () => {
    const world = createTestWorld();
    const id = order(world, 'kopi_susu', 17); // needs 2550 ml of milk, only 2500 available
    startCooking(world.ctx, id);
    expect(qtyOf(world, 'susu')).toBe(2500);
    expect(qtyOf(world, 'kopi')).toBe(1200);
    expect(qtyOf(world, 'gula')).toBe(1200);
    expect(world.db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(id)).toBe('held');
  });

  it('refuses an order that is unknown or no longer waiting', () => {
    const world = createTestWorld();
    expect(() => startCooking(world.ctx, 99)).toThrow(/does not exist/);
    const id = order(world, 'kopi_susu');
    startCooking(world.ctx, id);
    const second = () => startCooking(world.ctx, id);
    expect(second).toThrow(DomainError);
    expect(second).toThrow(/it is cooking/);

    const heldId = order(world, 'kopi_susu', 17);
    startCooking(world.ctx, heldId);
    expect(() => startCooking(world.ctx, heldId)).toThrow(/it is held/);
  });

  it('keeps the live state identical to a rebuild from the log', () => {
    const world = createTestWorld();
    for (const [item, qty] of [
      ['kopi_susu', 3],
      ['nasi_goreng', 20],
      ['nasi_goreng', 1],
      ['es_teh_manis', 2],
    ] as const) {
      const id = order(world, item, qty);
      const result = startCooking(world.ctx, id);
      if (!result.held) {
        world.clock.advance(result.duration_sim_sec);
        completeCooking(world.ctx, id);
      }
    }
    const live = snapshotProjections(world.db);
    rebuildProjections(world.db);
    expect(snapshotProjections(world.db)).toEqual(live);
  });
});

describe('completeCooking', () => {
  it('marks the order done at the clock time', () => {
    const world = createTestWorld();
    const id = order(world, 'kopi_susu');
    startCooking(world.ctx, id);
    world.clock.advance(180);
    world.published.length = 0;

    completeCooking(world.ctx, id);

    expect(types(world.published)).toEqual(['cooking_done']);
    expect(world.db.prepare('SELECT status, done_at_sim FROM orders WHERE id = ?').get(id)).toEqual(
      {
        status: 'done',
        done_at_sim: world.clock.now(),
      },
    );
  });

  it('refuses an order that is not being cooked', () => {
    const world = createTestWorld();
    const id = order(world, 'kopi_susu');
    expect(() => completeCooking(world.ctx, id)).toThrow(/it is placed/);
    expect(() => completeCooking(world.ctx, 99)).toThrow(/does not exist/);
    startCooking(world.ctx, id);
    completeCooking(world.ctx, id);
    expect(() => completeCooking(world.ctx, id)).toThrow(/it is done/);
  });
});
