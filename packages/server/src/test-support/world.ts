import { INITIAL_STOCK, INITIAL_VISITS, type Event, type StoredEvent } from '@cafe/core';
import { openDatabase, type Db } from '../db/database';
import { loadMigrations, runMigrations } from '../db/migrate';
import { seedReferenceData } from '../db/seed';
import { appendEvent } from '../events/store';

/** An in-memory database with the schema applied and the reference data seeded. */
export function createTestDb(): Db {
  const db = openDatabase(':memory:');
  runMigrations(db, loadMigrations());
  seedReferenceData(db);
  return db;
}

/** Appends events in one transaction, the way the use cases do. */
export function appendInTransaction(db: Db, ...events: Event[]): StoredEvent[] {
  return db.transaction(() => events.map((event) => appendEvent(db, event)))();
}

export function countRows(db: Db, table: string): number {
  return db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}

/** A fresh world: reference data seeded and a `world_initialized` event applied. */
export function createInitializedDb(): Db {
  const db = createTestDb();
  appendInTransaction(db, {
    type: 'world_initialized',
    sim_time: 0,
    actor: 'system',
    origin: 'system',
    payload: { seed: 42, initial_stock: INITIAL_STOCK, initial_visits: INITIAL_VISITS },
  });
  return db;
}
