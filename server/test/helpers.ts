import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import { createDb, type DB } from '../db';
import { seedIfEmpty } from '../seed';
import { createApp } from '../app';

export interface TestSetup {
  db: DB;
  app: Express;
  cleanup: () => void;
}

/**
 * Creates an isolated temp-file SQLite database and an Express app bound to it.
 * By default seeds the initial workspace; pass `{ seed: false }` for a clean DB.
 */
export function setup(opts?: { seed?: boolean }): TestSetup {
  const dir = mkdtempSync(join(tmpdir(), 'ps-test-'));
  const dbPath = join(dir, 'test.db');
  const db = createDb(dbPath);
  if (opts?.seed !== false) {
    seedIfEmpty(db);
  }
  const app = createApp(db);
  return {
    db,
    app,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
