# Defect Ledger

## DEF-008: Search treats % and _ as SQL LIKE wildcards, returning all results

- Status: CLOSED
- Severity: LOW
- Found by: adversary (ADV-016)
- Phase: 5

Steps to reproduce:
1. Start a fresh seeded instance (e.g. DATABASE_PATH=data/qa-adv16.db PORT=3456 npx tsx server/index.ts).
2. GET /api/search?q=%25 (URL-encoded %).
3. GET /api/search?q=_ (underscore).
4. GET /api/search?q=re (control, for comparison).
5. GET /api/search (empty query for comparison).

Expected: "%" and "_" are treated as literal characters, matching only items whose titles contain those exact characters. A search for "%" with no literal % in any seeded title should return 0 results. A search for "_" should return only items with a literal underscore in their title.

Actual: Searching for "%" returns all seeded items (the full database). Searching for "_" also returns all seeded items (any single-character-or-more title matches the LIKE "_" wildcard). The control query "re" correctly returns only 7 matching items. Empty search returns 0 results, confirming the abnormal behavior is specific to LIKE metacharacters.

History:
- qa: opened
- orchestrator: dispatched to backend-dev
- backend-dev: FIX READY — search now uses INSTR(LOWER(title), ?) > 0 instead of raw LIKE, so % and _ are literal; case-insensitive substring semantics, ordering and the 50-cap unchanged. 3 unit tests added.
- orchestrator: recorded developer report, status FIX-READY, sent to qa for retest — reproduced via API: q=%25 and q=_ both return entire database; q=re returns 7 correct matches; empty search returns [].
- qa: CLOSED — Retest passed. Exact repro: q=%25 -> [] (no seed titles contain literal %), q=_ -> [] (no seed titles contain literal _). Regression: q=re -> 7 items (pages + rows with databaseId), q=japan -> "Japan 2027", q=JAPAN -> "Japan 2027" (case-insensitive), empty q -> []. Literal findability: created page "Test 100% complete & 50%_done", q=%25 -> 1 match, q=_ -> 1 match, q=100%25 -> 1 match. Full e2e suite: 86/86 pass.

## DEF-007: Sort referencing deleted property stays in persisted settings and becomes non-functional

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-014)
- Phase: 4

Steps to reproduce:
1. Launch the app (fresh DB) and navigate to Renovation Tasks database, List view.
2. Note the list view has a default sort on Title ascending.
3. Via the API: PATCH /api/databases/:id/views/list with {"settings": {"sort": {"propertyId": "<Priority property id>", "direction": "desc"}}}.
4. Via the API: DELETE /api/properties/<Priority property id> to delete the Priority property.
5. Refresh the browser and navigate back to Renovation Tasks > List view.
6. Observe the sort chip in the toolbar.
7. Via the API: GET /api/databases/:id and inspect the list view settings.

Expected: The sort referencing the deleted property should be automatically removed or reset to a default. The UI should not display a sort referencing a non-existent property.

Actual: The persisted view settings (GET /api/databases/:id) still reference the deleted property id in the list view sort. The frontend falls back to sorting by title silently (the sort is non-functional for the intended property). The sort chip and toggle remain visible and misleading. The sort can be manually removed via the "x" button and normal operation resumes.

Screenshot: screenshots/adv014-list-sort.png

History:
- qa: opened
- orchestrator: dispatched to backend-dev
- backend-dev: FIX READY — DELETE /api/properties/:id now nulls sort and groupBy when they reference the deleted property, inside the same transaction; other properties' settings untouched. Unit tests added.
- orchestrator: recorded developer report, status FIX-READY, sent to qa for retest
- qa: CLOSED — Retest passed (3/3 tests green). TC-1: set list sort to Priority desc via API, deleted Priority property, verified sort is null in GET /api/databases/:id; UI shows no sort chip in list view. TC-2: set board groupBy to Room, deleted Room, verified groupBy is null in settings (API). TC-3 regression: set table sort to Done and list sort to Target date, created+deleted a temp property, verified both sorts survive untouched; UI sort chip shows Done. Screenshots def007-retest-sort-gone.png, def007-retest-groupby-api-nulled.png, def007-retest-other-survive.png.

## DEF-006: Filter referencing deleted property shows "Unknown" label and becomes non-functional

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-013)
- Phase: 4

Steps to reproduce:
1. Launch the app (fresh DB) and navigate to Renovation Tasks database, Table view.
2. Open the filter panel, add a filter on the "Notes" (text) property with "contains" operator and value "sign-off".
3. Close the filter panel. Observe the table is filtered to 1 matching row ("Rewire kitchen sockets").
4. Via the API: DELETE /api/properties/<Notes property id>.
5. Refresh the browser and navigate back to Renovation Tasks > Table view.

Expected: The filter that referenced the deleted property should be automatically removed when the property no longer exists. At minimum, the filter should not be rendered in a broken state.

Actual: The filter still appears as "Filter 1" with the property label shown as "Unknown" (the combobox shows no options). The filter's value textbox still shows "sign-off". The filter is non-functional: all rows are shown instead of the 1 matching row. The persisted view settings (GET /api/databases/:id) still reference the deleted property id. The filter can be manually removed via the "x" button, and doing so restores normal operation.

Screenshot: screenshots/def-006-adv013-filter-unknown.png, screenshots/def-006-adv013-repro2.png

History:
- qa: opened
- orchestrator: dispatched to backend-dev
- backend-dev: FIX READY — DELETE /api/properties/:id now removes filters referencing the deleted property from every view settings of that database, inside the same transaction.
- orchestrator: recorded developer report, status FIX-READY, sent to qa for retest
- qa: CLOSED — Retest passed (3/3 tests green). TC-1 (API): added Notes filter via PATCH, deleted Notes property, verified filter referencing Notes is gone from GET /api/databases/:id view settings; Done is_not_checked filter survives. TC-2 (UI): after delete+reload, only 1 chip renders (Done), chip text says "Done" not "Notes", row count matches unfiltered-minus-Done=true. TC-3: no console errors after property deletion+reload. Screenshots def006-retest-api-filter-gone.png, def006-retest-ui-no-broken-chip.png.

## DEF-005: Seeded filter value select renders blank (option ID vs label mismatch)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 4

Steps to reproduce:
1. Launch the app (fresh DB) and navigate to Reading List database.
2. Observe the seeded table view's filter chip row: "Status is not [blank dropdown]".
3. The filter correctly hides the Abandoned row (Sapiens), but the value control shows empty.

Expected: The filter value dropdown should display "Abandoned" to show what value is being filtered out.

Actual: The value select control is blank. The filter works (Sapiens is hidden) but the user cannot see what value is filtered. Root cause: the seed resolves filter values to option IDs (e.g. "opt-abc123") but the FilterChipValue select options use `value={o.label}` (e.g. "Abandoned"). Since the stored ID doesn't match any label, the select renders empty.

Screenshot: screenshots/e2e-phase4-seeded-filter-visual.png

History:
- qa: opened
- orchestrator: dispatched to frontend-dev
- frontend-dev: FIX READY — filter value control now uses option ids for its option values so persisted option-id filters render their label selected; changing the value PATCHes the id. Two unit tests added (both fail without the fix).
- orchestrator: recorded developer report, status FIX-READY, sent to qa for retest
- qa: CLOSED — Retest passed (4/4 tests green). TC-1: seeded filter value select now shows "Abandoned" selected. TC-2: changing value to "Reading" PATCHes the option ID (verified via GET /api/databases/:id), filter narrows correctly (Hail Mary hidden). TC-3 regression: text-contains ("weir" -> 1 row) and date (before 2026-06-01 -> rows shown) filters work alongside select filter. TC-4: filters persist after reload; value select still shows "Reading" after refresh. Screenshots def005-retest-seeded-filter.png, def005-retest-change-value.png, def005-retest-date-filter.png, def005-retest-persist.png.

## DEF-004: Orphaned select value appears as "Empty" after option removed via API

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-011)
- Phase: 3

Steps to reproduce:
1. Launch the app (http://localhost:3456).
2. Via the API: POST /api/pages with {"title":"Test DB","kind":"database"} to create a test database.
3. Via the API: POST /api/databases/:id/properties with name "Task Status", type "select", options [{"label":"Draft","color":"#8a8f98"},{"label":"Ready","color":"#3d9a50"}].
4. Via the API: POST /api/databases/:id/rows to create a row, then PATCH /api/rows/:id to set its Task Status value to the "Draft" option ID.
5. Via the API: PATCH /api/properties/:id with options containing only "Ready" (omit "Draft").
6. Navigate to the test database in the sidebar and observe the Task Status cell for the row.

Expected: The cell should show the orphaned value somehow -- a label like "(deleted)", the raw option ID, or the frontend should block the option removal if rows still reference it.

Actual: The cell displays "Empty" even though the database still stores the orphaned option ID. The user's data is silently lost from the UI. Re-opening the select picker shows only "Ready"; the previously selected value is gone with no trace.

Screenshot: screenshots/def-004-orphaned-select.png, screenshots/def-004-orphaned-dropdown.png

History:
- qa: opened
- orchestrator: dispatched to the developer
- backend-dev: FIX READY -- PATCH /api/properties/:id now strips orphaned option ids from every row of the database inside the same transaction as the options update (select key removed; multi_select filtered, key removed if empty). Unit tests cover select strip, multi_select filter, and surviving values.
- orchestrator: recorded developer report, status FIX-READY, sent to qa for retest
- qa: CLOSED -- Retest passed (2/2 tests green). Select retest: created test DB, set row to "Draft", removed "Draft" option via API PATCH, verified row's value key is stripped (not in values object), cell renders "Empty" without errors. Multi_select retest: set row to [Alpha, Beta], removed "Alpha" option, verified Alpha removed from array, Beta survives, cell shows "Beta". Regression: options NOT removed keep their row values (Beta persisted in multi_select). Screenshots def-004-retest-select.png, def-004-retest-multiselect.png.

## DEF-003: Select option editor allows duplicate option labels

- Status: CLOSED
- Severity: LOW
- Found by: adversary (ADV-009)
- Phase: 3

Steps to reproduce:
1. Launch the app (http://localhost:3456) and navigate to the Reading List database.
2. Click a Status cell (e.g., "Reading" for "Project Hail Mary") to open the select editor.
3. Click "Create option" and enter a label identical to an existing option (e.g., "Reading" when "Reading" already exists).
4. Press Enter.
5. Alternatively, via the API: PATCH /api/properties/:id with an options list containing two entries with the same label but no id (or different ids).

Expected: The duplicate should be rejected, or the existing option should be reused. Two "Reading" options in the same select property is ambiguous for users.

Actual: A second "Reading" option is created with a different internal ID. Both appear in the listbox and can be independently selected. The user has no way to tell them apart.

Screenshot: screenshots/def-003-duplicate-options.png

History:
- qa: opened
- orchestrator: dispatched to the developer
- frontend-dev: FIX READY -- create-option flow now case-insensitively matches existing option labels; a match selects/toggles the existing option and sends no property PATCH. Regression unit test added (no duplicate option created, existing option id applied to the row).
- orchestrator: recorded developer report, status FIX-READY, sent to qa for retest
- qa: CLOSED -- Retest passed (2/2 tests green). UI retest: opened Status cell, created option with label "reading" (lowercase duplicate of "Reading"), verified no new option created, Status still has exactly 4 options, no lowercase-only "reading" exists. API note: backend PATCH endpoint does not reject duplicate labels (frontend fix covers UI path only). Regression: creating genuinely new option ("Re-reading") still works and is shared across rows. Screenshots def-003-retest-ui.png, def-003-retest-api.png.

## DEF-002: Junk input in number cell causes value loss

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 3

Steps to reproduce:
1. Launch the app and navigate to Reading List database.
2. Click the Pages cell for "Project Hail Mary" (value: 476).
3. Edit the value to 500 and press Enter. Reload -- value persists as 500.
4. Click the Pages cell again to enter edit mode.
5. Clear the input and type "not-a-number" (or use JS evaluate to set a non-numeric value).
6. Press Enter or click outside the cell to trigger blur/commit.

Expected: The junk input is rejected (Number.isFinite check in commit handler). The cell reverts to displaying 500, the previous valid value. No PATCH is sent to the API.

Actual: The cell displays "Empty" instead of 500. The previous value is lost. Subsequent reload confirms the API returns null for the Pages value, indicating the value was cleared rather than preserved.

Screenshot: screenshots/e2e-phase3-table-view.png (shows "Empty" for Pages after test run)

History:
- qa: opened
- orchestrator: dispatched to frontend-dev
- frontend-dev: FIX READY -- number cell input changed from type="number" to type="text" with inputMode="decimal"; type="number" stripped junk from .value so the commit handler saw empty -> null. Now non-finite junk reverts without a PATCH, empty still clears to null, valid numbers commit. Misleading unit test that asserted the buggy path replaced with one asserting junk sends no PATCH and the old value is re-displayed.
- orchestrator: recorded developer report, status FIX-READY, sent to qa for retest
- qa: CLOSED -- Retest passed (9/9 retest + 15/15 phase3 full suite). Exact repro: junk "not-a-number" reverts via both Enter and blur, cell shows 500, reload confirms API returns 500. Regression: valid integer commits (777 persists), empty clears to null (persists), decimal 3.14 commits, negative -10 commits, number property on row-page panel behaves identically (valid/junk/empty), text cell editing unaffected. Screenshots def-002-repro-junk-enter.png and def-002-repro-junk-blur.png confirm Pages=500 after junk rejection.

## DEF-001: Slash menu not dismissed when clicking outside the block

- Status: CLOSED
- Severity: LOW
- Found by: adversary (ADV-008)
- Phase: 2

Steps to reproduce:
1. Launch the app (http://localhost:3456) and navigate to any page with blocks (e.g., Japan 2027).
2. Click into an empty paragraph block at the bottom of the page to focus it.
3. Press `/` -- the slash menu opens with all 11 block types listed.
4. Click the page title textbox (the large title "Japan 2027" at the top of the page area, outside the block editor).
5. Observe: the slash menu is still open.
6. Click the editor background area ("Focus editor" clickable region surrounding the blocks).
7. Observe: the slash menu is still open.
8. Navigate to a different page via the sidebar -- this DOES dismiss the slash menu.

Expected: Clicking anywhere outside the slash menu (page title, editor chrome) should dismiss the menu. A popup menu should close when focus leaves it.

Actual: The slash menu remains visible after clicking both the page title textbox and the editor background area. The only way to dismiss it is to navigate to a different page, type non-`/` text that stops matching, or press Escape.

Screenshot: screenshots/def-001-repro1.png, screenshots/def-001-repro2.png

History:
- qa: opened
- orchestrator: dispatched to frontend-dev
- frontend-dev: FIX READY -- added a document-level pointerdown listener, installed only while the slash menu is open, that dismisses the menu when the click target is outside the owning block's wrapper; 3 regression unit tests added (outside click, sibling block click, inside-menu click stays open)
- orchestrator: recorded developer report, status FIX-READY, sent to qa for retest
- qa: CLOSED -- retest passed (5/5 tests green): title click dismisses menu, inside-menu click stays open, Escape closes, filter+keyboard pick works, mouse pick works. Regression checks all pass.
