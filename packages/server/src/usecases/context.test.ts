import { describe, expect, it, vi } from 'vitest';
import type { StoredEvent } from '@cafe/core';
import { countRows, createTestWorld } from '../test-support/world';
import { transact } from './context';

describe('transact', () => {
  it('stamps events with the clock time and publishes them after the commit', () => {
    const { db, clock, ctx } = createTestWorld();
    clock.advance(300);
    const seen: { events: StoredEvent[]; inTransaction: boolean; storedAtPublish: number }[] = [];
    ctx.publish = (events) => {
      seen.push({
        events,
        inTransaction: db.inTransaction,
        storedAtPublish: countRows(db, 'orders'),
      });
    };

    transact(ctx, (emit) => {
      emit({
        type: 'order_created',
        actor: 'world',
        origin: 'generator',
        payload: { order_id: 1, source: 'walk_in', items: [{ menu_item_id: 'kopi_susu', qty: 1 }] },
      });
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.inTransaction).toBe(false); // the transaction had committed
    expect(seen[0]?.storedAtPublish).toBe(1); // and the order was already saved
    expect(seen[0]?.events[0]?.sim_time).toBe(clock.now());
    expect(seen[0]?.events[0]?.id).toBeGreaterThan(0);
  });

  it('publishes nothing and keeps nothing when the work fails', () => {
    const { db, ctx, published } = createTestWorld();
    const events = countRows(db, 'events');
    expect(() =>
      transact(ctx, (emit) => {
        emit({
          type: 'order_created',
          actor: 'world',
          origin: 'generator',
          payload: {
            order_id: 1,
            source: 'walk_in',
            items: [{ menu_item_id: 'kopi_susu', qty: 1 }],
          },
        });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(published).toEqual([]);
    expect(countRows(db, 'events')).toBe(events);
    expect(countRows(db, 'orders')).toBe(0);
  });

  it('keeps the saved work when a listener fails, and reports the error', () => {
    const { db, ctx } = createTestWorld();
    ctx.publish = () => {
      throw new Error('listener broke');
    };
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      transact(ctx, (emit) => {
        emit({
          type: 'order_created',
          actor: 'world',
          origin: 'generator',
          payload: {
            order_id: 1,
            source: 'walk_in',
            items: [{ menu_item_id: 'kopi_susu', qty: 1 }],
          },
        });
      });
      expect(countRows(db, 'orders')).toBe(1);
      expect(report).toHaveBeenCalledOnce();
    } finally {
      report.mockRestore();
    }
  });

  it('does not call publish when nothing was written', () => {
    const { ctx } = createTestWorld();
    const publish = vi.fn();
    ctx.publish = publish;
    transact(ctx, () => 'nothing to do');
    expect(publish).not.toHaveBeenCalled();
  });
});
