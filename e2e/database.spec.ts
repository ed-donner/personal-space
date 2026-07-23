import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for autosave debounce to flush. */
async function waitForAutosave(page: Page) {
  await page.waitForTimeout(2000);
}

/** Navigate to Reading List database in the sidebar. */
async function goToReadingList(page: Page) {
  const tree = page.getByTestId("sidebar-tree");
  await tree.locator('[data-row-id="reading-list"]').click();
  await page.waitForTimeout(1500);
  // Wait for the table to render
  await expect(page.locator(".db-table")).toBeVisible();
}

/** Add a property via the table header "+" button. */
async function addPropertyViaHeader(
  page: Page,
  name: string,
  typeLabel: string,
) {
  await page.locator(".col-add").click();
  const form = page.locator(".add-prop-form");
  await expect(form).toBeVisible();
  await form.locator("#add-prop-name").fill(name);
  await form.getByText(typeLabel, { exact: true }).click();
  // Submit by pressing Enter on the name input. The submit button is inside
  // the table whose wrapper has overflow:hidden, so clicking it can be
  // intercepted by the wrapping article. Enter on the input triggers form
  // submission natively and avoids the pointer-event interception.
  await form.locator("#add-prop-name").press("Enter");
  await expect(form).not.toBeVisible();
  // Wait for the property to appear in the header
  await expect(page.locator(".col-name", { hasText: name })).toBeVisible();
}

/** Get the nth `.cell-trigger-select` in a database row (0-indexed). */
function selectTriggerInRow(page: Page, rowId: string, nth: number) {
  return page
    .locator(`tr[data-row-id="${rowId}"]`)
    .locator(".cell-trigger-select")
    .nth(nth);
}

/** Rename the currently-active sidebar row via double-click inline rename. */
async function renameActiveRow(page: Page, newName: string) {
  const tree = page.getByTestId("sidebar-tree");
  const activeRow = tree.locator('[data-active="true"]');
  await activeRow.dblclick();
  const input = page.locator(".row-title-input");
  await expect(input).toBeVisible();
  await input.fill(newName);
  await input.press("Enter");
  await expect(input).not.toBeVisible();
}

// ---------------------------------------------------------------------------
// 1. Database creation
// ---------------------------------------------------------------------------

test.describe("Database creation", () => {
  test("sidebar New database creates a database page, shows empty state, add property and row", async ({
    page,
  }) => {
    await page.goto("/");

    const tree = page.getByTestId("sidebar-tree");

    // Click "New database" in sidebar
    await page.getByRole("button", { name: "New database" }).click();

    // A new "Untitled database" row appears in the sidebar
    const dbRow = tree
      .locator(".row-title", { hasText: "Untitled database" })
      .first();
    await expect(dbRow).toBeVisible();

    // Rename to a unique title so this database is unambiguous across tests
    const uniqueTitle = `DB-Create-${Date.now()}`;
    await renameActiveRow(page, uniqueTitle);

    // The database page shows the empty-database state
    await expect(page.locator(".db-empty")).toBeVisible();
    await expect(page.locator(".db-empty-title")).toContainText(
      "This database is empty",
    );

    // Screenshot the empty-database state
    await page.screenshot({
      path: "/workspaces/personal-space/screenshots/e2e-phase3-empty-db.png",
      fullPage: false,
    });

    // Add a property via the empty-state button (creates a "Name" text property)
    await page.locator(".db-empty-actions .btn-primary").click();

    // The table appears with the "Name" column
    await expect(page.locator(".db-table")).toBeVisible();
    await expect(
      page.locator(".col-name", { hasText: "Name" }),
    ).toBeVisible();

    // Add a second property via the header "+" button with custom name + type
    await addPropertyViaHeader(page, "Priority", "Number");

    // The new column header shows the name and type
    const priorityHeader = page.locator(".col-name", { hasText: "Priority" });
    await expect(priorityHeader).toBeVisible();
    await expect(priorityHeader).toContainText("Number");

    // Add a row
    await page.locator(".db-add-row").click();

    // A row appears in the table
    await expect(page.locator("tr.db-row")).toHaveCount(1);

    // The title cell and property cells are present
    const row = page.locator("tr.db-row").first();
    await expect(row.locator(".db-title-cell")).toBeVisible();
    await expect(row.locator(".cell-input-text")).toBeVisible(); // Name cell
    await expect(row.locator(".cell-input-number")).toBeVisible(); // Priority cell

    // Refresh and verify persistence
    await page.reload();
    await page.waitForTimeout(1000);

    // Re-navigate to the database after reload
    const treeAfterReload = page.getByTestId("sidebar-tree");
    await treeAfterReload
      .locator(".row-title", { hasText: uniqueTitle })
      .first()
      .click();
    await page.waitForTimeout(1500);

    // Table is still visible with the property and row
    await expect(page.locator(".db-table")).toBeVisible();
    await expect(
      page.locator(".col-name", { hasText: "Name" }),
    ).toBeVisible();
    await expect(
      page.locator(".col-name", { hasText: "Priority" }),
    ).toBeVisible();
    await expect(page.locator("tr.db-row")).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// 2. All seven property types editable
// ---------------------------------------------------------------------------

test.describe("All seven property types editable", () => {
  test("add one property of each type, add a row, fill each cell, reload, all values persist", async ({
    page,
  }) => {
    await page.goto("/");

    // Create a fresh database
    await page.getByRole("button", { name: "New database" }).click();
    await expect(page.locator(".db-empty")).toBeVisible();

    // Rename to a unique title so this database is unambiguous across tests
    const uniqueTitle = `DB-SevenProps-${Date.now()}`;
    await renameActiveRow(page, uniqueTitle);

    // Use the empty-state button to bootstrap with a text property
    await page.locator(".db-empty-actions .btn-primary").click();
    await expect(page.locator(".db-table")).toBeVisible();

    // Now add the remaining six property types via the header "+" button
    await addPropertyViaHeader(page, "Amount", "Number");
    await addPropertyViaHeader(page, "Category", "Select");
    await addPropertyViaHeader(page, "Tags", "Multi-select");
    await addPropertyViaHeader(page, "Due Date", "Date");
    await addPropertyViaHeader(page, "Active", "Checkbox");
    await addPropertyViaHeader(page, "Link", "URL");

    // All 7 column headers should be visible
    // Name (text from empty-state) + 6 added = 7 total
    const headers = page.locator(".db-th .col-name");
    await expect(headers).toHaveCount(7);

    // Add a row
    await page.locator(".db-add-row").click();
    await expect(page.locator("tr.db-row")).toHaveCount(1);

    const rowId = await page
      .locator("tr.db-row")
      .first()
      .getAttribute("data-row-id");
    expect(rowId).toBeTruthy();
    const rowSelector = `tr[data-row-id="${rowId}"]`;

    // -- Text cell (Name column) --
    const textInput = page.locator(`${rowSelector} .cell-input-text`);
    await textInput.click();
    // Use fill() directly -- Playwright's recommended approach for React controlled
    // inputs. The fill() method dispatches an input event that React handles
    // correctly, whereas type() dispatches individual keyboard events that may
    // not reliably update controlled input state in React 18's batched renderer.
    await textInput.fill("Hello World");
    await textInput.press("Enter");
    await page.waitForTimeout(1000);

    // -- Number cell (Amount column) --
    const numberInput = page.locator(`${rowSelector} .cell-input-number`);
    await numberInput.click();
    await numberInput.fill("42");
    await numberInput.press("Enter");
    await page.waitForTimeout(1000);

    // -- Select cell (Category column) --
    // The select dropdown is the first .cell-trigger-select in the row
    const selectTrigger = selectTriggerInRow(page, rowId!, 0);
    await selectTrigger.click();
    const selectPanel = page.locator(".select-panel");
    await expect(selectPanel).toBeVisible();
    // Type to create a new option
    await selectPanel.locator(".select-input").fill("Option A");
    await page.waitForTimeout(300);
    // Click the create button
    const createBtn = selectPanel.locator(".select-create");
    await expect(createBtn).toBeVisible();
    await createBtn.click();
    // The create flow calls onChange but not close(); dismiss manually
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(selectPanel).not.toBeVisible();
    await page.waitForTimeout(300);

    // -- Multi-select cell (Tags column) --
    // The multi-select dropdown is the second .cell-trigger-select in the row
    const multiTrigger = selectTriggerInRow(page, rowId!, 1);
    await multiTrigger.click();
    const multiPanel = page.locator(".select-panel");
    await expect(multiPanel).toBeVisible();
    // Create first option
    await multiPanel.locator(".select-input").fill("Tag 1");
    await page.waitForTimeout(300);
    const createBtn1 = multiPanel.locator(".select-create");
    await expect(createBtn1).toBeVisible();
    await createBtn1.click();
    await page.waitForTimeout(300);
    // Create second option
    await multiPanel.locator(".select-input").fill("Tag Two");
    await page.waitForTimeout(300);
    const createBtn2 = multiPanel.locator(".select-create");
    await expect(createBtn2).toBeVisible();
    await createBtn2.click();
    await page.waitForTimeout(300);
    // Close the multi-select dropdown
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // -- Date cell (Due Date column) --
    const dateDisplay = page.locator(`${rowSelector} .cell-date-display`);
    await dateDisplay.click();
    const dateInput = page.locator(`${rowSelector} .cell-input-date`);
    await expect(dateInput).toBeVisible();
    await dateInput.fill("2025-06-15");
    await dateInput.press("Enter");
    await page.waitForTimeout(1000);

    // -- Checkbox cell (Active column) --
    const checkbox = page.locator(`${rowSelector} .cell-checkbox`);
    await checkbox.click();
    await page.waitForTimeout(1000);

    // -- URL cell (Link column) --
    // Click the "+ Add link" button if present
    const urlAdd = page.locator(`${rowSelector} .cell-url-add`);
    const urlText = page.locator(`${rowSelector} .cell-url-text`);
    if (await urlAdd.isVisible()) {
      await urlAdd.click();
    } else {
      await urlText.click();
    }
    const urlInput = page.locator(`${rowSelector} .cell-input-url`);
    await expect(urlInput).toBeVisible();
    await urlInput.fill("https://example.com");
    await urlInput.press("Enter");
    await page.waitForTimeout(1000);

    // Wait for autosave to flush
    await waitForAutosave(page);

    // Reload the page
    await page.reload();
    await page.waitForTimeout(1000);

    // Re-navigate to the database
    const treeAfterReload = page.getByTestId("sidebar-tree");
    await treeAfterReload
      .locator(".row-title", { hasText: uniqueTitle })
      .first()
      .click();
    await page.waitForTimeout(1500);
    await expect(page.locator(".db-table")).toBeVisible();

    // Verify the row still exists
    await expect(page.locator("tr.db-row")).toHaveCount(1);
    const reloadedRowId = await page
      .locator("tr.db-row")
      .first()
      .getAttribute("data-row-id");
    const rr = `tr[data-row-id="${reloadedRowId}"]`;

    // -- Verify text persisted --
    const reloadedTextInput = page.locator(`${rr} .cell-input-text`);
    await expect(reloadedTextInput).toHaveValue("Hello World");

    // -- Verify number persisted --
    const reloadedNumberInput = page.locator(`${rr} .cell-input-number`);
    await expect(reloadedNumberInput).toHaveValue("42");

    // -- Verify select persisted (shows a chip with "Option A") --
    const reloadedSelectTrigger = selectTriggerInRow(page, reloadedRowId!, 0);
    await expect(reloadedSelectTrigger).toContainText("Option A");

    // -- Verify multi-select persisted (shows chips with "Tag 1" and "Tag Two") --
    const reloadedMultiTrigger = selectTriggerInRow(page, reloadedRowId!, 1);
    await expect(reloadedMultiTrigger).toContainText("Tag 1");
    await expect(reloadedMultiTrigger).toContainText("Tag Two");

    // -- Verify date persisted --
    // The date display shows formatted date text when not in edit mode
    const reloadedDateDisplay = page.locator(`${rr} .cell-date-display`);
    // After reload, the cell might show in display mode (button) or the date might
    // be shown as text. The date is stored as ISO; the display button shows it.
    // We verify by clicking into edit mode and checking the input value.
    await reloadedDateDisplay.click();
    const reloadedDateInput = page.locator(`${rr} .cell-input-date`);
    await expect(reloadedDateInput).toHaveValue("2025-06-15");
    await reloadedDateInput.blur();
    await page.waitForTimeout(200);

    // -- Verify checkbox persisted (should be checked) --
    const reloadedCheckbox = page.locator(`${rr} .cell-checkbox`);
    await expect(reloadedCheckbox).toHaveAttribute("data-checked", "true");

    // -- Verify URL persisted --
    const reloadedUrlText = page.locator(`${rr} .cell-url-text`);
    await expect(reloadedUrlText).toContainText("example.com");
  });
});

// ---------------------------------------------------------------------------
// 3. Cell edits in place
// ---------------------------------------------------------------------------

test.describe("Cell edits in place", () => {
  test("edit text and number cells on Reading List, reload, values persist, no save button", async ({
    page,
  }) => {
    await page.goto("/");
    await goToReadingList(page);

    // Screenshot the Reading List table
    await page.screenshot({
      path: "/workspaces/personal-space/screenshots/e2e-phase3-table.png",
      fullPage: false,
    });

    // Find the first row (The Pragmatic Programmer)
    const row1 = page.locator('tr[data-row-id="reading-row-1"]');
    await expect(row1).toBeVisible();

    // Edit the Author text cell
    const authorInput = row1.locator(".cell-input-text");
    await expect(authorInput).toHaveValue("Hunt & Thomas");
    await authorInput.click();
    await authorInput.fill("Hunt, Thomas & Folwer");
    await authorInput.blur();
    await page.waitForTimeout(300);

    // Edit the Rating number cell
    const ratingInput = row1.locator(".cell-input-number");
    await expect(ratingInput).toHaveValue("5");
    await ratingInput.click();
    await ratingInput.fill("4");
    await ratingInput.blur();
    await page.waitForTimeout(300);

    // Assert no save button exists anywhere
    const saveButton = page.getByRole("button", { name: /save/i });
    await expect(saveButton).toHaveCount(0);

    // Wait for autosave, then reload
    await waitForAutosave(page);
    await page.reload();
    await page.waitForTimeout(1000);

    // Re-navigate to Reading List
    await goToReadingList(page);

    // Verify the edited values persisted
    const reloadedAuthor = page
      .locator('tr[data-row-id="reading-row-1"]')
      .locator(".cell-input-text");
    await expect(reloadedAuthor).toHaveValue("Hunt, Thomas & Folwer");

    const reloadedRating = page
      .locator('tr[data-row-id="reading-row-1"]')
      .locator(".cell-input-number");
    await expect(reloadedRating).toHaveValue("4");
  });
});

// ---------------------------------------------------------------------------
// 4. Select options shared + colored
// ---------------------------------------------------------------------------

test.describe("Select options shared and colored", () => {
  test("create option on one row, verify offered on another row, pick it, reload, chip shows", async ({
    page,
  }) => {
    await page.goto("/");
    await goToReadingList(page);

    // Open the Status dropdown on the first row (The Pragmatic Programmer)
    const row1Status = selectTriggerInRow(page, "reading-row-1", 0);
    await row1Status.click();

    const panel = page.locator(".select-panel");
    await expect(panel).toBeVisible();

    // Assert existing options are shown (as colored chips in option rows)
    const optionRows = panel.locator(".select-row");
    const optionCount = await optionRows.count();
    expect(optionCount).toBeGreaterThanOrEqual(3); // Want to read, Reading, Finished

    // Verify each option has a colored chip
    for (let i = 0; i < optionCount; i++) {
      const chip = optionRows.nth(i).locator(".opt-chip");
      await expect(chip).toBeVisible();
    }

    // Create a new option "Abandoned"
    await panel.locator(".select-input").fill("Abandoned");
    await page.waitForTimeout(300);
    const createBtn = panel.locator(".select-create");
    await expect(createBtn).toBeVisible();
    await createBtn.click();
    // The create flow calls onChange directly but does not call close().
    // Close the dropdown manually by pressing Escape.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(panel).not.toBeVisible();
    await page.waitForTimeout(300);

    // Now open the Status dropdown on a different row (row 2 - DDIA)
    const row2Status = selectTriggerInRow(page, "reading-row-2", 0);
    await row2Status.click();

    const panel2 = page.locator(".select-panel");
    await expect(panel2).toBeVisible();

    // The new "Abandoned" option should be offered
    const abandonedOption = panel2
      .locator(".select-row")
      .filter({ hasText: "Abandoned" });
    await expect(abandonedOption).toBeVisible();

    // Pick it
    await abandonedOption.click();
    await expect(panel2).not.toBeVisible();
    await page.waitForTimeout(300);

    // Wait for autosave, reload
    await waitForAutosave(page);
    await page.reload();
    await page.waitForTimeout(1000);

    // Re-navigate to Reading List
    await goToReadingList(page);

    // Row 2's Status should show the "Abandoned" chip
    const row2StatusAfter = selectTriggerInRow(page, "reading-row-2", 0);
    await expect(row2StatusAfter).toContainText("Abandoned");
  });
});

// ---------------------------------------------------------------------------
// 5. Rows add/delete
// ---------------------------------------------------------------------------

test.describe("Rows add and delete", () => {
  test("add a row to Reading List, delete a different row via hover action, confirm, reload, added row present and deleted row gone", async ({
    page,
  }) => {
    await page.goto("/");
    await goToReadingList(page);

    // Record the initial row count (filtered by the seeded Status filter)
    const initialCount = await page.locator("tr.db-row").count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // The summary shows filter-aware counts ("N rows of M")
    const summary = page.locator(".db-summary");
    await expect(summary).toBeVisible();

    // Add a new row
    await page.locator(".db-add-row").click();
    await page.waitForTimeout(500);

    // A new row appears (the added row has no Status, so it passes the filter)
    const newCount = await page.locator("tr.db-row").count();
    expect(newCount).toBe(initialCount + 1);

    // The new row has the default title "Untitled" and empty property values
    const newRow = page.locator("tr.db-row").last();
    const newTitleInput = newRow.locator(".db-title-cell");
    await expect(newTitleInput).toHaveValue("Untitled");
    const newRowId = await newRow.getAttribute("data-row-id");
    expect(newRowId).toBeTruthy();

    try {
      // Pick the first visible row to delete — guaranteed to pass the seeded
      // filter (Status is-not 'Want to read'), so it is always in the DOM.
      const rowToDelete = page.locator("tr.db-row").first();
      const deletedRowId = await rowToDelete.getAttribute("data-row-id");

      // If the first row happens to be the one we just added, use the second
      // row instead so we truly delete a *different* row.
      let targetRow = rowToDelete;
      let targetId = deletedRowId;
      if (deletedRowId === newRowId) {
        targetRow = page.locator("tr.db-row").nth(1);
        targetId = await targetRow.getAttribute("data-row-id");
      }

      // Read the title for the confirmation dialog assertion
      const deletedRowTitle = await targetRow
        .locator(".db-row-title")
        .textContent();

      // Hover to reveal action buttons (they are display:none until hover)
      await targetRow.hover();
      await page.waitForTimeout(300);

      // Click the delete button (the danger one with trash icon)
      await targetRow.locator('button[aria-label="Delete row"]').click();
      await page.waitForTimeout(300);

      // Confirmation dialog appears
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(deletedRowTitle!);

      // Confirm the delete
      await dialog.getByRole("button", { name: "Delete" }).click();
      await expect(dialog).not.toBeVisible();
      await page.waitForTimeout(300);

      // The deleted row is gone
      await expect(
        page.locator(`tr[data-row-id="${targetId}"]`),
      ).not.toBeVisible();

      // The new row is still present
      await expect(
        page.locator(`tr[data-row-id="${newRowId}"]`),
      ).toBeVisible();

      // Wait for autosave, reload
      await waitForAutosave(page);
      await page.reload();
      await page.waitForTimeout(1000);

      // Re-navigate to Reading List
      await goToReadingList(page);

      // The deleted row is still gone
      await expect(
        page.locator(`tr[data-row-id="${targetId}"]`),
      ).not.toBeVisible();

      // The added row is still present with its default title
      const addedRow = page.locator(`tr[data-row-id="${newRowId}"]`);
      await expect(addedRow).toBeVisible();
      await expect(addedRow.locator(".db-title-cell")).toHaveValue("Untitled");
    } finally {
      // Best-effort cleanup: delete the row we added even if assertions failed
      try {
        await goToReadingList(page);
        const addedRow = page.locator(`tr[data-row-id="${newRowId}"]`);
        if (
          await addedRow.isVisible({ timeout: 2000 }).catch(() => false)
        ) {
          await addedRow.hover();
          await page.waitForTimeout(300);
          await addedRow
            .locator('button[aria-label="Delete row"]')
            .click();
          await page.waitForTimeout(300);
          const cleanupDialog = page.getByRole("alertdialog");
          if (
            await cleanupDialog.isVisible().catch(() => false)
          ) {
            await cleanupDialog
              .getByRole("button", { name: "Delete" })
              .click();
            await page.waitForTimeout(300);
          }
        }
      } catch {
        // Best-effort cleanup; ignore errors
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Row opens as page
// ---------------------------------------------------------------------------

test.describe("Row opens as page", () => {
  test("click row title, verify row page with properties panel and editor, edit property and editor, reload, both persist, breadcrumb returns to database", async ({
    page,
  }) => {
    await page.goto("/");
    await goToReadingList(page);

    // Click the title of a seeded row to open it as a page
    const rowLink = page
      .locator('tr[data-row-id="reading-row-5"]')
      .locator(".db-row-title");
    await rowLink.click();
    await page.waitForTimeout(1500);

    // Verify the row page is shown
    const rowPage = page.locator(".row-page");
    await expect(rowPage).toBeVisible();
    await expect(rowPage).toHaveAttribute("data-row-id", "reading-row-5");

    // Verify the title is shown
    await expect(page.locator(".db-title")).toContainText("The Name of the Wind");

    // Verify the "row" meta tag
    await expect(page.locator(".page-meta-tag")).toContainText("row");

    // Verify the breadcrumb back to the database
    const breadcrumb = page.locator(".row-breadcrumb");
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb).toContainText("Reading List");

    // Verify the properties panel
    const propsPanel = page.locator('.row-props[aria-label="Properties"]');
    await expect(propsPanel).toBeVisible();

    // Verify all 7 property names are shown
    const propNames = page.locator(".row-prop-name");
    await expect(propNames).toHaveCount(7);
    await expect(propNames.nth(0)).toContainText("Author");
    await expect(propNames.nth(1)).toContainText("Status");
    await expect(propNames.nth(2)).toContainText("Genre");
    await expect(propNames.nth(3)).toContainText("Started");
    await expect(propNames.nth(4)).toContainText("Owned");
    await expect(propNames.nth(5)).toContainText("Goodreads");
    await expect(propNames.nth(6)).toContainText("Rating");

    // Verify the block editor is below the properties panel
    const editor = page.locator(".bn-editor");
    await expect(editor).toBeVisible();

    // Screenshot the row page
    await page.screenshot({
      path: "/workspaces/personal-space/screenshots/e2e-phase3-rowpage.png",
      fullPage: false,
    });

    // --- Edit a property (Author) ---
    const authorProp = page.locator(".row-prop", { hasText: "Author" });
    const authorInput = authorProp.locator(".row-prop-value .cell-input-text");
    await authorInput.click();
    await authorInput.fill("Patrick Rothfuss (Updated)");
    await authorInput.blur();
    await page.waitForTimeout(300);

    // --- Type into the block editor ---
    await editor.click();
    await page.waitForTimeout(200);
    await page.keyboard.type("This is a note about the book.");
    await page.waitForTimeout(200);

    // Verify the text appears in the editor
    await expect(editor).toContainText("This is a note about the book.");

    // Wait for autosave, then reload
    await waitForAutosave(page);
    await page.reload();
    await page.waitForTimeout(1000);

    // Re-navigate to the row page: click Reading List in sidebar, then click the row
    const tree = page.getByTestId("sidebar-tree");
    await tree.locator('[data-row-id="reading-list"]').click();
    await page.waitForTimeout(1500);
    await expect(page.locator(".db-table")).toBeVisible();

    // Open the row again
    const rowLinkAfter = page
      .locator('tr[data-row-id="reading-row-5"]')
      .locator(".db-row-title");
    await rowLinkAfter.click();
    await page.waitForTimeout(1500);

    // Verify the row page is shown
    await expect(page.locator(".row-page")).toBeVisible();

    // Verify the edited Author property persisted
    const authorPropAfter = page.locator(".row-prop", { hasText: "Author" });
    const authorInputAfter = authorPropAfter.locator(
      ".row-prop-value .cell-input-text",
    );
    await expect(authorInputAfter).toHaveValue("Patrick Rothfuss (Updated)");

    // Verify the editor content persisted
    await expect(editor).toContainText("This is a note about the book.");

    // Navigate back to the database via breadcrumb
    await breadcrumb.click();
    await page.waitForTimeout(1500);

    // We should be back on the Reading List database
    await expect(page.locator(".db-table")).toBeVisible();
    await expect(page.locator(".db-title")).toContainText("Reading List");
  });
});

// ---------------------------------------------------------------------------
// 7. Property management
// ---------------------------------------------------------------------------

test.describe("Property management", () => {
  test("rename property via column header, reload, new name shows; delete property, confirm, reload, column gone", async ({
    page,
  }) => {
    await page.goto("/");
    await goToReadingList(page);

    // --- Rename a property ---
    // Click the "Author" column name to enter rename mode
    const authorHeader = page.locator(".col-name", { hasText: "Author" });
    await authorHeader.click();
    await page.waitForTimeout(300);

    // The rename input appears
    const renameInput = page.locator(".prop-name-input");
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue("Author");

    // Clear and type new name
    await renameInput.fill("Author Name");
    await renameInput.press("Enter");
    await page.waitForTimeout(300);

    // The new name shows in the header
    await expect(
      page.locator(".col-name", { hasText: "Author Name" }),
    ).toBeVisible();

    // Reload and verify persistence
    await waitForAutosave(page);
    await page.reload();
    await page.waitForTimeout(1000);

    await goToReadingList(page);
    await expect(
      page.locator(".col-name", { hasText: "Author Name" }),
    ).toBeVisible();

    // --- Delete a property ---
    // First add a temporary property to delete
    await addPropertyViaHeader(page, "Temp Prop", "Text");
    await expect(
      page.locator(".col-name", { hasText: "Temp Prop" }),
    ).toBeVisible();

    // Click the three-dot menu on the "Temp Prop" column
    const tempMenuBtn = page.locator(
      'button[aria-label="Temp Prop options"]',
    );
    await tempMenuBtn.click();
    await page.waitForTimeout(300);

    // Click "Delete property" in the menu
    await page.locator(".col-menu-item", { hasText: "Delete property" }).click();
    await page.waitForTimeout(300);

    // Confirmation dialog appears
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Temp Prop");

    // Confirm the delete
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(dialog).not.toBeVisible();
    await page.waitForTimeout(300);

    // The column is gone
    await expect(
      page.locator(".col-name", { hasText: "Temp Prop" }),
    ).not.toBeVisible();

    // Reload and verify the column is still gone
    await page.reload();
    await page.waitForTimeout(1000);

    await goToReadingList(page);
    await expect(
      page.locator(".col-name", { hasText: "Temp Prop" }),
    ).not.toBeVisible();

    // The "Author Name" column should still be there (from the rename)
    await expect(
      page.locator(".col-name", { hasText: "Author Name" }),
    ).toBeVisible();
  });
});
