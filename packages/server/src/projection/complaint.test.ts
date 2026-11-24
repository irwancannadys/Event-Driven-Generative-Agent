import { describe, expect, it } from 'vitest';
import { ev } from '../test-support/events';
import { appendInTransaction, countRows, createInitializedDb } from '../test-support/world';
import { nextId } from '../usecases/context';
import { rebuildProjections } from './rebuild';
import { snapshotProjections } from './snapshot';

describe('complaint_received projection', () => {
  it('records the complaint for its order', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1, undefined, 30000));
    appendInTransaction(db, ev.complaintReceived(1, 1, 'slow_service', 31500));
    expect(db.prepare('SELECT * FROM complaints').all()).toEqual([
      {
        id: 1,
        order_id: 1,
        cause: 'slow_service',
        status: 'received',
        category: null,
        severity: null,
        suggested_compensation: null,
        report_id: null,
        final_compensation: null,
        received_at_sim: 31500,
        replied_at_sim: null,
      },
    ]);
  });

  it('rejects a second complaint for the same order', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1), ev.complaintReceived(1, 1));
    expect(() => appendInTransaction(db, ev.complaintReceived(2, 1))).toThrow(
      /order 1 already has complaint 1/,
    );
    expect(countRows(db, 'complaints')).toBe(1);
  });

  it('rejects a complaint about an order that does not exist', () => {
    const db = createInitializedDb();
    expect(() => appendInTransaction(db, ev.complaintReceived(1, 99))).toThrow(/FOREIGN KEY/);
  });

  it('survives a rebuild from the log', () => {
    const db = createInitializedDb();
    appendInTransaction(db, ev.orderCreated(1), ev.orderCreated(2), ev.complaintReceived(1, 2));
    const live = snapshotProjections(db);
    rebuildProjections(db);
    expect(snapshotProjections(db)).toEqual(live);
  });
});

describe('nextId', () => {
  it('allocates complaint ids one after the other', () => {
    const db = createInitializedDb();
    expect(nextId(db, 'complaints')).toBe(1);
    appendInTransaction(db, ev.orderCreated(1), ev.orderCreated(2), ev.complaintReceived(1, 1));
    expect(nextId(db, 'complaints')).toBe(2);
    appendInTransaction(db, ev.complaintReceived(2, 2));
    expect(nextId(db, 'complaints')).toBe(3);
  });
});
