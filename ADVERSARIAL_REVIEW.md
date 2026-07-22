## ADV-001: Over-length page titles silently rejected with no error feedback

- Session: phase-1 gate
- Suggested severity: LOW

What I did: Created a new page and attempted to set its title to a 500-character string
via the page header textbox. Then tried 300, 256, and 255 character titles.
Expected: Either the title is accepted and displayed, or the user receives an error
message explaining the length limit.
Actual: Titles of 255 characters or fewer are accepted. Titles exceeding 255 characters
are silently ignored — the textbox reverts to the previous value with no error, toast,
or visual indication that the input was rejected. The user has no way to know why their
title was not saved.
Screenshot: screenshots/adv-001-long-title.png

Disposition: REJECTED - qa verified titles of 255, 256, 300, 500 and 1000 characters are accepted via the header input, the sidebar rename and the API, and persist. No length limit exists in the frontend, backend or schema; the alleged silent rejection could not be reproduced.

## ADV-002: Whitespace-only titles silently rejected with no error feedback

- Session: phase-1 gate
- Suggested severity: LOW

What I did: Attempted to rename a page to a string of pure whitespace characters
(three spaces).
Expected: Either the whitespace title is accepted, or the user is shown an error
message explaining that titles cannot be blank.
Actual: The whitespace-only title was silently ignored. The textbox reverted to the
previous value with no error feedback. The same silent rejection occurred when
attempting to rename to an empty string via the sidebar rename textbox.

Disposition: REJECTED - working as intended. Blank/whitespace titles are invalid by contract (the API returns 400); reverting to the previous title is the intended cancel behavior, equivalent to pressing Escape.

## ADV-003: Delete confirmation dialog does not mention nested pages that will be cascade-deleted

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did: Selected a page with multiple nested children (e.g., "Projects" which
had 5 descendant pages including Home Renovation, Paint & Materials, Contractor
Quotes, Work, and Q3 Planning) and clicked the Delete button in the sidebar.
Expected: The confirmation dialog should warn the user that deleting the page will
also delete its nested pages. For example: "Delete Projects? This will also delete
5 nested pages."
Actual: The dialog simply shows "Delete 'Projects'?" with no mention of the nested
pages that will be cascade-deleted. A user could unknowingly delete an entire subtree.
The cascade deletion itself works correctly — the confirmation is just misleadingly
incomplete.
Screenshot: screenshots/adv-003-delete-no-cascade-warning.png

Disposition: REJECTED - factually incorrect. The confirmation dialog explicitly warns 'Everything nested inside this page is also deleted and cannot be recovered'; the warning is visible in the finding's own screenshot (screenshots/adv-003-delete-no-cascade-warning.png).

## ADV-004: Page header title rename sometimes does not persist

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did: Created a new page ("Untitled"), then immediately renamed it via the
page header textbox (the large title at the top of the page area) by filling in
a new name and pressing Enter. Checked the database for the new title.
Expected: The new title is saved to the database and survives a refresh.
Actual: On several occasions, the rename via the page header textbox did not
persist. The UI showed the new title momentarily, but the database retained
"Untitled", and after a refresh the page reverted to "Untitled". The sidebar
rename button (which opens a dedicated inline textbox) always worked correctly.
The page header rename also sometimes worked on the second attempt or when using
select-all + type + Enter instead of fill + Enter. This suggests a race condition
or unreliable change-detection in the page header textbox, especially when renaming
immediately after page creation.

Disposition: REJECTED - qa could not reproduce after 10+ timed attempts (50ms, 100ms, zero-delay): every header rename awaited the API and persisted. The e2e suite covers rename persistence across refresh.

## ADV-005: Newly-created pages intermittently fail to persist to the database

- Session: phase-1 gate
- Suggested severity: HIGH

What I did: Clicked "New page" in the sidebar to create a new root-level page. The
page appeared in the sidebar as "Untitled" and I was navigated to it. I then checked
the database for the new page record.
Expected: The page should be created in the database with a persistent record.
Actual: In several instances, the page appeared in the UI but no corresponding record
existed in the SQLite database. The page ID in the URL did not match any record. After
a browser refresh, this phantom page disappeared from the sidebar. In other instances
the creation DID persist correctly. The behavior appears intermittent — possibly a race
condition between frontend state update and backend API call, or a silent failure in
the creation API that the frontend does not handle.

Disposition: REJECTED - qa could not reproduce: rapid UI creates (50ms apart), 10 concurrent API creates, and sidebar-vs-DB count cross-checks were all consistent; no phantom pages observed. e2e covers create persistence including a full server restart.

## ADV-006: Deleted page remains viewable via direct URL until the page is navigated away

- Session: phase-1 gate
- Suggested severity: LOW

What I did: Deleted a page while viewing it, then used the browser back button to
navigate back to the deleted page's URL.
Expected: Visiting the URL of a deleted page shows a "Page not found" message.
Actual: The browser back button did navigate to the deleted page's URL, but the app
correctly displayed a "Page not found" heading with a "Back to the first page" link.
This behavior is correct. However, there is a subtle timing concern: if the user
clicks "Delete" in the confirmation dialog and then quickly presses the browser back
button before the navigation completes, they might briefly see the deleted page's
content before being redirected.

Disposition: REJECTED - the finding itself confirms the behavior is correct (deleted page URL shows "Page not found"). The residual concern (brief content flash if back is pressed mid-navigation) is speculative and below the bar.

## ADV-007: Sidebar tree structure becomes inconsistent when collapsing/expanding a parent

- Session: phase-1 gate
- Suggested severity: LOW

What I did: Clicked the expand/collapse arrow on the "Journal" page (which has child
"2026") to collapse and expand it.
Expected: Collapsing hides child pages; expanding shows them nested under the parent.
Actual: After clicking the expand arrow on a collapsed parent, the child page briefly
disappeared from the tree entirely rather than appearing nested under the parent. On
a second click, it reappeared but rendered as a separate group rather than properly
nested under the parent. The functionality (page still exists, can be navigated to)
is correct, but the visual tree structure is temporarily inconsistent.

Disposition: REJECTED - qa could not reproduce: checked the tree at 10/20/50/100/200/500ms intervals across collapse/expand with 8 screenshots; children were always correctly hidden or correctly nested. The text-snapshot observation does not match the rendered UI.

## ADV-008: Slash menu not dismissed when clicking outside the block (page title or editor background)

- Session: phase-2 gate
- Suggested severity: LOW

What I did:
1. Navigate to any page with blocks (e.g., Japan 2027).
2. Click into an empty paragraph block to focus it.
3. Press `/` — the slash menu opens with all 11 block types.
4. Click the page title textbox (the large title at the top of the page area, outside the block editor).
5. Observe: the slash menu is still open.
6. Click the editor background area (the clickable region surrounding the blocks, ref=e4).
7. Observe: the slash menu is still open.
8. Navigate to another page via sidebar — this DOES dismiss the slash menu.

Expected: Clicking anywhere outside the slash menu (page title, editor chrome) should dismiss it. The user expects a popup menu to close when focus leaves it.

Actual: The slash menu remains visible after clicking both the page title textbox and the editor background area. The only way to dismiss it is to navigate to a different page, or to type non-`/` text that stops matching.

Screenshot: screenshots/adv2-008-slash-persists.png

Disposition: ACCEPTED -> DEF-001

## ADV-009: Select option editor allows duplicate option labels

- Session: phase-3 gate
- Suggested severity: LOW

What I did:
1. Navigate to any database with a select property (e.g., Renovation Tasks > Room).
2. Click a Room cell to open the select editor.
3. Click "Create option" and enter a label identical to an existing option (e.g., "Kitchen" when "Kitchen" already exists).
4. Press Enter.

Expected: The duplicate should be rejected, or the existing option should be reused. Two "Kitchen" options in the same select property is ambiguous for users.

Actual: A second "Kitchen" option is created with a different internal ID. Both appear in the listbox and can be independently selected. The user has no way to tell them apart.

Screenshot: screenshots/adv3-009-duplicate-option.png

Disposition: ACCEPTED -> DEF-003

## ADV-010: Non-numeric input silently rejected in number cells with no error feedback

- Session: phase-3 gate
- Suggested severity: LOW

What I did:
1. Navigate to any database with a number property (e.g., Renovation Tasks > Cost estimate).
2. Click a number cell to open the inline editor.
3. Type a non-numeric value such as "not-a-number" or "1e309".
4. Press Enter.

Expected: Either the value should be accepted (and persisted as best-effort), or the user should see an error message explaining the rejection.

Actual: The value silently reverts to the previous number. No toast, error, or visual indication. The user has no idea their input was discarded.

Disposition: REJECTED - working as intended. Junk in a number cell is never saved; the cell reverts to the previous valid value (this is exactly the behavior mandated by the DEF-002 fix). Silent revert is conventional for in-place cell editing, as with ADV-002.

## ADV-011: Orphaned select value appears as "Empty" after option removed via API

- Session: phase-3 gate
- Suggested severity: MEDIUM

What I did:
1. Create a database with a select property having options "Draft" and "Ready".
2. Create a row and set its select value to "Draft".
3. Via the API: PATCH /api/properties/:id with `options` containing only "Ready" (omit "Draft").
4. Return to the table view and observe the select cell for the row.

Expected: The cell should show the orphaned value somehow — a label like "(deleted)" or the option ID, or the frontend should block the option removal if rows still reference it.

Actual: The cell displays "Empty" even though the database still stores the orphaned option ID. The user's data is silently lost from the UI. Re-opening the select picker shows only "Ready"; the previously selected value is gone with no trace.

Screenshot: screenshots/adv3-011-orphaned-select.png

Disposition: ACCEPTED -> DEF-004

## ADV-012: Renaming a property to an existing property name creates duplicate column headers

- Session: phase-3 gate
- Suggested severity: LOW

What I did:
1. Navigate to a database with two properties (e.g., Reading List, which has "Author" and "Pages").
2. Via the API: PATCH /api/properties/:id and rename "Author" to "Pages".
3. Refresh the table view.

Expected: The rename should be rejected, or the existing property should be deduplicated. Two columns both named "Pages" is confusing.

Actual: Both columns now show "Pages" as their header. Users cannot distinguish them without opening each column's context. The API accepted the rename without any uniqueness constraint.

Screenshot: screenshots/adv3-012-duplicate-columns.png

Disposition: REJECTED - working as intended. Property identity is by id, not name; duplicate names are permitted (as in Notion) and nothing references property names functionally - filters, sorts and row values all key on ids. No functional impact; not worth uniqueness validation.

## ADV-013: Filter referencing a deleted property shows "Unknown" label and becomes non-functional

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did:
1. From app launch, navigate to Renovation Tasks database (Table view).
2. Open the filter panel, add a filter on the "Notes" (text) property with `contains` operator and value `sign-off`.
3. Close the filter panel. Observe the table is filtered to 1 matching row.
4. Via the API: `DELETE /api/properties/lMMQdORcMMIyQeoXmp4CY` (the Notes property id).
5. Refresh the page in the browser and navigate back to Renovation Tasks > Table view.

Expected: The filter that referenced the deleted property should be automatically removed when the property no longer exists. At minimum, the filter should not be rendered in a broken state.

Actual: The filter still appears as "Filter 1" with the property label shown as "Unknown". The operator combobox is empty (no options in the MenuListPopup), and the filter's value textbox still shows "sign-off". The filter is effectively non-functional: all 6 rows are shown instead of the 1 matching row. The UI offers no indication that the filter is invalid — only the "Unknown" label and empty operator combobox hint at the degraded state. The filter can be manually removed via the "x" button, and doing so restores normal operation.

Screenshot: screenshots/adv4-013-deleted-property-filter.png

Disposition: ACCEPTED -> DEF-006

## ADV-014: Sort referencing a deleted property shows "Unknown" label but retains direction

- Session: phase-4 gate
- Suggested severity: MEDIUM

What I did:
1. Navigate to Renovation Tasks database, List view.
2. Via the API: `PATCH /api/databases/J2gqlD_O-A0MhwurTaghK/views/list` with `{"settings": {"sort": {"propertyId": "GKg-sODGkdYr63wITPpQU", "direction": "desc"}}}` (the Priority property id).
3. Via the API: `DELETE /api/properties/GKg-sODGkdYr63wITPpQU` (the Priority property).
4. Refresh the page in the browser and navigate to Renovation Tasks > List view.

Expected: The sort referencing the deleted property should be removed or reset to a default. The UI should not display "Unknown" as a sort label.

Actual: The sort button reads "Sort Unknown " and the sort direction shows "Desc". The rows are displayed but appear unsorted — the sort is effectively non-functional but still rendered with a "Toggle sort direction" button and "Remove sort" button. The "Unknown" label is confusing to the user, and the non-functional sort toggle is misleading. The sort can be manually removed via the "x" button and normal operation resumes.

Disposition: ACCEPTED -> DEF-007

## ADV-015: Quick-find modal backdrop blocks theme toggle button

- Session: phase-5 gate
- Suggested severity: LOW

What I did:
1. Open the app (the theme toggle is visible in the top bar).
2. Open the quick-find search dialog by pressing Ctrl+K or clicking the "Search Ctrl+K" button.
3. Attempt to click the theme toggle button while the search dialog is open.

Expected: The theme toggle button should be accessible at all times, as the requirement states: "The theme toggle switches the whole app between light and dark; the choice survives a restart; every screen is presentable in both themes." It describes "a button that is always available."

Actual: Clicking the theme toggle button fails with `Element is covered by <div.quick-find-backdrop> at its click point`. The quick-find backdrop overlays the entire application including the theme toggle in the header bar. The user must close the search dialog first before toggling the theme.

Screenshot: screenshots/adv5-backdrop-covers-theme.png

Disposition: REJECTED - working as intended. A modal backdrop intentionally blocks background controls; the theme toggle is reachable after closing the palette (Escape or click-away), which is one keystroke. Standard modal behavior.

## ADV-016: Search treats `%` and `_` as SQL LIKE wildcards, returning all results

- Session: phase-5 gate
- Suggested severity: LOW

What I did:
1. Open the quick-find search dialog (Ctrl+K or search button).
2. Type a single `%` character into the search box and wait for results.
3. Clear the input and type a single `_` character.

Expected: `%` and `_` are unlikely intentional search terms. They should either be treated as literal characters (escaping them in the backend query) so they return no results, or they should be implicitly normalized.

Actual: Searching for `%` returns every page (15+), every database (3), and every row (16+) in the workspace. Searching for `_` produces the same result: all content is returned. This happens because the backend likely passes the search term directly into a SQL `LIKE` clause without escaping the wildcard characters `%` (matches any sequence) and `_` (matches exactly one character).

Disposition: ACCEPTED -> DEF-008