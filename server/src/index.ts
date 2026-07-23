import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { openDb } from "./db.js";
import { PageRepository } from "./pages.js";
import { BlockRepository } from "./blocks.js";
import { DatabaseRepository } from "./databases.js";
import { ViewRepository } from "./views.js";
import { SearchRepository } from "./search.js";
import { seedIfEmpty } from "./seed.js";
import { createApp, defaultWebDist } from "./app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT ?? 3002);
// Default DB lives under server/data/, next to the compiled dist/ output.
const DEFAULT_DB_PATH = join(__dirname, "..", "data", "personal-space.db");
const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB_PATH;

const db = openDb(DB_PATH);
seedIfEmpty(db);
const repo = new PageRepository(db);
const blockRepo = new BlockRepository(db);
const dbRepo = new DatabaseRepository(db, repo);
const viewRepo = new ViewRepository(db, dbRepo);
const searchRepo = new SearchRepository(db);

const app = createApp({
  repo,
  blockRepo,
  dbRepo,
  viewRepo,
  searchRepo,
  webDist: defaultWebDist(import.meta.url),
});

app.listen(PORT, () => {
  console.log(`Personal Space server listening on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});

export { app, db, repo };
