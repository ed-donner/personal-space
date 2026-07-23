import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const DB_PATH = join(
  __dirname,
  "..",
  "server",
  "data",
  "personal-space.db"
);

/**
 * Global setup: delete the SQLite database so each run starts fresh from the
 * seed. The server re-seeds automatically when the DB is empty.
 */
export default function globalSetup() {
  if (existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log(`Deleted database at ${DB_PATH}`);
  } else {
    console.log(`No database to delete at ${DB_PATH}`);
  }
}
