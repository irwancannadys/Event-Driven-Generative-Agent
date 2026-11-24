import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/** Opens a SQLite database (`:memory:` for tests) with foreign keys enforced. */
export function openDatabase(file: string): Db {
  const inMemory = file === ':memory:';
  if (!inMemory) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  if (!inMemory) db.pragma('journal_mode = WAL');
  return db;
}
