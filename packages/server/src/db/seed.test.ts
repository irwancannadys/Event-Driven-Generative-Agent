import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from './database';
import { loadMigrations, runMigrations } from './migrate';
import { seedReferenceData } from './seed';

function seededDb(): Db {
  const db = openDatabase(':memory:');
  runMigrations(db, loadMigrations());
  seedReferenceData(db);
  return db;
}

describe('seed script', () => {
  it('fills the reference tables', () => {
    const db = openDatabase(':memory:');
    runMigrations(db, loadMigrations());
    expect(seedReferenceData(db)).toEqual({
      menu_items: 6,
      ingredients: 8,
      recipe_items: 13,
      regulars: 3,
      suppliers_mock: 8,
    });
  });

  it('is idempotent: seeding twice gives the same counts', () => {
    const db = seededDb();
    const first = seedReferenceData(db);
    const second = seedReferenceData(db);
    expect(second).toEqual(first);
  });

  it('updates changed values instead of duplicating rows', () => {
    const db = seededDb();
    db.prepare("UPDATE menu_items SET price = 1 WHERE id = 'kopi_susu'").run();
    seedReferenceData(db);
    expect(db.prepare("SELECT price FROM menu_items WHERE id = 'kopi_susu'").pluck().get()).toBe(
      18000,
    );
  });

  it('leaves no broken foreign keys', () => {
    expect(seededDb().pragma('foreign_key_check')).toEqual([]);
  });

  it('stores the usual order of a regular as JSON', () => {
    const db = seededDb();
    const json = db
      .prepare("SELECT usual_order_json FROM regulars WHERE id = 'pak_budi'")
      .pluck()
      .get();
    expect(JSON.parse(json as string)).toEqual({
      items: [{ menu_item_id: 'kopi_susu', qty: 1 }],
      note: 'kurang gula',
    });
  });

  it('does not create projection rows (stock comes from events)', () => {
    const db = seededDb();
    expect(db.prepare('SELECT COUNT(*) FROM stock').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(0);
  });
});
