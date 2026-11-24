import { INITIAL_STOCK, INITIAL_VISITS, type Event, type StoredEvent } from '@cafe/core';
import { openDatabase, type Db } from '../db/database';
import { loadMigrations, runMigrations } from '../db/migrate';
import { seedReferenceData } from '../db/seed';
import { ManualClock } from '../clock/manual-clock';
import { appendEvent } from '../events/store';
import type { Context } from '../usecases/context';
import { initializeWorld } from '../usecases/world';

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

export interface TestWorld {
  db: Db;
  clock: ManualClock;
  ctx: Context;
  /** Every event that was published after a commit, in order. */
  published: StoredEvent[];
}

/** A world driven through the use cases: initialized, clock at 08:00, events collected as published. */
export function createTestWorld(): TestWorld {
  const db = createTestDb();
  const clock = new ManualClock();
  const published: StoredEvent[] = [];
  const ctx: Context = {
    db,
    clock,
    publish: (events) => {
      published.push(...events);
    },
  };
  initializeWorld(ctx, { seed: 42 });
  published.length = 0; // tests care about what happens after the world exists
  return { db, clock, ctx, published };
}
