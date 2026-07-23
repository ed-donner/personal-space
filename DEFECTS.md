# Defects

## DEF-014: Deleted select option orphans board cards in a header-less limbo

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-029)
- Phase: 4

Steps to reproduce:
1. Start the app with a fresh seeded DB and open http://localhost:3000.
2. Navigate to Reading List and switch to Board view (grouped by Status).
3. Confirm columns: "Want to read", "Reading", "Finished" with cards in each.
4. Delete the "Reading" option via PATCH /api/properties/reading-prop-status with only "Want to read" and "Finished" options.
5. Refresh the board view in the browser.

Expected: Rows that had Status=Reading appear in a labeled "No value" column with a clear header indicating they have no status.
Actual: The two affected rows (Designing Data-Intensive Applications, The Name of the Wind) appear at the bottom of the board with no visible column header. Their cards show other property details (e.g., "Tech 8 Jan 2024") but no status label or indication of their state. They are in an unnamed, invisible column.

Screenshot: screenshots/def-014-orphaned-board-cards.png

History:
- adversary: reported (ADV-029)
- qa: reproduced and filed
- frontend-dev: FIX READY - "groupRows already buckets null group-by values into a __none__ column and BoardView already renders it labeled 'No value' and accepts null drops; the defect is pinned by 2 new unit tests (labeled column with card renders when a row is null; hidden when all rows have values); live: deleting the Reading option yields a labeled No value column with the two affected cards."
- qa: retested and closed - deleted Reading option via PATCH; board shows labeled "No value" column with 2 affected cards (Designing Data-Intensive Applications, The Name of the Wind); assigning both rows to Finished hides No value column; screenshot: def-014-board-after-delete.png, def-014-board-no-nulls.png; regression: 31/31 e2e, 205/205 server, 136/136 web

## DEF-013: Filter leaks between databases during client-side navigation

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-028)
- Phase: 4

Steps to reproduce:
1. Start the app with a fresh seeded DB and open http://localhost:3000.
2. Navigate to Reading List and set a table filter on Author (e.g., "Author contains test").
3. Confirm the filter chip appears in the Reading List filter bar.
4. Click on Project Tracker in the sidebar (NO page refresh).
5. Observe the filter bar on Project Tracker.

Expected: Project Tracker shows its own view settings with no filter chips. Views state is scoped per database; navigating loads the target database's own settings.
Actual: Project Tracker's filter bar shows the stale filter chip "a81a1249-163d-461c-9b6e-8620f549bfe2 contains" from Reading List, referencing a property that does not exist in Project Tracker. A full page refresh clears the stale filter.

Screenshot: screenshots/def-013-filter-leak-project-tracker.png

History:
- adversary: reported (ADV-028)
- qa: reproduced and filed
- frontend-dev: FIX READY - "databaseStore.load resets views state on database switch; loadViews guards by databaseId so stale responses are ignored; FilterBar drops chips whose property is missing instead of rendering raw UUIDs; 4 new unit tests; live: Project Tracker shows only its own filter state after navigating from a filtered Reading List."
- qa: retested and closed - set "Author contains test" filter on Reading List via API; navigated to Project Tracker (SPA) - filter bar shows only its own controls (Filter, Sort: Priority, Group by: Status), no Reading List chips; navigated back to Reading List - both filter chips return; screenshots: def-013-retest-reading-list.png, def-013-retest-project-tracker.png; regression: 31/31 e2e, 205/205 server, 136/136 web

## DEF-012: Stale view-settings references persist after property deletion (filters, sort, listProps)

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-023 + ADV-024 + ADV-025)
- Phase: 4

Steps to reproduce:
1. Start the app with a fresh seeded DB and open http://localhost:3000.
2. Create a text property on Reading List via POST /api/databases/reading-list/properties.
3. Set a table filter referencing that property via PUT /api/databases/reading-list/views.
4. Delete the property via DELETE /api/properties/:id.
5. Navigate to Reading List table view in the browser.
6. Also verify via GET /api/databases/reading-list/views that sort and listProps references to deleted properties persist.

Expected: Deleting a property scrubs it from that database's view settings (filters removed, sort cleared, groupBy cleared, listProps pruned) so no raw UUIDs or dead references ever surface.
Actual: The filter chip in the UI shows the raw UUID string (e.g., "a81a1249-163d-461c-9b6e-8620f549bfe2 contains"). The GET /api/databases/reading-list/views response still returns the stale filter, sort, and listProps references to the deleted property. No cleanup occurs on either server or client side.

Screenshot: screenshots/def-012-stale-filter-uuid.png

History:
- adversary: reported (ADV-023 + ADV-024 + ADV-025)
- qa: reproduced and filed
- backend-dev: FIX READY - "removeProperty now scrubs the deleted property from every stored view_settings row of its database in the same transaction (filters dropped, sort/groupBy cleared, listProps pruned) via scrubPropertyFromSettings; 4 new tests; curl: after deleting a filtered-on property, GET views returns empty filters; deleting seeded reading-prop-status cleared sort/groupBy and pruned listProps."
- qa: retested and closed - created text property, added filter+listProps referencing it, deleted property: GET views shows filters=[], listProps pruned; deleted reading-prop-status: sort=null, groupBy=null, listProps pruned; Project Tracker views untouched; UI shows no raw UUID chips (proper labels only); screenshots: def-012-retest-ui-no-uuid.png; regression: 31/31 e2e, 205/205 server, 136/136 web

## DEF-011: Phase 4 seeded filter breaks existing database.spec.ts "Rows add and delete" test

- Status: REJECTED
- Severity: MEDIUM
- Found by: qa
- Phase: 4

Steps to reproduce:
1. Start the app with a fresh seeded DB and run the full e2e suite.
2. The database.spec.ts "Rows add and delete" test (test #15) navigates to Reading List table.
3. The test tries to find and delete reading-row-7 (Clean Code) by hovering over the row.
4. The test expects reading-row-7 to be visible in the table.

Expected: reading-row-7 (Clean Code) should be visible in the Reading List table so the test can hover and delete it.
Actual: reading-row-7 has Status='Want to read', which is filtered out by the Phase 4 seeded filter (Status is-not 'Want to read'). The row is hidden in the table. The test fails with "element(s) not found" when trying to assert visibility of `tr[data-row-id="reading-row-7"]`. Because the test fails mid-way, the row it added earlier is not cleaned up, causing a cascading row count mismatch in later tests.

History:
- qa: opened
- orchestrator: REJECTED - not a product defect. The seeded Reading List filter is required behavior (REQUIREMENTS Phase 5: the seed must demonstrate at least one filtered view), and the filter is discoverable via the visible chip and the "N rows of M" summary. The failing e2e test held an outdated assumption (that a specific row is always visible); the fix belongs in the test, which qa will update. No product change.

## DEF-010: Regular page created as child of database (inconsistent state)

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-021)
- Phase: 3

Steps to reproduce:
1. Start the app with a fresh seeded DB and open http://localhost:3000.
2. Verify "Project Tracker" database is visible in the sidebar under "Projects".
3. Run: `POST /api/pages {"title":"Orphan page under DB","parentId":"project-tracker","type":"page"}`.
4. Observe the response status and body.
5. Run: `GET /api/databases/project-tracker` and check the rows list.
6. Run: `GET /api/pages` and find the newly created page.

Expected: The API returns 400 with an error explaining that database children must be rows. No regular page should be created as a child of a database. The sidebar "+" button on a database should create a row via the rows API instead.
Actual: The API returns 400 {"error":"database children must be rows"}. The sidebar "+" on a database creates a row that appears in the TABLE. Row count went from 8 to 9 after creating via rows API.

Reproduction output:
```
POST /api/pages {"title":"Orphan","parentId":"project-tracker","type":"page"} -> HTTP 400 {"error":"database children must be rows"}
POST /api/databases/project-tracker/rows {"title":"Test Row"} -> HTTP 201
GET /api/databases/project-tracker -> 9 rows
```

History:
- adversary: reported (ADV-021)
- qa: reproduced and filed
- backend-dev: FIX READY - "POST /api/pages with a database parent and type != row -> 400 database children must be rows; reparenting any non-row page under a database -> same 400; rows API unaffected; 7 new tests; curl verified." | frontend-dev: FIX READY - "Sidebar + on a database now creates a row via POST /api/databases/:id/rows and opens it; regular pages keep child-page creation; 2 new tests incl. regression guard."
- qa: retested and closed - POST page under DB returns 400; sidebar + on Reading List created row visible in TABLE; screenshot: def-010-ui-table-with-new-row.png; regression: 24/24 e2e, 164/164 server, 77/77 web

## DEF-009: Row can be reparented to root, detaching it from its database

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-019)
- Phase: 3

Steps to reproduce:
1. Start the app with a fresh seeded DB.
2. Verify reading-row-1 ("The Pragmatic Programmer") is a row under "Reading List": `GET /api/rows/reading-row-1` should show `databaseId: "reading-list"`.
3. Run: `PATCH /api/pages/reading-row-1 {"parentId":null}`.
4. Observe the response: the row is moved to root level with `parentId: null`.
5. Run: `GET /api/rows/reading-row-1` to confirm `databaseId` is cleared.
6. Try to edit the row's values: `PATCH /api/rows/reading-row-1 {"values":{"reading-prop-author":"Test"}}`.

Expected: The API rejects the `parentId` change on type "row" pages with a 400 error. Rows should only move within their own database; reparenting to root (or to a different database) must not be allowed.
Actual: PATCH parentId:null returns 400 "rows cannot be reparented". PATCH to another database returns 400 "rows cannot be reparented". PATCH title on row works (200).

Reproduction output:
```
PATCH /api/pages/reading-row-1 {"parentId":null} -> HTTP 400 {"error":"rows cannot be reparented"}
PATCH /api/pages/reading-row-1 {"parentId":"project-tracker"} -> HTTP 400 {"error":"rows cannot be reparented"}
PATCH /api/pages/reading-row-1 {"title":"..."} -> HTTP 200
```

History:
- adversary: reported (ADV-019)
- qa: reproduced and filed
- backend-dev: FIX READY - "PageRepository.update rejects parentId changes on type row with 400 rows cannot be reparented (null and another database both blocked); title/icon patches on rows unaffected; 4 new tests; curl verified."
- qa: retested and closed - PATCH parentId:null and to another DB both 400 "rows cannot be reparented"; PATCH title 200; regression: 24/24 e2e, 164/164 server, 77/77 web

## DEF-008: Row title validation errors return 500 "internal error" instead of 400

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-018)
- Phase: 3

Steps to reproduce:
1. Start the app with a fresh seeded DB.
2. Create a row with an empty title: `POST /api/databases/reading-list/rows {"title":""}`.
3. Create a row with a 500-character title: `POST /api/databases/reading-list/rows {"title":"AAAA...500 chars..."}`.
4. Rename an existing row to an empty title: `PATCH /api/rows/reading-row-1 {"title":""}`.

Expected: All three requests return HTTP 400 with a clear validation message such as `{"error":"title must not be empty"}` or `{"error":"title must be at most 200 characters"}`, consistent with page title validation (DEF-001/DEF-002 fixes).
Actual: Empty title -> 400 "title must not be empty". 201-char title -> 400 "title must be at most 200 characters". {} -> 201 "Untitled". PATCH title "" -> 400 "title must not be empty".

Reproduction output:
```
POST /api/databases/reading-list/rows {"title":""} -> HTTP 400 {"error":"title must not be empty"}
POST /api/databases/reading-list/rows {"title":"AAA...201..."} -> HTTP 400 {"error":"title must be at most 200 characters"}
POST /api/databases/reading-list/rows {} -> HTTP 201 {"title":"Untitled"}
PATCH /api/rows/reading-row-1 {"title":""} -> HTTP 400 {"error":"title must not be empty"}
```

History:
- adversary: reported (ADV-018)
- qa: reproduced and filed
- backend-dev: FIX READY - "PageError from delegated create/update is rewrapped as DatabaseError with the same 400 status+message; empty/whitespace/201-char titles -> 400 with clear messages, no-title still defaults to Untitled; 8 new tests; curl verified."
- qa: retested and closed - all four cases return expected codes and messages; regression: 24/24 e2e, 164/164 server, 77/77 web

## DEF-007: Malformed JSON body returns HTML page with full Node stack trace

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-017)
- Phase: 3

Steps to reproduce:
1. Start the app with a fresh seeded DB.
2. Send a malformed JSON body: `PATCH /api/rows/reading-row-1 -H 'Content-Type: application/json' -d '{bad}'`.
3. Send another variant: `PATCH /api/rows/reading-row-1 -H 'Content-Type: application/json' -d '{invalid json}}}'`.
4. Examine the response content-type, body, and status code.

Expected: Returns HTTP 400 with a JSON body `{"error":"..."}` consistent with other API error responses. The error message should be generic (e.g., "Invalid JSON in request body") without exposing internals.
Actual: Both variants return HTTP 400 with Content-Type: application/json, body: {"error":"invalid JSON body"}, no stack trace.

Reproduction output:
```
PATCH /api/rows/reading-row-1 {bad} ->
  HTTP 400, Content-Type: application/json
  Body: {"error":"invalid JSON body"}

PATCH /api/rows/reading-row-1 {invalid json}}} ->
  HTTP 400, Content-Type: application/json
  Body: {"error":"invalid JSON body"}
```

History:
- adversary: reported (ADV-017)
- qa: reproduced and filed
- backend-dev: FIX READY - "Express error middleware converts body-parser SyntaxError/entity.parse.failed into 400 {invalid JSON body} as JSON with no stack trace; generic catch-all returns JSON 500; 3 new app.test.ts tests; curl verified."
- qa: retested and closed - both malformed payloads return 400 JSON {"error":"invalid JSON body"}; no HTML, no stack trace; regression: 24/24 e2e, 164/164 server, 77/77 web

## DEF-006: Sidebar "N pages" count includes hidden rows

- Status: CLOSED
- Severity: LOW
- Found by: adversary (ADV-016)
- Phase: 3

Steps to reproduce:
1. Start the app with a fresh seeded DB (28 total entries: 13 pages+databases + 15 rows).
2. Observe the sidebar header text (or call the equivalent API/count logic).
3. Count the sidebar-visible items manually: Home, Ideas, Launch Checklist, Tokyo Trip, Website Redesign, Design System, NYC Weekend, Projects, Blog Migration, Reading List, Project Tracker, Travel, Notes = 13 items.
4. Compare with the displayed count.

Expected: The sidebar count shows 13 (pages and databases only). Rows are "hidden from sidebar" per REQUIREMENTS.md and should not inflate the count.
Actual: Sidebar shows "13 pages". Total API entries: 28 (13 sidebar-visible + 15 rows).

Reproduction output:
```
GET /api/pages -> 28 total entries
  Pages+databases (type=page|database): 13
  Rows (type=row): 15
Sidebar count displayed: 13 pages
```

History:
- adversary: reported (ADV-016)
- qa: reproduced and filed
- frontend-dev: FIX READY - "Sidebar counts only type page+database (sidebarCount filter); unit test with a row fixture keeps the subtitle at 5 pages; live: sidebar reads 13 pages against a 28-entry API response."
- qa: retested and closed - sidebar displays "13 pages"; API returns 28 total; regression: 24/24 e2e, 164/164 server, 77/77 web

## DEF-005: URL property values are unvalidated — javascript: and garbage URLs stored and rendered

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-013 + ADV-020)
- Phase: 3

Steps to reproduce:
1. Start the app with a fresh seeded DB.
2. Set a `javascript:` URL: `PATCH /api/rows/reading-row-1 {"values":{"reading-prop-goodreads":"javascript:alert(1)"}}`.
3. Set a garbage string: `PATCH /api/rows/reading-row-1 {"values":{"reading-prop-goodreads":"not a valid url at all"}}`.
4. Set a valid URL (control): `PATCH /api/rows/reading-row-1 {"values":{"reading-prop-goodreads":"https://example.com"}}`.
5. Set empty string and null (both should be accepted).
6. UI: inject javascript: via sqlite3, check renders as plain text with no Open link; valid https keeps Open link.

Expected: The API accepts only `http://` or `https://` URLs (or empty/null) for URL properties. Steps 2 and 3 return 400 with a validation error. The frontend renders the "Open link" button only for http(s) values. `javascript:` URLs must never be clickable. Garbage text must not render as a link target.
Actual: javascript: -> 400 "url value must be an absolute http(s) URL"; garbage -> 400; https -> 200; empty -> 200; null -> 200. UI: javascript: injected via sqlite renders as plain text (no Open link); valid https values show Open link.

Reproduction output:
```
PATCH /api/rows/reading-row-1 {"values":{"reading-prop-goodreads":"javascript:alert(1)"}} -> HTTP 400
PATCH /api/rows/reading-row-1 {"values":{"reading-prop-goodreads":"not a valid url"}} -> HTTP 400
PATCH /api/rows/reading-row-1 {"values":{"reading-prop-goodreads":"https://example.com"}} -> HTTP 200
PATCH /api/rows/reading-row-1 {"values":{"reading-prop-goodreads":""}} -> HTTP 200
PATCH /api/rows/reading-row-1 {"values":{"reading-prop-goodreads":null}} -> HTTP 200
```

History:
- adversary: reported (ADV-013 + ADV-020)
- qa: reproduced and filed
- backend-dev: FIX READY - "url values accept only absolute http(s) URLs, empty string, or null; javascript:/relative/garbage/data:/ftp: -> 400 {url value must be an absolute http(s) URL}; 9 new tests; curl verified on fresh DB." | frontend-dev: FIX READY - "UrlCell renders Open link only for http(s) values, otherwise plain text; invalid drafts show an inline hint and commit as null; 5 new tests incl. javascript: renders no anchor."
- qa: retested and closed - API: javascript:/garbage 400, https/empty/null 200; UI: javascript: renders plain text no Open link, https renders with Open link; regression: 24/24 e2e, 164/164 server, 77/77 web

## DEF-004: Autosave race condition — edits lost on rapid reload or tab close

- Status: CLOSED
- Severity: HIGH
- Found by: adversary (ADV-008)
- Phase: 2

Steps to reproduce:
1. Start the app with `npm start` and open http://localhost:3000.
2. Create a new scratch page (click "New page").
3. Click into the editor paragraph and type a distinctive text string.
4. Within ~300 ms of typing (before the 600 ms autosave debounce fires), trigger a hard page reload (location.reload()).
5. After reload, navigate back to the scratch page and check whether the typed text is present.

Expected: The typed text should persist. The app should flush pending edits before unload via a `beforeunload` handler (using `navigator.sendBeacon`, `fetch({ keepalive: true })`, or a synchronous best-effort save).
Actual: The text is gone. The editor shows the empty placeholder "Enter text or type '/' for commands". The API confirms the blocks were never saved. The `useEffect` cleanup in `BlockEditor.tsx` calls `flush()` which is async and fire-and-forget (`void flush()`); the browser navigates away before the PUT request completes. There is no `beforeunload` handler anywhere in the codebase. Control: repeating with a 2 s wait (past the debounce window) before reload preserves the text, confirming the debounce is the root cause.

Screenshot: screenshots/def-004-fast-reload.png (text lost), screenshots/def-004-slow-reload.png (text survived — control)

History:
- adversary: reported (ADV-008)
- qa: reproduced and filed
- frontend-dev: FIX READY — "blocksStore registers beforeunload and visibilitychange listeners only while changes are pending; flush fires the PUT immediately with keepalive: true, clears pending state/timer before sending (no double-send, no stale debounce overwrite), uses revisions so older responses cannot overwrite newer edits. 4 new unit tests; 50/50 web tests green. Live: three edits reloaded 150ms after typing (inside the 600ms debounce) all survived; normal autosave and SPA page switches verified."
- qa: retested and closed — hard-reload 3x within ~300ms: all text survived (screenshots def004-retest-{1,2,3}-survived.png); latency injection (2s PUT delay + hard reload): text survived; regression: normal autosave OK, no double-save artifacts (1x each FIRST-BATCH/SECOND-BATCH), todo toggle persists; full e2e suite 17/17 green; web unit tests 50/50 green

## DEF-003: Server re-seeds after user deletes ALL pages and restarts

- Status: CLOSED
- Severity: LOW
- Found by: adversary (ADV-006)
- Phase: 1

Steps to reproduce:
1. Start the app with `npm start` and confirm seeded pages are present.
2. Delete every page via the DELETE API until the page count is 0.
3. Verify zero pages remain: `GET /api/pages` returns `{"pages":[]}`.
4. Restart the server.
5. After restart, check `GET /api/pages` again.

Expected: The workspace stays empty across restarts. Seed data runs only on first launch; a deliberately emptied workspace remains empty.
Actual: After restart, 12 seed pages reappear. The server detects an empty database and re-seeds on every startup.

History:
- adversary: reported (ADV-006)
- qa: reproduced and filed
- backend-dev: FIX READY — "Added a meta table (key/value). seedIfEmpty now seeds only when meta.seeded is absent and writes meta.seeded='1' in the seed transaction. Deleting every page then restarting leaves the workspace empty; fresh DBs still seed normally. Unit test: does not re-seed after all pages are deleted. curl: after deleting all pages and restarting, GET /api/pages -> {\"pages\":[]}; fresh DB -> 12 pages."
- qa: retested and closed — deleted all 14 pages (204s), restart returned {"pages":[]}; deleted DB, restart returned 12 seed pages; fresh seeded DB left for workspace

## DEF-002: No title length bound — 500-char title accepted and breaks sidebar layout

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-002)
- Phase: 1

Steps to reproduce:
1. Start the app and note the sidebar renders correctly.
2. Create a page with a 500-character title: `POST /api/pages {"title":"AAA...500 chars...","parentId":null}`.
3. Observe the response status code.
4. Open the sidebar in the browser and look at the new page's action buttons ("Add child page to ...", "Rename ...", "Delete ...").

Expected: The API returns 400 with a validation error, or truncates the title to a sane limit (e.g. 200 chars) before storing. The sidebar must not break.
Actual: The API returns 201 with the full 500-character title stored. In the sidebar, the action buttons expand to the full 500 characters, breaking the sidebar layout. The heading in the main area also displays the full string.

History:
- adversary: reported (ADV-002)
- qa: reproduced and filed
- backend-dev: FIX READY — "normalizeTitle enforces MAX_TITLE_LENGTH = 200 after trim on POST and PATCH; over-length -> 400 {error: title must be at most 200 characters}. Tests: rejects 201+ chars, accepts exactly 200 on POST and PATCH, bound measured after trimming. curl: 201-char title -> 400; 200-char title -> 201."
- qa: retested and closed — 201-char POST/PATCH both return 400; 200-char POST/PATCH both return 201/200; browser rename to 200-char title shows sidebar truncated with ellipsis, layout intact (screenshot: screenshots/def-002-retest-rename.png)

## DEF-001: Empty or whitespace-only page titles accepted by the API

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-001 + ADV-003)
- Phase: 1

Steps to reproduce:
1. Start the app with `npm start`.
2. Create a page with an empty title: `POST /api/pages {"title":"","parentId":null}`.
3. Create a page with a whitespace-only title: `POST /api/pages {"title":"   ","parentId":null}`.
4. Rename an existing page to an empty title: `PATCH /api/pages/home {"title":""}`.
5. Rename an existing page to a whitespace-only title: `PATCH /api/pages/home {"title":"   "}`.

Expected: All four requests return 400 with a validation error. Titles are trimmed before validation; an empty or whitespace-only title must be rejected.
Actual: All four requests succeed (201 for POST, 200 for PATCH). The pages appear in the sidebar with no visible text, making them nearly impossible to identify or click. Renaming the home page to empty/whitespace causes the breadcrumb and heading to show nothing.

History:
- adversary: reported (ADV-001 + ADV-003)
- qa: reproduced and filed
- backend-dev: FIX READY — "PageRepository.create/update now trim titles; empty after trim -> 400 {error: title must not be empty}; trimmed value stored. create({}) still defaults to 'Untitled'. 8 new unit tests covering POST/PATCH empty, whitespace, trim, and no-title-field cases. curl: all four attack cases now return 400; POST {\"title\":\"  Trimmed Me  \"} -> 201 stored as 'Trimmed Me'."
- qa: retested and closed — all four cases (POST empty, POST whitespace, PATCH empty, PATCH whitespace) return 400; POST "  Trimmed Me  " returns 201 with stored title "Trimmed Me"
