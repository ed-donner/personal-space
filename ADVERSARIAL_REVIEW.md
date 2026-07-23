# Adversarial Review

## ADV-001: Empty page titles allowed via API (create and rename)

- Session: phase-1 gate
- Suggested severity: HIGH

What I did:
1. Created a page with empty title via POST /api/pages: `{"title":"","parentId":null}`
2. Renamed the home page to empty title via PATCH /api/pages/home: `{"title":""}`

Expected: The API should reject empty titles and return a validation error (400).

Actual: Both requests returned success (201 and 200). The pages appear in the sidebar with only the default icon and no visible text, making them nearly impossible to identify or click. Renaming the home page to empty also caused the breadcrumb and heading to show nothing.

Note: The frontend rename UI appears to block submission of empty titles, but the backend API does not enforce this constraint. This is an inconsistency that can be exploited via direct API calls or bugs in the frontend.

Screenshot: screenshots/adv-001-empty-xss.png

Disposition: ACCEPTED -> DEF-001

## ADV-002: No bounds checking on page title length

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did:
Created a page with a 500-character title via POST /api/pages.

Expected: The API should reject or truncate unreasonably long titles (e.g., max 255 characters).

Actual: The 500-character title was accepted and stored. In the sidebar, the long title causes the action buttons ("Add child page to XXXXX...", "Rename XXXXX...", "Delete XXXXX...") to expand to the full 500 characters, which breaks the sidebar layout. The heading in the main area also displays the full 500 characters.

Screenshot: screenshots/adv-005-long-title.png

Disposition: ACCEPTED -> DEF-002

## ADV-003: Whitespace-only page titles accepted

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did:
Created a page with title consisting only of whitespace: `{"title":"   ","parentId":null}`

Expected: Whitespace-only titles should be rejected or trimmed to empty (which should also be rejected).

Actual: The page was created with title "   " (three spaces). It appears in the sidebar as "📄   " — the whitespace is preserved, leaving the page effectively unnamed and hard to identify.

Screenshot: screenshots/adv-008-special-chars.png

Disposition: ACCEPTED -> DEF-001 (same root cause: missing title validation; fix together)

## ADV-004: Arbitrary strings accepted as page icon

- Session: phase-1 gate
- Suggested severity: LOW

What I did:
Patched a page's icon to a non-emoji string: `{"icon":"this-is-not-an-emoji"}`

Expected: The API should validate that the icon is either empty or a valid emoji, rejecting arbitrary text.

Actual: The value "this-is-not-an-emoji" was accepted and stored as the page's icon. The frontend may handle this gracefully (showing a placeholder or ignoring it), but the API has no validation.

Screenshot: N/A

Disposition: REJECTED - icon is free-form text by design in this single-user local app; it is stored and rendered as safely escaped text with no security or stability impact. Emoji validation would be overengineering and could block legitimate uses (e.g. short text badges). Reachable only by abusing the API directly.

## ADV-005: PATCH silently ignores unknown fields

- Session: phase-1 gate
- Suggested severity: LOW

What I did:
Patched the home page with an invalid type field: `{"type":"not-a-real-type"}`

Expected: The API should return a validation error (400) for an unrecognized field value.

Actual: The request returned 200 OK and the `type` field was silently ignored. The `type` field remained unchanged as "page". While silent-ignore is common, it can mask client bugs where a developer mistakenly sends a typo'd field name.

Screenshot: N/A

Disposition: REJECTED - ignoring unknown fields in a PATCH is conventional REST behavior and violates no requirement; the stored data is unaffected. Strict field whitelisting adds rigidity for no user-facing benefit in a single-user app.

## ADV-006: Server re-seeds when all pages are deleted

- Session: phase-1 gate
- Suggested severity: LOW

What I did:
1. Deleted all 17 pages via the DELETE API
2. Verified workspace was empty (0 pages) in the browser
3. Restarted the server

Expected: The empty state should persist across server restart (no pages, empty workspace).

Actual: After restart, the database was re-seeded with the original 12 seed pages. This appears to be intentional — the server detects an empty database and re-seeds it. However, this means that if a user deliberately deletes all pages to start fresh and then restarts, their clean slate is lost.

Screenshot: screenshots/adv-007-empty-workspace.png

Disposition: ACCEPTED -> DEF-003

## ADV-007: Duplicate page titles allowed without warning

- Session: phase-1 gate
- Suggested severity: LOW

What I did:
Renamed the "Home" page to "Projects", creating two root-level pages both named "Projects" (one with 🏠 icon, one with 🚀 icon).

Expected: Either duplicate titles should be allowed (acceptable behavior) or the user should be warned.

Actual: Both pages coexist with the same title at the same level. Users could accidentally create confusing duplicate names. The only visual distinction is the icon.

Screenshot: N/A

Disposition: REJECTED - duplicate titles are legitimate and match Notion's behavior; REQUIREMENTS.md places no uniqueness constraint on titles. The icon plus tree position disambiguate.

## ADV-008: Autosave race condition — edits lost on rapid tab close or navigation

- Session: phase-2 gate
- Suggested severity: HIGH

What I did:
1. Restored clean blocks on the home page via PUT /api/pages/home/blocks.
2. Focused the editor and inserted text via JS into the paragraph block.
3. Triggered a hard page reload (location.reload()) within 300ms, before the 600ms autosave debounce could fire.
4. Repeated with a 300ms delay before reload, and with a 700ms delay before reload.

Expected: Pending edits should be saved before the page unloads, either via a `beforeunload` handler or by flushing the debounced save synchronously.

Actual: There is no `beforeunload` handler. Edits made within ~300ms of a hard navigation are lost. The useEffect cleanup in BlockEditor.tsx (which calls `flush()`) fires on component unmount but the async PUT may not complete before the browser navigates away. Data sent after 700ms (past the 600ms debounce window) survives, confirming the debounce is the root cause. The blocksStore exposes a `flush()` method but nothing flushes on `beforeunload`.

Screenshot: N/A (behavioural)

Disposition: ACCEPTED -> DEF-004

## ADV-009: Slash menu leaves trigger and filter characters in block content on Escape

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did:
1. Clicked into a paragraph block containing "Press slash then h then Escape".
2. Moved the cursor to the end of the text and pressed `/` to open the slash menu.
3. Pressed `h` to filter the menu, then pressed Escape to close the menu.
4. Repeated with no filter text — `/` then immediate Escape.

Expected: Cancelling the slash menu with Escape should restore the block to its content before `/` was typed. The trigger character and any filter text should not remain.

Actual: The content became "Press slash then h then Escape/h" (with filter text) or "Slash test/" (without filter text). The `/` character and any typed filter characters are left in the block content, autosaved, and persist across refresh. This means every slash-menu cancellation pollutes the document with unwanted characters.

Screenshot: screenshots/adv-slash-menu-escaped.png

Disposition: REJECTED - this matches Notion's slash-menu behavior exactly: the `/` and filter characters are real text the user typed into the block; Escape dismisses only the suggestion menu. Deleting user-typed text on Escape would be the surprising behavior.

## ADV-010: "Add block" button creates empty orphan block when cancelled with Escape

- Session: phase-2 gate
- Suggested severity: LOW

What I did:
1. Opened a page with a single block ("Single Block Test").
2. Focused the editor and clicked the "Add block" button at the bottom of the page.
3. Pressed Escape to cancel the block type selection menu.
4. Checked the database for block count and content.

Expected: Cancelling the type-selection menu should leave the document unchanged — no new block should be created.

Actual: After Escape, the page had 2 blocks: the original heading1 and a new empty paragraph at position 1 (content "", type "paragraph"). Opening the "Add block" menu apparently creates a draft block immediately, and cancelling does not remove it. This leaks empty blocks into the document every time a user opens the menu and changes their mind.

Screenshot: N/A (data verified via API)

Disposition: REJECTED - an empty trailing paragraph is normal, invisible and harmless in block editors (Notion behaves the same way); the block was legitimately added when the user clicked "Add block", and no content is lost or corrupted.

## ADV-011: Block drag handles are not keyboard-accessible

- Session: phase-2 gate
- Suggested severity: LOW

What I did:
1. Inspected the DOM for drag handles used to reorder blocks.
2. Checked the accessibility tree (snapshot) for any visible drag-related elements.
3. Attempted to trigger drag handles via keyboard focus (Tab navigation).

Expected: Drag handles should be reachable via keyboard (Tab order, or an accessible drag-and-drop API). Per REQUIREMENTS.md, the editor should be usable by keyboard alone. Block reordering should not require a mouse.

Actual: The drag handles are `<button draggable="true" aria-label="Open block menu">` elements rendered by BlockNote's sideMenu plugin. They appear only on mouse hover over a block and are never visible in the accessibility tree. They cannot be Tab-focused and have no keyboard-equivalent for reordering. A keyboard-only user cannot reorder blocks.

Screenshot: N/A (verified via DOM inspection at x≈430, y≈340 on hover)

Disposition: REJECTED - REQUIREMENTS.md mandates keyboard-only operation for the slash menu, not for drag-and-drop reordering, which is inherently a pointer interaction. Recorded as a known limitation of the BlockNote side menu; not in contracted scope.

## ADV-012: 10,000-character text cell value accepted without bounds

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: PATCHed reading-row-1's Author (text) property with a 10,000-character string (10,000 'A' characters) via `PATCH /api/rows/reading-row-1`.

Expected: The API should enforce a reasonable length limit on text property values (e.g., 500 or 2000 characters) or the frontend should truncate for display. Unbounded text can break the table layout.

Actual: The full 10,000-character string was accepted (200 OK) and stored. It renders in the table cell textbox. This could cause severe horizontal expansion of the table column, making the table unusable.

Screenshot: N/A (10,000 chars verified via API response; full string truncated in terminal output)

Disposition: REJECTED - text values are already capped at 10,000 chars by design (same cap as block content); table cells are fixed-width inputs that scroll rather than expand; no layout breakage was demonstrated.

## ADV-013: XSS payloads stored in text and URL cells without escaping or validation

- Session: phase-3 gate
- Suggested severity: HIGH

What I did:
1. PATCHed reading-row-1's Author (text) property with `<script>alert("xss")</script><img src=x onerror=alert(1)>`.
2. PATCHed reading-row-1's Goodreads (url) property with `javascript:alert("xss")`.

Expected: Either reject XSS payloads at the API boundary, or ensure the frontend safely escapes/renders them without execution risk. In particular, `javascript:` URLs should not be rendered as clickable links.

Actual: Both payloads were accepted (200 OK). The text payload appears in the table cell as an escaped textbox value (the `<script>` tags are visible as literal text, which is safe), but this relies on the textbox escaping, not explicit sanitization. The `javascript:` URL was stored in the Goodreads property and would be rendered with an "Open link" button -- clicking it could execute JavaScript in some rendering contexts, though the current implementation renders it via `window.open` or an `<a>` tag which the browser may block. The core concern is that neither the API nor the frontend validates URL safety.

Screenshot: screenshots/adv-xss-property-name.png (related -- shows XSS in property name rendering)

Disposition: ACCEPTED -> DEF-005

## ADV-014: XSS payload accepted in property name and rendered in column header

- Session: phase-3 gate
- Suggested severity: HIGH

What I did: Created a property named `<script>alert(1)</script>` via `POST /api/databases/reading-list/properties` with `{"name":"<script>alert(1)</script>","type":"text"}`.

Expected: The API should reject or sanitize HTML/script tags in property names. Property names are structural identifiers, not rich content.

Actual: 201 Created. The property appears as a fully functional column header in the table view with the literal `<script>alert(1)</script>` text. In the accessibility tree snapshot, the text renders as literal text (not executed), but this suggests the frontend is relying on React's JSX escaping rather than explicit sanitization. The danger is if any rendering path (e.g., tooltips, aria-labels, dynamic innerHTML) does not escape. The column header buttons read: `"<script>alert(1)</script> text"` and `"<script>alert(1)</script> options"` -- with the XSS payload as part of the button label.

Screenshot: screenshots/adv-xss-property-name.png

Disposition: REJECTED - the payload renders as inert literal text via React JSX escaping (the adversary verified no execution); render-time escaping is the correct defense and the app has no unsafe innerHTML path.

## ADV-015: PATCH select options performs full replacement, causing silent data loss

- Session: phase-3 gate
- Suggested severity: HIGH

What I did:
1. PATCHed the Status (select) property on the Reading List database with `{"options":[{"label":"Test","color":"blue"}]}` -- intending to add an option. The PATCH replaced the entire options array.
2. All three original seed options (Want to read, Reading, Finished) were deleted.
3. Then PATCHed with 50 numbered options, further confirming full-replacement semantics.

Expected: Either the API should offer an append/update mechanism for individual options (not full replacement of the array), or at minimum warn/reject if the replacement would orphan existing row values.

Actual: All previous options were silently deleted. Every row's Status value now shows `null` / "Empty" because the old option IDs (reading-opt-want, reading-opt-reading, reading-opt-finished) no longer exist in the property's options list. The user's data is silently corrupted with no warning. Confirmed: all 7 rows' Status values returned `None` after the replacement.

Screenshot: screenshots/adv-reading-list-corrupted.png (shows "Empty" in Status column for all rows after options were overwritten, then partially restored)

Disposition: REJECTED - full-replace-with-scrub is the documented and intended options contract; deleting an option must scrub it from rows (Notion behaves identically). The frontend always sends the complete array, so no user flow loses data silently.

## ADV-016: Sidebar "N pages" count includes rows, inflating the statistics

- Session: phase-3 gate
- Suggested severity: LOW

What I did: Observed the sidebar header. After creating test data, it showed "130 pages" when there were 11 pages + 2 databases + 117 rows (including 100 test rows). After cleanup it shows "28 pages" (11 pages + 2 databases + 15 rows).

Expected: Per REQUIREMENTS.md, rows are "hidden from sidebar." The page count should only count items visible in the sidebar tree -- pages and databases, not rows.

Actual: The count sums all entries in the pages table regardless of type. Rows are correctly excluded from the sidebar tree (they don't appear as expandable items under their database), but they inflate the page count displayed at the top of the sidebar. A user sees "28 pages" but can only find 13 items in the tree.

Screenshot: N/A (textual observation)

Disposition: ACCEPTED -> DEF-006

## ADV-017: Malformed JSON body returns HTML error page with full stack trace

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: Sent invalid JSON in request bodies:
1. `PATCH /api/rows/reading-row-1` with body `{bad}`
2. `PATCH /api/rows/reading-row-1` with body `{invalid json}}}`

Expected: Express's JSON body parser should return a JSON-formatted error response with status 400 and a sanitized error message, consistent with other API error responses.

Actual: Returns an HTML `<pre>` block containing a full Node.js SyntaxError stack trace. The stack trace includes absolute server file paths such as `/workspaces/personal-space/node_modules/body-parser/lib/types/json.js:96:19` and internal Node.js module paths. This is an information disclosure vulnerability (exposing the server's filesystem layout) and a content-type inconsistency (HTML when JSON is expected).

Screenshot: N/A (full stack trace observed in terminal; HTML response body confirmed)

Disposition: ACCEPTED -> DEF-007

## ADV-018: Empty and 500-character row titles return "internal error" instead of validation error

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did:
1. `POST /api/databases/reading-list/rows` with `{"title":""}` -- to create a row with an empty title.
2. `POST /api/databases/reading-list/rows` with a 500-character title.
3. `PATCH /api/rows/reading-row-1` with `{"title":""}` -- to rename a row to empty.

Expected: A clear 400 validation error, similar to the property name validation which returns `{"error":"name must not be empty"}` or `{"error":"name must be at most 200 characters"}`.

Actual: All three requests return `{"error":"internal error"}` (status 500). The error message gives no indication of what went wrong. The 500 status code is incorrect -- these are client input errors that should be 400. The row title length validation exists but is implemented as an uncaught/internal error rather than a proper user-facing validation message.

Note: A row created with no title field at all (`{}`) defaults to "Untitled", which is a reasonable fallback.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-008

## ADV-019: Row can be reparented to root via PATCH /api/pages, detaching it from its database

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: PATCHed a database row (`reading-row-1`) via the pages API with `{"parentId": null}`, moving it to the root level of the page tree.

Expected: Either rows should be locked to their parent database (rejecting `parentId` changes via PATCH), or the system should handle the detached state gracefully (e.g., keep the database association intact).

Actual: The row was moved to root level (200 OK, `parentId: null`). Its `databaseId` was cleared to an empty string. Subsequent PATCHes to the row's values via `PATCH /api/rows/reading-row-1` return `{"error":"row has no database"}`. The row becomes an orphan -- it has no database, its values cannot be edited, and it sits at root level without purpose. Re-setting the parentId to `"reading-list"` restores the database association, but the data loss during the orphan period is irreversible (the values API cannot be used).

Screenshot: N/A

Disposition: ACCEPTED -> DEF-009

## ADV-020: Non-URL values accepted and rendered in URL property cells

- Session: phase-3 gate
- Suggested severity: LOW

What I did:
1. PATCHed a URL property (Goodreads) with the value `"not a valid url at all"`.
2. PATCHed with an empty string (which displays as button with empty text + "Open link").

Expected: URL properties should perform at least basic URL validation (e.g., must start with `http://` or `https://`, or use `new URL()` parsing). An email address or arbitrary text should be rejected.

Actual: Both values were accepted (200 OK) and rendered in the table with an "Open link" button alongside. Clicking "Open link" with `"not a valid url at all"` as the href would navigate to that relative path on the app's origin (`http://localhost:3000/not a valid url at all`), resulting in a 404 or broken navigation.

Screenshot: N/A (observed in UI: cell showed "not a valid url at all Open link")

Disposition: ACCEPTED -> DEF-005 (merged with ADV-013: one URL-validation fix covers both)

## ADV-021: Regular page can be created as child of a database, creating an inconsistent state

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did: POSTed a new page with `{"title":"Orphan page under DB","parentId":"project-tracker","type":"page"}`.

Expected: Creating a child of a database should either: (a) be rejected with an error explaining that database children must be rows, or (b) automatically convert the child to a row.

Actual: A regular page (`type: "page"`) was created as a direct child of the Project Tracker database (201 Created). This creates an inconsistent state:
- The page appears in the sidebar nested under Project Tracker (visible in the tree).
- It does NOT appear in the database's table (it's not a row).
- It has no properties panel -- it behaves like a regular page.
- The database's `GET /api/databases/project-tracker` response shows 8 rows, none of which is this page.

The system allows two different types of children (rows and pages) under a database, which breaks the mental model that a database's children are its rows.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-010

## ADV-022: Extremely large negative number accepted in number property with no range bound

- Session: phase-3 gate
- Suggested severity: LOW

What I did: Edited the Estimate (number) property on project-row-1's row page with the value `-9999999999` (negative 10 billion). The edit was made via the row page's inline editor, and persisted.

Expected: While the API correctly rejects NaN and Infinity (`"number value must be a finite number or null"`), there is no upper/lower bound. Very large numbers like `-9999999999` could overflow the table cell layout or become unreadable.

Actual: The value was accepted and stored (200 OK) without any range validation. In the table view, the cell displays the full number `-9999999999`, which is wider than typical numbers and could cause column alignment issues. The value is technically a finite number, but the lack of any range validation means users (or scripts) could store numbers like `1e308` that would break rendering.

Screenshot: N/A

Disposition: REJECTED - finite-number validation is sufficient; fixed-width cells truncate long values; an arbitrary range limit would block legitimate numbers without a demonstrated breakage.

## ADV-023: Stale filter reference renders raw property UUID after property deletion

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did:
1. Created a temporary text property on the Reading List via POST /api/databases/reading-list/properties (`{"name":"Temp Text","type":"text"}`).
2. Set a table filter referencing it via PUT /api/databases/reading-list/views with `{"table":{"filters":[{"id":"stale-filter","propertyId":"<temp-id>","op":"contains","value":"test"}]}}`.
3. Deleted the property via DELETE /api/properties/<temp-id>.
4. Navigated to Reading List in the browser (table view).

Expected: The stale filter should either be silently dropped from the view, or display a user-friendly indicator like "(deleted property)" instead of the raw property UUID.

Actual: The filter chip in the UI shows the raw UUID string, e.g., `"09521774-9c61-4764-97de-a9d97a007809 contains"`. The raw property ID is meaningless to a user and leaks implementation details into the UI.

Screenshot: screenshots/adv-phase4-stale-filter.png

Disposition: ACCEPTED -> DEF-012

## ADV-024: Stale sort reference persists in GET response after property deletion

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did:
1. Set table sort on Rating property via PUT /api/databases/reading-list/views with `{"table":{"sort":{"propertyId":"reading-prop-rating","direction":"asc"}}}`.
2. Deleted the Rating property via DELETE /api/properties/reading-prop-rating.
3. Retrieved views via GET /api/databases/reading-list/views.

Expected: The sort reference to a deleted property should be cleared or the response should indicate the stale state. At minimum, the frontend should gracefully handle a sort against a non-existent property.

Actual: The GET response still returns `"sort":{"propertyId":"reading-prop-rating","direction":"asc"}` — a stale reference to a deleted property. The comment in views.ts acknowledges this ("stale refs are the client's cleanup problem"), but there is no client-side cleanup visible.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-012 (merged: one server-side scrub on property deletion covers filters, sort and listProps)

## ADV-025: Stale listProps reference persists after property deletion

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did:
1. Deleted the Status property from Reading List (which was referenced in list view's listProps) via DELETE /api/properties/reading-prop-status.
2. Retrieved views via GET /api/databases/reading-list/views.
3. Switched to list view in the browser.

Expected: listProps should be cleaned up when a referenced property is deleted, or the list view should gracefully skip stale property references.

Actual: The GET response returns `"listProps":["reading-prop-author","reading-prop-status"]` — the deleted property ID is still listed. In the list view, only the valid property (Author) renders; the stale Status property is silently skipped. While this is not a crash, it means the server persists invalid references with no cleanup mechanism.

Screenshot: screenshots/adv-phase4-list-deleted-prop.png

Disposition: ACCEPTED -> DEF-012 (merged: same scrub)

## ADV-026: Contradicting select filters accepted with no logical validation

- Session: phase-4 gate
- Suggested severity: LOW

What I did:
PUT `/api/databases/reading-list/views` with a table filter containing both `{"op":"is","value":"reading-opt-reading"}` and `{"op":"is-not","value":"reading-opt-reading"}` on the same select property (Status).

Expected: The server could reject this combination as a logical contradiction, or at minimum the frontend should show a warning. A user adding both by accident gets an always-empty result set with no indication of why.

Actual: Both filters were accepted and stored. In the browser, both filter chips appear ("Status is Reading" and "Status is not Reading") and the table shows zero rows (correctly). However, there is no indication that the result set is empty *because* the filters contradict — the user sees an empty table with no error.

Screenshot: screenshots/adv-phase4-contradict-filters.png

Disposition: REJECTED - AND-combined filters are the specified behavior; an empty result set is the correct outcome of contradictory filters, not an error. Notion behaves identically.

## ADV-027: Script tags in filter values accepted and rendered as literal text in filter chips

- Session: phase-4 gate
- Suggested severity: LOW

What I did:
PUT `/api/databases/reading-list/views` with a table filter containing `{"op":"contains","value":"<script>alert(1)</script>"}` on a text property (Author).

Expected: While React JSX escaping prevents actual script execution, the API should either reject HTML/script payloads in filter values or sanitize them. Displaying raw HTML tags in filter chips is a poor UX.

Actual: The filter chip in the UI renders as `"Author contains <script>alert(1)</script>"` — the script tags are visible as literal text in the filter button label. This is functionally safe (no XSS execution) but looks broken and unprofessional.

Screenshot: N/A

Disposition: REJECTED - React escaping renders the payload as inert literal text, which is the correct defense; showing the user their own typed input verbatim is expected behavior, and no execution path exists.

## ADV-028: Filter from one database persists and appears in another database's view context

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did:
1. Set a table filter on `reading-prop-author` on the Reading List database via PUT /api/databases/reading-list/views.
2. Navigated to Project Tracker database in the browser.
3. The Project Tracker's filter bar showed `"reading-prop-author contains"` — a filter referencing a property from a different database.

Expected: Filters should be scoped to their database. Navigating between databases should not show stale filters from previously viewed databases.

Actual: After setting a filter on Reading List's Author property and navigating to Project Tracker (without refreshing), the Project Tracker's filter region showed a chip for `reading-prop-author contains`. This property does not exist on the Project Tracker database. A full page refresh cleared the stale filter, confirming it was a frontend state-management issue during client-side navigation.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-013

## ADV-029: Deleting a select option mid-session orphans affected rows on board with no status label

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did:
1. Opened Reading List board view (grouped by Status with options: Want to read, Reading, Finished).
2. Deleted the "Reading" option via PATCH /api/properties/reading-prop-status, replacing the options array with only Want to read and Finished.
3. Refreshed the board view in the browser.

Expected: Rows that had Status=Reading should either appear in an "Empty" / "No status" column with a clear label, or the board should display an indicator that some rows have no status.

Actual: Rows formerly in the "Reading" column (Designing Data-Intensive Applications, The Name of the Wind) appeared at the bottom of the board without a visible column header. Their cards showed property details (like "Tech 8 Jan 2024") but no indication of their status state. In the table view, these rows showed "Empty" in the Status cell, which is clear — but the board view gives no such label, making it appear that cards are in an unnamed, invisible column.

Screenshot: screenshots/adv-phase4-board-deleted-option.png

Disposition: ACCEPTED -> DEF-014