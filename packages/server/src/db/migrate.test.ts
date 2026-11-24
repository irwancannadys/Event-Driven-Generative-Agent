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
  'stock_policy',
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

  it('builds the reports table again in 0003, keeping its rows and what points to them', () => {
    // a world from before stage 5, with a report that a complaint and a restock order point to
    const db = openDatabase(':memory:');
    const all = loadMigrations();
    runMigrations(db, all.slice(0, 2));
    db.exec(`
      INSERT INTO orders (id, status, source, created_at_sim) VALUES (1, 'placed', 'walk_in', 100);
      INSERT INTO reports (id, type, title, body, status, subject_json, created_at_sim)
        VALUES (1, 'restock', 'Usul belanja', 'Susu', 'approved', '{}', 200),
               (2, 'complaint', 'Komplain', 'Lama', 'submitted', '{}', 300);
      INSERT INTO complaints (id, order_id, cause, status, report_id, received_at_sim)
        VALUES (1, 1, 'slow_service', 'triaged', 2, 300);
      INSERT INTO restock_orders (id, report_id, items_json, supplier, status, ordered_at_sim)
        VALUES (1, 1, '[]', 'on_time', 'ordered', 250);
    `);

    expect(runMigrations(db, all)).toEqual(['0003_policy_and_memory.sql']);

    expect(db.prepare('SELECT id, type, status FROM reports ORDER BY id').all()).toEqual([
      { id: 1, type: 'restock', status: 'approved' },
      { id: 2, type: 'complaint', status: 'submitted' },
    ]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1); // switched on again
    // the children still point at the reports, and the new kind of report is allowed
    expect(db.prepare('SELECT report_id FROM complaints').pluck().get()).toBe(2);
    expect(db.prepare('SELECT report_id FROM restock_orders').pluck().get()).toBe(1);
    db.prepare(
      "INSERT INTO reports (id, type, title, body, status, subject_json, created_at_sim) VALUES (3, 'policy', 't', 'b', 'drafted', '{}', 400)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO reports (id, type, title, body, status, subject_json, created_at_sim) VALUES (4, 'bogus', 't', 'b', 'drafted', '{}', 400)",
        )
        .run(),
    ).toThrow();
    // and a parent is still needed: the keys are checked again
    expect(() => db.prepare('UPDATE complaints SET report_id = 99 WHERE id = 1').run()).toThrow();
  });

  it('rolls back a migration that leaves a broken foreign key, and switches the keys on again', () => {
    const db = openDatabase(':memory:');
    const migrations = [
      {
        name: '0001_ok.sql',
        sql: 'CREATE TABLE p (id INTEGER PRIMARY KEY) STRICT; CREATE TABLE c (id INTEGER PRIMARY KEY, p_id INTEGER REFERENCES p (id)) STRICT;',
      },
      {
        name: '0002_bad.sql',
        sql: '-- foreign_keys: off\nINSERT INTO c (id, p_id) VALUES (1, 42);',
      },
    ];
    expect(() => runMigrations(db, migrations)).toThrow(/broken foreign keys/);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM c').pluck().get()).toBe(0);
    expect(db.prepare('SELECT name FROM schema_migrations').pluck().all()).toEqual(['0001_ok.sql']);
  });

  it('creates every table from docs/schema.md', () => {
    expect(tableNames(migratedDb())).toEqual(EXPECTED_TABLES);
  });

  it('is safe to run twice and records each migration once', () => {
    const db = openDatabase(':memory:');
    const migrations = loadMigrations();
    const all = ['0001_init.sql', '0002_order_customer.sql', '0003_policy_and_memory.sql'];
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
