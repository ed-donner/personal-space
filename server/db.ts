import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// better-sqlite3's default export is the Database class; the namespace holds
// the instance type. `DB` is the instance type callers use.
export type DB = Database.Database;

const DEFAULT_DB_PATH = 'data/personal-space.db';

/**
 * Opens (or creates) a SQLite database and ensures the schema exists.
 *
 * Path resolution order:
 *   1. explicit `dbPath` argument (used by tests for an isolated temp file)
 *   2. `DATABASE_PATH` env var
 *   3. `data/personal-space.db` (the default, gitignored)
 */
export function createDb(dbPath?: string): DB {
  const resolved = dbPath ?? process.env.DATABASE_PATH ?? DEFAULT_DB_PATH;
  const dir = path.dirname(resolved);
  if (dir && dir !== '.' && dir !== '') {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  createTables(db);
  return db;
}

/** Creates all four tables per CONTRACT.md "Data model". Idempotent. */
export function createTables(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      parent_id TEXT NULL,
      title TEXT NOT NULL,
      icon TEXT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('page','database','row')),
      position INTEGER NOT NULL,
      "values" TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      database_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      options TEXT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS views (
      database_id TEXT NOT NULL,
      view_type TEXT NOT NULL,
      settings TEXT,
      PRIMARY KEY(database_id, view_type)
    );

    CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_page ON blocks(page_id);
    CREATE INDEX IF NOT EXISTS idx_properties_db ON properties(database_id);
  `);
}
