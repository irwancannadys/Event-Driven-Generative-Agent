import fs from 'node:fs';
import type { Db } from './database';

export interface Migration {
  name: string;
  sql: string;
}

/** A migration whose first line says `-- foreign_keys: off` runs with the foreign keys switched off. */
const FOREIGN_KEYS_OFF = /^-- foreign_keys: off\s*$/m;
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
    // A migration that builds a table again (SQLite cannot change a CHECK) has to run with foreign keys off,
    // which cannot be switched inside a transaction. It says so on a line of its own, and the keys are
    // checked before it is committed, then switched on again.
    const withoutKeys = FOREIGN_KEYS_OFF.test(migration.sql);
    if (withoutKeys) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(migration.sql);
        if (withoutKeys) {
          const broken = db.pragma('foreign_key_check') as unknown[];
          if (broken.length > 0) {
            throw new Error(`${migration.name} leaves ${broken.length} broken foreign keys`);
          }
        }
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(migration.name);
      })();
    } finally {
      if (withoutKeys) db.pragma('foreign_keys = ON');
    }
    ran.push(migration.name);
  }
  return ran;
}
