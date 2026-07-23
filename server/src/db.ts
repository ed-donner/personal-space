import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEMA = `
-- A page, a database, or a row. A row is just a page whose parent_id points
-- at its database page; blocks and property values attach to it the same way
-- they attach to ordinary pages.
CREATE TABLE IF NOT EXISTS pages (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT 'page' CHECK(type IN ('page','database','row')),
  position   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pages_parent_id ON pages(parent_id);
CREATE INDEX IF NOT EXISTS idx_pages_position   ON pages(position);

CREATE TABLE IF NOT EXISTS blocks (
  id        TEXT PRIMARY KEY,
  page_id   TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  type      TEXT NOT NULL CHECK(type IN (
              'paragraph','heading1','heading2','heading3',
              'bulleted','numbered','todo','quote','divider','code','callout'
            )),
  content   TEXT NOT NULL DEFAULT '',
  checked   INTEGER NOT NULL DEFAULT 0,
  position  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks_page_position ON blocks(page_id, position);

-- Key/value store for first-launch bookkeeping. The 'seeded' key marks that
-- the workspace has been initialized, so a deliberately emptied workspace is
-- not re-seeded on the next restart (see DEF-003).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Typed columns of a database page.
CREATE TABLE IF NOT EXISTS properties (
  id          TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN (
                'text','number','select','multiSelect','date','checkbox','url'
              )),
  options     TEXT NOT NULL DEFAULT '[]',
  position    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_properties_database_position
  ON properties(database_id, position);

-- A single cell: the value of one property for one row. The value column
-- is JSON-encoded per the property's type (see databases.ts).
CREATE TABLE IF NOT EXISTS row_values (
  row_id      TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  value       TEXT NOT NULL,
  PRIMARY KEY (row_id, property_id)
);
CREATE INDEX IF NOT EXISTS idx_row_values_property ON row_values(property_id);

-- Per-view settings (filters/sort/groupBy/listProps) for a database page.
-- One row per (database, view_kind). activeView is stored in the meta table
-- under key 'views:active:<databaseId>' so a single existing table is reused
-- rather than introducing a second one. Cascade-delete with the database;
-- PageRepository.remove also deletes these explicitly for portability.
CREATE TABLE IF NOT EXISTS view_settings (
  database_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  view_kind   TEXT NOT NULL CHECK(view_kind IN ('table','board','list')),
  settings    TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (database_id, view_kind)
);
`;

/**
 * Idempotently bring an existing dev database up to the Phase 3 schema.
 *
 * On a fresh database SCHEMA already creates `pages` with the CHECK that
 * allows 'row'. On a database created during Phase 1/2, however, `pages`
 * already exists with the old CHECK (only 'page','database'); SQLite cannot
 * ALTER a CHECK in place, so we recreate the table preserving all data. The
 * new properties/row_values tables are created by SCHEMA (CREATE IF NOT
 * EXISTS) and are empty on an upgraded database.
 *
 * Dev databases are disposable (e2e deletes them per run), so this migration
 * only needs to keep an old dev DB from crashing on startup -- it does not
 * re-seed Phase 3 content (delete the DB to get the new seed).
 */
function migratePagesTypeCheck(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pages'")
    .get() as { sql: string } | undefined;
  if (!row) return; // SCHEMA will create it fresh with the new CHECK.
  if (row.sql.includes("'row'")) return; // already migrated.

  // Turn off FK enforcement and use legacy ALTER semantics so the RENAME
  // does not rewrite the foreign-key references that blocks/properties/
  // row_values hold against `pages` -- we want them to keep pointing at
  // the name `pages`, which the recreated table will reclaim.
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  try {
    db.exec(`
      BEGIN;
      ALTER TABLE pages RENAME TO pages_old;
      CREATE TABLE pages (
        id         TEXT PRIMARY KEY,
        parent_id  TEXT NULL REFERENCES pages(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        icon       TEXT NOT NULL DEFAULT '',
        type       TEXT NOT NULL DEFAULT 'page' CHECK(type IN ('page','database','row')),
        position   INTEGER NOT NULL
      );
      INSERT INTO pages (id, parent_id, title, icon, type, position)
        SELECT id, parent_id, title, icon, type, position FROM pages_old;
      DROP TABLE pages_old;
      COMMIT;
    `);
  } finally {
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
  }

  // The renamed-and-dropped table took its indexes with it; recreate them.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pages_parent_id ON pages(parent_id);
    CREATE INDEX IF NOT EXISTS idx_pages_position   ON pages(position);
  `);
}

/**
 * Open (or create) a SQLite database at `path` and ensure the schema is in
 * place. Pass ":memory:" for an ephemeral in-memory database (used in tests).
 */
export function openDb(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  // Recursive cascade deletes are handled explicitly in PageRepository so the
  // behavior is portable and testable; foreign keys are still enforced as a
  // belt-and-braces measure.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migratePagesTypeCheck(db);
  return db;
}
