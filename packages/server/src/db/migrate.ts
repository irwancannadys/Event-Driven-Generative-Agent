import fs from 'node:fs';
import type { Db } from './database';

export interface Migration {
  name: string;
  sql: string;
}

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Reads `NNNN_name.sql` files in order. Applied migrations are never edited: add a new file instead. */
export function loadMigrations(dir: URL = new URL('./migrations/', import.meta.url)): Migration[] {
  return fs
    .readdirSync(dir)
    .filter((file) => MIGRATION_FILE.test(file))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(new URL(name, dir), 'utf8') }));
}

/** Applies pending migrations, each in its own transaction. Returns the names that ran. */
export function runMigrations(db: Db, migrations: Migration[]): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT
  `);
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').pluck().all() as string[],
  );
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(migration.name);
    })();
    ran.push(migration.name);
  }
  return ran;
}
