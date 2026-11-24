import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from './database';
import { loadMigrations, runMigrations, type Migration } from './migrate';

const EXPECTED_TABLES = [
  'agent_tasks',
  'agents',
  'cafe_tables',
  'complaints',
  'events',
  'ingredients',
  'llm_calls',
  'memories',
  'menu_items',
  'order_items',
  'orders',
  'recipe_items',
  'regular_state',
  'regulars',
  'reports',
  'restock_orders',
  'schema_migrations',
  'sim_clock',
  'stock',
  'suppliers_mock',
];

function migratedDb(): Db {
  const db = openDatabase(':memory:');
  runMigrations(db, loadMigrations());
  return db;
}

function tableNames(db: Db): string[] {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .pluck()
    .all() as string[];
}

function insertEvent(db: Db, origin = 'scheduler', payload = '{"day":0}') {
  return db
    .prepare(
      'INSERT INTO events (type, sim_time, actor, origin, payload_json) VALUES (?, ?, ?, ?, ?)',
    )
    .run('day_opened', 28800, 'system', origin, payload);
}

describe('migration runner', () => {
  it('loads migration files in order', () => {
    const names = loadMigrations().map((migration) => migration.name);
    expect(names[0]).toBe('0001_init.sql');
    expect(names).toEqual([...names].sort());
  });

  it('adds the customer and the recording moment to a database that already has orders', () => {
    // a world that was made before decision 032 keeps its orders, with nothing for the new columns
    const db = openDatabase(':memory:');
    const [first, second] = loadMigrations() as [Migration, Migration];
    runMigrations(db, [first]);
    db.prepare(
      "INSERT INTO orders (id, status, source, created_at_sim) VALUES (1, 'placed', 'walk_in', 100)",
    ).run();
    runMigrations(db, [first, second]);
    expect(db.prepare('SELECT customer_id, recorded_at_sim FROM orders').get()).toEqual({
      customer_id: null,
      recorded_at_sim: null,
    });
  });

  it('creates every table from docs/schema.md', () => {
    expect(tableNames(migratedDb())).toEqual(EXPECTED_TABLES);
  });

  it('is safe to run twice and records each migration once', () => {
    const db = openDatabase(':memory:');
    const migrations = loadMigrations();
    const all = ['0001_init.sql', '0002_order_customer.sql'];
    expect(runMigrations(db, migrations)).toEqual(all);
    expect(runMigrations(db, migrations)).toEqual([]);
    const recorded = db.prepare('SELECT name FROM schema_migrations').pluck().all();
    expect(recorded).toEqual(all);
  });

  it('rolls back a failing migration and does not record it', () => {
    const db = openDatabase(':memory:');
    const migrations = [
      { name: '0001_ok.sql', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY) STRICT;' },
      {
        name: '0002_bad.sql',
        // The second statement fails because table "a" already exists.
        sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY) STRICT; CREATE TABLE a (id INTEGER PRIMARY KEY);',
      },
    ];
    expect(() => runMigrations(db, migrations)).toThrow();
    expect(db.prepare('SELECT name FROM schema_migrations').pluck().all()).toEqual(['0001_ok.sql']);
    expect(tableNames(db)).toEqual(['a', 'schema_migrations']);
  });
});

describe('initial schema', () => {
  it('accepts a valid event', () => {
    const db = migratedDb();
    expect(insertEvent(db).changes).toBe(1);
  });

  it('keeps events append-only: UPDATE and DELETE are rejected', () => {
    const db = migratedDb();
    insertEvent(db);
    expect(() => db.prepare("UPDATE events SET type = 'x' WHERE id = 1").run()).toThrow(
      /append-only/,
    );
    expect(() => db.prepare('DELETE FROM events WHERE id = 1').run()).toThrow(/append-only/);
    expect(db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(1);
  });

  it('rejects an unknown origin and invalid JSON payloads', () => {
    const db = migratedDb();
    expect(() => insertEvent(db, 'magic')).toThrow(/CHECK constraint failed/);
    expect(() => insertEvent(db, 'rule', '{not json')).toThrow(/CHECK constraint failed/);
  });

  it('enforces foreign keys', () => {
    const db = migratedDb();
    expect(() =>
      db
        .prepare(
          'INSERT INTO recipe_items (menu_item_id, ingredient_id, qty_per_portion) VALUES (?, ?, ?)',
        )
        .run('ghost_menu', 'ghost_ingredient', 1),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('uses STRICT tables so a wrong type is rejected', () => {
    const db = migratedDb();
    expect(() =>
      db
        .prepare('INSERT INTO menu_items (id, name, price, cook_time_sec) VALUES (?, ?, ?, ?)')
        .run('x', 'X', 'not a number', 60),
    ).toThrow(/cannot store TEXT value in INTEGER column/);
  });

  it('starts with one sim clock row at time zero', () => {
    const db = migratedDb();
    expect(db.prepare('SELECT * FROM sim_clock').all()).toEqual([
      { id: 1, current_sim_sec: 0, speed: 60, paused: 0 },
    ]);
  });
});
