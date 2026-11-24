import { describe, expect, it } from 'vitest';
import { INITIAL_STOCK, INITIAL_VISITS, type Event } from '@cafe/core';
import { ev } from '../test-support/events';
import {
  appendInTransaction,
  countRows,
  createInitializedDb,
  createTestDb,
} from '../test-support/world';
import { InvalidEventError, appendEvent, listEvents } from './store';

describe('appendEvent', () => {
  it('refuses to run outside a transaction', () => {
    const db = createInitializedDb();
    expect(() => appendEvent(db, ev.orderCreated(1))).toThrow(/inside a transaction/);
    expect(countRows(db, 'orders')).toBe(0);
  });

  it('rejects an invalid event and writes nothing', () => {
    const db = createInitializedDb();
    const before = countRows(db, 'events');
    const invalid = { ...ev.cookingStarted(1), origin: 'boss' } as Event;
    expect(() => appendInTransaction(db, invalid)).toThrow(InvalidEventError);
    expect(() => appendInTransaction(db, invalid)).toThrow(/origin "boss" is not allowed/);
    expect(countRows(db, 'events')).toBe(before);
  });

  it('assigns increasing ids and returns the stored event', () => {
    const db = createInitializedDb();
    const [first, second] = appendInTransaction(
      db,
      ev.orderCreated(1),
      ev.orderCreated(2, [{ menu_item_id: 'es_teh_manis', qty: 1 }]),
    );
    expect(first?.id).toBe(2); // id 1 is world_initialized
    expect(second?.id).toBe(3);
    expect(first?.type).toBe('order_created');
  });

  it('writes the event and its projection together', () => {
    const db = createTestDb();
    appendInTransaction(db, {
      type: 'world_initialized',
      sim_time: 0,
      actor: 'system',
      origin: 'system',
      payload: { seed: 1, initial_stock: INITIAL_STOCK, initial_visits: INITIAL_VISITS },
    });
    expect(countRows(db, 'events')).toBe(1);
    expect(countRows(db, 'stock')).toBe(8);
  });

  it('is atomic: when the projection fails, the event and earlier work in the transaction roll back', () => {
    const db = createInitializedDb();
    const events = countRows(db, 'events');
    expect(() =>
      db.transaction(() => {
        appendEvent(db, ev.orderCreated(1)); // fine
        appendEvent(db, ev.cookingStarted(1)); // fine
        // Wrong on purpose: kopi_susu would leave 1182, not 5.
        appendEvent(db, ev.stockDecreased(1, 'kopi', 18, 5));
      })(),
    ).toThrow(/cannot be 5/);
    expect(countRows(db, 'events')).toBe(events);
    expect(countRows(db, 'orders')).toBe(0);
  });
});

describe('listEvents', () => {
  it('reads events back in log order, identical to what was written', () => {
    const db = createInitializedDb();
    const written = appendInTransaction(
      db,
      ev.orderCreated(1),
      ev.cookingStarted(1),
      ev.stockDecreased(1, 'kopi', 18, 1182),
    );
    const read = listEvents(db);
    expect(read.map((event) => event.type)).toEqual([
      'world_initialized',
      'order_created',
      'cooking_started',
      'stock_decreased',
    ]);
    expect(read.slice(1)).toEqual(written);
  });

  it('can start after a given id', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1), ev.orderCreated(2));
    expect(listEvents(db, { afterId: 2 }).map((event) => event.id)).toEqual([3]);
  });
});
