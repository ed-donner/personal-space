# Personal Space — Technical Contract

Fixed by the orchestrator. Developers build against this; do not change it unilaterally —
raise problems with the orchestrator instead. Endpoints marked with a phase land in that
phase; the shapes are fixed now so nothing needs to be reworked later.

## Stack (fixed)

- One root npm package, TypeScript throughout. Node 24.
- Backend: Express + better-sqlite3, run with `tsx`. SQLite file at `data/personal-space.db`
  (gitignored). Seed runs automatically when the database file is fresh/empty.
- Frontend: React 18 + Vite + react-router-dom, source in `web/`, build to `web/dist`.
  The server serves `web/dist` statically and `/api/*` as JSON.
- Drag and drop: @dnd-kit. Styling: plain CSS with custom properties (no CSS framework).
- Unit tests: vitest (backend: temp-file DB; frontend: @testing-library/react + jsdom).
  `npm test` runs both suites with coverage, statements >= 80 enforced per suite.
- E2E (qa only): under `e2e/`, real browser via system Chromium at /usr/bin/chromium.
- Run command (documented in README): `npm start` after one-time `npm install`.
  `start` builds the web app and starts the server on port 3000 (override with PORT).

## Data model (SQLite)

- `pages(id TEXT PK, parent_id TEXT NULL, title TEXT, icon TEXT NULL,
  kind TEXT CHECK(kind IN ('page','database','row')), position INTEGER,
  values TEXT NULL /* JSON object for kind='row': { [propertyId]: value } */,
  created_at TEXT, updated_at TEXT)`
  Rows are pages with kind='row' whose parent is the database page. They are excluded
  from the sidebar tree.
- `blocks(id TEXT PK, page_id TEXT NOT NULL, type TEXT, content TEXT /* JSON */,
  position INTEGER, created_at TEXT, updated_at TEXT)`
- `properties(id TEXT PK, database_id TEXT, name TEXT, type TEXT,
  options TEXT NULL /* JSON: [{id,label,color}] for select/multi_select */, position INTEGER)`
- `views(database_id TEXT, view_type TEXT, settings TEXT /* JSON */,
  PRIMARY KEY(database_id, view_type))`

Page kinds: `page` (ordinary), `database`, `row` (a database row; opens as a page).

## JSON shapes

Page: `{ id, parentId, title, icon, kind, position }` (+ `values` when kind='row').
Block: `{ id, pageId, type, content, position }` — `content` is a type-specific object,
e.g. `{ text: "..." }` for text-ish blocks; to-do adds `{ checked: boolean }`.
Property: `{ id, databaseId, name, type, options: [{id,label,color}]|null, position }`.
Property types: `text | number | select | multi_select | date | checkbox | url`.
Row value encoding: text/url/date -> string or null; number -> number or null;
select -> optionId or null; multi_select -> optionId[]; checkbox -> boolean.
View settings: `{ filters: [{propertyId, op, value}], sort: {propertyId, direction}|null,
groupBy: propertyId|null }`. Filter ops: `contains` (text), `is` / `is_not` (select),
`is_checked` / `is_not_checked` (checkbox), `before` / `after` (date). The reserved
sort propertyId `'title'` sorts by the row title.

## API (all JSON; errors `{ error: string }` with a 4xx/5xx status)

Phase 1 — pages:
- `GET /api/health` -> `{ ok: true }`
- `GET /api/tree` -> `{ pages: Page[] }` flat list, kinds 'page' and 'database' only.
- `GET /api/pages/:id` -> Page
- `POST /api/pages` body `{ parentId?: string|null, title?: string, icon?: string|null,
  kind?: 'page'|'database' }` -> 201 Page. Defaults: title "Untitled", kind "page",
  appended after existing siblings. kind='database' also creates the three default
  views (table, board, list) with empty settings.
- `PATCH /api/pages/:id` body `{ title?, icon?, position? }` -> Page. Empty/whitespace
  title is a 400.
- `DELETE /api/pages/:id` -> `{ deleted: number }`. Deletes the page, every descendant
  (pages, databases, rows), and their blocks/properties/views. 404 when missing.

Phase 2 — blocks:
- `GET /api/pages/:id/blocks` -> `{ blocks: Block[] }` ordered by position.
- `POST /api/pages/:id/blocks` body `{ type, content?, position? }` -> 201 Block.
  Block types: `paragraph | h1 | h2 | h3 | bulleted | numbered | todo | quote |
  divider | code | callout`.
- `PATCH /api/blocks/:id` body `{ content?, type? }` -> Block.
- `DELETE /api/blocks/:id` -> `{ deleted: 1 }`.
- `PUT /api/pages/:id/blocks/order` body `{ ids: string[] }` -> `{ blocks: Block[] }`
  (full reorder; ids must be exactly the page's block ids).

Phase 3 — databases:
- `GET /api/databases/:id` -> `{ page, properties: Property[], rows: Page[],
  views: { table, board, list } }` (rows ordered by position).
- `POST /api/databases/:id/properties` body `{ name, type, options? }` -> 201 Property.
  Type is fixed at creation; select/multi_select start with `options: []`.
- `PATCH /api/properties/:id` body `{ name?, options? }` -> Property (rename; manage
  select options). Empty name is a 400.
- `DELETE /api/properties/:id` -> `{ deleted: 1 }`; the value key is stripped from rows.
- `POST /api/databases/:id/rows` body `{ title? }` -> 201 row Page (kind='row').
- `PATCH /api/rows/:id` body `{ title?, values? }` -> row Page (values are merged).
- `DELETE /api/rows/:id` -> `{ deleted: 1 }` (also deletes the row's blocks).

Phase 4 — views:
- `PATCH /api/databases/:id/views/:viewType` body `{ settings }` -> the updated views
  object. viewType is `table | board | list`.

Phase 5 — search:
- `GET /api/search?q=...` -> `{ results: [{ id, title, icon, kind, databaseId? }] }`
  matching page, database and row titles, case-insensitive, ordered by title.
  `databaseId` is set for rows (so the UI can offer "open in database").
  Empty/short q (< 1 char) returns `{ results: [] }`.

## Look and feel (fixed palette)

`#ecad0a` amber, `#209dd7` blue, `#753991` purple over grays; light and dark themes via
CSS custom properties and `data-theme` on `<html>`; choice persisted in localStorage.
No gradients, no purple-dominated backgrounds, no thin accent side-borders on cards.
