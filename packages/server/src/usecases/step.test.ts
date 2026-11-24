import { describe, expect, it, vi } from 'vitest';
import type { StoredEvent } from '@cafe/core';
import { countRows, createTestWorld } from '../test-support/world';
import { transact, type Context, type Emit } from './context';
import { createOrder } from './orders';

/** A reaction for tests: every new order is put on hold straight away. */
function holdEveryOrder(_ctx: Context, event: StoredEvent, emit: Emit): void {
  if (event.type === 'order_created') {
    emit({
      type: 'order_held',
      actor: 'cook',
      origin: 'rule',
      payload: {
        order_id: event.payload.order_id,
        missing: [{ ingredient_id: 'susu', needed: 150, available: 0 }],
      },
    });
  }
}

const kopiSusu = { items: [{ menu_item_id: 'kopi_susu', qty: 1 }] };

function types(events: StoredEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('steps with reactions', () => {
  it('writes the reactions of every event in the same step and publishes them together', () => {
    const { ctx, db, published } = createTestWorld();
    ctx.react = holdEveryOrder;
    const batches: StoredEvent[][] = [];
    ctx.publish = (events) => batches.push(events);

    createOrder(ctx, kopiSusu);

    expect(batches).toHaveLength(1);
    expect(types(batches[0] as StoredEvent[])).toEqual(['order_created', 'order_held']);
    expect(db.prepare('SELECT status FROM orders').pluck().get()).toBe('held');
    expect(published).toEqual([]); // the helper's own publish was replaced above
  });

  it('works through reactions in the order events were written (first in, first out)', () => {
    const { ctx } = createTestWorld();
    ctx.react = holdEveryOrder;
    const batches: StoredEvent[][] = [];
    ctx.publish = (events) => batches.push(events);

    transact(ctx, () => {
      createOrder(ctx, kopiSusu);
      createOrder(ctx, kopiSusu);
    });

    // Both orders are written first, and only then do the reactions to them run.
    expect(types(batches[0] as StoredEvent[])).toEqual([
      'order_created',
      'order_created',
      'order_held',
      'order_held',
    ]);
  });

  it('gives events written by a reaction the same virtual time as the event that caused them', () => {
    const { ctx, clock } = createTestWorld();
    ctx.react = holdEveryOrder;
    const batches: StoredEvent[][] = [];
    ctx.publish = (events) => batches.push(events);
    clock.advance(777);
    createOrder(ctx, kopiSusu);
    expect((batches[0] as StoredEvent[]).map((event) => event.sim_time)).toEqual([
      clock.now(),
      clock.now(),
    ]);
  });

  it('rolls the whole step back when a reaction fails: no event, no projection, nothing published', () => {
    const { ctx, db } = createTestWorld();
    ctx.react = (_ctx, event) => {
      if (event.type === 'order_created') throw new Error('reaction broke');
    };
    const publish = vi.fn();
    ctx.publish = publish;
    const events = countRows(db, 'events');

    expect(() => createOrder(ctx, kopiSusu)).toThrow('reaction broke');

    expect(countRows(db, 'events')).toBe(events);
    expect(countRows(db, 'orders')).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('rolls back the earlier work of the step too when a later reaction fails', () => {
    const { ctx, db } = createTestWorld();
    let seen = 0;
    ctx.react = () => {
      seen += 1;
      if (seen === 2) throw new Error('second reaction broke');
    };
    expect(() =>
      transact(ctx, () => {
        createOrder(ctx, kopiSusu);
        createOrder(ctx, kopiSusu);
      }),
    ).toThrow('second reaction broke');
    expect(countRows(db, 'orders')).toBe(0);
  });

  it('can be used again after a failed step', () => {
    const { ctx, db } = createTestWorld();
    ctx.react = () => {
      throw new Error('broken');
    };
    expect(() => createOrder(ctx, kopiSusu)).toThrow('broken');
    ctx.react = undefined;
    createOrder(ctx, kopiSusu);
    expect(countRows(db, 'orders')).toBe(1);
  });

  it('publishes only after the commit, and the reacted events are already saved by then', () => {
    const { ctx, db } = createTestWorld();
    ctx.react = holdEveryOrder;
    const seen: { inTransaction: boolean; held: number }[] = [];
    ctx.publish = () => {
      seen.push({
        inTransaction: db.inTransaction,
        held: db
          .prepare("SELECT COUNT(*) FROM orders WHERE status = 'held'")
          .pluck()
          .get() as number,
      });
    };
    createOrder(ctx, kopiSusu);
    expect(seen).toEqual([{ inTransaction: false, held: 1 }]);
  });

  it('stops reactions that keep triggering each other', () => {
    const { ctx, db } = createTestWorld();
    ctx.maxReactions = 20;
    let next = 100;
    ctx.react = (_ctx, event, emit) => {
      if (event.type === 'order_created') {
        next += 1;
        emit({
          type: 'order_created',
          actor: 'world',
          origin: 'generator',
          payload: {
            order_id: next,
            source: 'walk_in',
            items: [{ menu_item_id: 'kopi_hitam', qty: 1 }],
          },
        });
      }
    };
    expect(() => createOrder(ctx, kopiSusu)).toThrow(/more than 20 reactions in one step/);
    expect(countRows(db, 'orders')).toBe(0);
  });
});

describe('nested steps', () => {
  it('lets a use case called inside a step join it instead of publishing on its own', () => {
    const { ctx } = createTestWorld();
    const batches: StoredEvent[][] = [];
    ctx.publish = (events) => batches.push(events);

    transact(ctx, () => {
      createOrder(ctx, kopiSusu);
      createOrder(ctx, kopiSusu);
    });

    expect(batches).toHaveLength(1);
    expect(types(batches[0] as StoredEvent[])).toEqual(['order_created', 'order_created']);
  });

  it('runs the reactions for events written by a nested use case', () => {
    const { ctx, db } = createTestWorld();
    ctx.react = holdEveryOrder;
    transact(ctx, () => {
      createOrder(ctx, kopiSusu);
    });
    expect(db.prepare("SELECT COUNT(*) FROM orders WHERE status = 'held'").pluck().get()).toBe(1);
  });

  it('rolls everything back when the outer step fails after a nested use case succeeded', () => {
    const { ctx, db } = createTestWorld();
    const publish = vi.fn();
    ctx.publish = publish;
    expect(() =>
      transact(ctx, () => {
        createOrder(ctx, kopiSusu);
        throw new Error('outer failure');
      }),
    ).toThrow('outer failure');
    expect(countRows(db, 'orders')).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('steps on different databases', () => {
  it('do not see each other', () => {
    const first = createTestWorld();
    const second = createTestWorld();
    first.ctx.react = holdEveryOrder;
    transact(first.ctx, () => {
      // A step is running on the first database; the second one is independent.
      createOrder(second.ctx, kopiSusu);
    });
    expect(countRows(second.db, 'orders')).toBe(1);
    expect(
      second.db.prepare("SELECT COUNT(*) FROM orders WHERE status = 'held'").pluck().get(),
    ).toBe(0);
    expect(countRows(first.db, 'orders')).toBe(0);
  });
});
