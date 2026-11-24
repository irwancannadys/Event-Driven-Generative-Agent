import { openDatabase, type Db } from './database';
import { loadMigrations, runMigrations } from './migrate';
import { seedReferenceData } from './seed';

/** A throwaway in-memory database with the schema applied and the reference data seeded (for demos). */
export function openSeededMemoryDb(): Db {
  const db = openDatabase(':memory:');
  runMigrations(db, loadMigrations());
  seedReferenceData(db);
  return db;
}
