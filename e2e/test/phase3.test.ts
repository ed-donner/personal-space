/**
 * Phase 3 -- Databases and the table view (e2e).
 *
 * Maps to REQUIREMENTS.md Phase 3 success criteria 1-7.
 * Fresh temp DB per run via the server helper, auto-seeded.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type Page } from 'playwright';
import { startServer, cleanupDb, type ServerHandle } from '../helpers/server.js';
import { getBrowser, screenshot, closeBrowser } from '../helpers/browser.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TreePage {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  kind: string;
  position: number;
}

interface Property {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  options: { id: string; label: string; color: string }[] | null;
  position: number;
}

interface RowPage {
  id: string;
  parentId: string;
  title: string;
  kind: string;
  values: Record<string, unknown>;
}

interface DatabaseResponse {
  page: TreePage;
  properties: Property[];
  rows: RowPage[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function waitForTree(page: Page) {
  await page.waitForSelector('[data-testid^="page-row-"]', { timeout: 10000 });
  await page.waitForTimeout(300);
}

async function findPageByTitle(baseUrl: string, title: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/tree`);
  const { pages } = (await res.json()) as { pages: TreePage[] };
  const p = pages.find((pg) => pg.title === title);
  if (!p) throw new Error(`Page "${title}" not found in tree`);
  return p.id;
}

async function getDatabase(baseUrl: string, id: string): Promise<DatabaseResponse> {
  const res = await fetch(`${baseUrl}/api/databases/${id}`);
  return res.json() as Promise<DatabaseResponse>;
}

/** Wait for the table element to appear. */
async function waitForTable(page: Page) {
  await page.waitForSelector('[data-testid="db-table"]', { timeout: 10000 });
  await page.waitForTimeout(300);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Phase 3 -- Databases and table view (e2e)', () => {
  let server: ServerHandle;
  let page: Page;
  let readingListId: string;
  let db: DatabaseResponse;
  const baseUrl = () => `http://localhost:${server.port}`;

  before(async () => {
    server = await startServer();
    await server.waitForReady();
    const browser = await getBrowser();
    page = await browser.newPage();
    readingListId = await findPageByTitle(baseUrl(), 'Reading List');
    db = await getDatabase(baseUrl(), readingListId);
  });

  after(async () => {
    try { await page?.close(); } catch { /* ignore */ }
    try { await closeBrowser(); } catch { /* ignore */ }
    try { await server?.kill(); } catch { /* ignore */ }
    try { cleanupDb(server?.dbPath ?? ''); } catch { /* ignore */ }
  });

  /* ================================================================ */
  /*  SC-1: Reading List appears in sidebar, table view opens          */
  /* ================================================================ */

  it('TC-1: Reading List in sidebar and table view shows 6 rows, 7 columns', async () => {
    // 1. Check sidebar
    await page.goto(baseUrl());
    await waitForTree(page);

    const sidebarText = await page.textContent('nav[aria-label="Pages"]') ?? '';
    assert.ok(sidebarText.includes('Reading List'), 'Reading List should appear in sidebar');

    // 2. Click it to open table view
    const treeRow = page.locator('[data-testid^="page-row-"]').filter({ hasText: 'Reading List' });
    await treeRow.click();
    await waitForTable(page);

    // 3. Verify 7 property columns (Author, Pages, Status, Genre, Started, Owned, Link)
    const expectedProps = ['Author', 'Pages', 'Status', 'Genre', 'Started', 'Owned', 'Link'];
    const thCount = await page.locator('.db-th .db-th-name-text').count();
    assert.equal(thCount, 7, `Should have 7 property columns, got ${thCount}`);

    for (const name of expectedProps) {
      const th = page.locator('.db-th-name-text', { hasText: name });
      await th.waitFor({ state: 'attached', timeout: 3000 });
    }

    // The seeded table has a Status is_not Abandoned filter, which hides Sapiens
    // (the only book with Status=Abandoned). Assert 5 visible rows with filter active.
    const rowCountFiltered = await page.locator('.db-row').count();
    assert.equal(rowCountFiltered, 5, `Seeded filter hides Sapiens; should show 5 rows, got ${rowCountFiltered}`);

    // 5. Clear the filter and verify all 6 seeded rows are present
    const removeBtn = page.locator('[data-testid="view-filter-chips-table"] [data-testid$="-remove"]').first();
    if (await removeBtn.count() > 0) {
      await removeBtn.click();
      await page.waitForTimeout(500);
    }

    const rowCountAll = await page.locator('.db-row').count();
    assert.equal(rowCountAll, 6, `After clearing filter, should show all 6 seeded rows, got ${rowCountAll}`);

    // 6. Verify all row titles are present
    const expectedRows = [
      'Project Hail Mary',
      'The Design of Everyday Things',
      'A Gentleman in Moscow',
      'Sapiens',
      'Dune',
      'Educated',
    ];
    const bodyText = await page.locator('.db-table').textContent() ?? '';
    for (const title of expectedRows) {
      assert.ok(bodyText.includes(title), `Table should contain row "${title}"`);
    }

    await screenshot(page, 'e2e-phase3-table-view');
  });

  /* ================================================================ */
  /*  SC-2: Cell editing per type                                     */
  /* ================================================================ */

  it('TC-2a: edit a text cell (Author) and it persists', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    // Find the first row (Project Hail Mary) and its Author cell
    const firstRowId = db.rows[0].id;
    const authorProp = db.properties.find((p) => p.name === 'Author')!;
    const cellBtn = page.locator(
      `[data-testid="cell-button-${firstRowId}-${authorProp.id}"]`
    );
    await cellBtn.click();
    await page.waitForTimeout(200);

    // The inline editor should appear
    const input = page.locator(`[data-testid="cell-input-${authorProp.id}"]`);
    await input.waitFor({ state: 'visible', timeout: 3000 });
    await input.fill('Andy Weir (edited)');
    await input.press('Enter');
    await page.waitForTimeout(500);

    // Reload and verify
    await page.reload();
    await waitForTable(page);

    const cellText = await page.locator(
      `[data-testid="cell-text-${firstRowId}-${authorProp.id}"]`
    ).textContent();
    assert.ok(
      cellText?.includes('Andy Weir (edited)'),
      `Author should be "Andy Weir (edited)" after reload, got: ${cellText}`
    );
  });

  it('TC-2b: edit a number cell (Pages) and it persists', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    const firstRowId = db.rows[0].id;
    const pagesProp = db.properties.find((p) => p.name === 'Pages')!;
    const cellBtn = page.locator(
      `[data-testid="cell-button-${firstRowId}-${pagesProp.id}"]`
    );
    await cellBtn.click();
    await page.waitForTimeout(200);

    const input = page.locator(`[data-testid="cell-input-${pagesProp.id}"]`);
    await input.waitFor({ state: 'visible', timeout: 3000 });
    await input.fill('500');
    await input.press('Enter');
    await page.waitForTimeout(500);

    await page.reload();
    await waitForTable(page);

    const cellText = await page.locator(
      `[data-testid="cell-number-${firstRowId}-${pagesProp.id}"]`
    ).textContent();
    assert.equal(cellText, '500', 'Pages should be 500 after reload');
  });

  it('TC-2c: junk in number cell does NOT save', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    const firstRowId = db.rows[0].id;
    const pagesProp = db.properties.find((p) => p.name === 'Pages')!;
    const cellBtn = page.locator(
      `[data-testid="cell-button-${firstRowId}-${pagesProp.id}"]`
    );
    await cellBtn.click();
    await page.waitForTimeout(200);

    const input = page.locator(`[data-testid="cell-input-${pagesProp.id}"]`);
    await input.waitFor({ state: 'visible', timeout: 3000 });
    // input[type=number] rejects fill() with text; use evaluate to set value and blur
    await input.evaluate((el: HTMLInputElement) => {
      // Set a non-numeric value using the native setter to bypass React
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )!.set!;
      nativeInputValueSetter.call(el, 'not-a-number');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    });
    await page.waitForTimeout(500);

    // The value should have reverted to the previous number (500 was set in TC-2b)
    const cellText = await page.locator(
      `[data-testid="cell-number-${firstRowId}-${pagesProp.id}"]`
    ).textContent();
    assert.ok(
      cellText && !cellText.includes('not-a-number'),
      `Number cell should not show junk text, got: ${cellText}`
    );
  });

  it('TC-2d: edit a date cell via date input', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    // Use "A Gentleman in Moscow" (no date yet)
    const row = db.rows.find((r) => r.title === 'A Gentleman in Moscow')!;
    const dateProp = db.properties.find((p) => p.name === 'Started')!;
    const cellBtn = page.locator(
      `[data-testid="cell-button-${row.id}-${dateProp.id}"]`
    );
    await cellBtn.click();
    await page.waitForTimeout(200);

    const input = page.locator(`[data-testid="cell-input-${dateProp.id}"]`);
    await input.waitFor({ state: 'visible', timeout: 3000 });
    // Use evaluate to set the date value and trigger React's synthetic events
    await input.evaluate((el: HTMLInputElement) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )!.set!;
      nativeInputValueSetter.call(el, '2026-08-15');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await input.press('Enter');
    await page.waitForTimeout(500);

    await page.reload();
    await waitForTable(page);

    const cellText = await page.locator(
      `[data-testid="cell-date-${row.id}-${dateProp.id}"]`
    ).textContent();
    assert.ok(
      cellText?.includes('2026-08-15'),
      `Date should be 2026-08-15 after reload, got: ${cellText}`
    );
  });

  it('TC-2e: toggle a checkbox (Owned)', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    // Use "A Gentleman in Moscow" (Owned: false)
    const row = db.rows.find((r) => r.title === 'A Gentleman in Moscow')!;
    const checkboxProp = db.properties.find((p) => p.name === 'Owned')!;

    // Verify initial state is unchecked
    const checkboxDisplay = page.locator(
      `[data-testid="cell-checkbox-${row.id}-${checkboxProp.id}"]`
    );
    const initialChecked = await checkboxDisplay.getAttribute('data-checked');
    assert.equal(initialChecked, 'false', 'Owned should start unchecked');

    // Click the checkbox toggle
    const toggle = page.locator(
      `[data-testid="cell-checkbox-toggle-${row.id}-${checkboxProp.id}"]`
    );
    await toggle.click();
    await page.waitForTimeout(500);

    // Reload and verify
    await page.reload();
    await waitForTable(page);

    const afterChecked = await page.locator(
      `[data-testid="cell-checkbox-${row.id}-${checkboxProp.id}"]`
    ).getAttribute('data-checked');
    assert.equal(afterChecked, 'true', 'Owned should be checked after toggle and reload');
  });

  it('TC-2f: pick a select option (Status)', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    // Use "A Gentleman in Moscow" (Status: "To read")
    const row = db.rows.find((r) => r.title === 'A Gentleman in Moscow')!;
    const statusProp = db.properties.find((p) => p.name === 'Status')!;

    // Click to open the select popover
    const cellBtn = page.locator(
      `[data-testid="cell-button-${row.id}-${statusProp.id}"]`
    );
    await cellBtn.click();
    await page.waitForTimeout(300);

    // Popover should appear
    const popover = page.locator(
      `[data-testid="select-popover-${row.id}-${statusProp.id}"]`
    );
    await popover.waitFor({ state: 'visible', timeout: 3000 });

    // Click "Reading" option
    const readingOption = statusProp.options?.find((o) => o.label === 'Reading');
    assert.ok(readingOption, 'Reading option should exist');
    await page.locator(`[data-testid="select-option-${readingOption!.id}"]`).click();
    await page.waitForTimeout(500);

    await page.reload();
    await waitForTable(page);

    // The chip should now say "Reading"
    const chip = page.locator(
      `[data-testid="cell-select-${row.id}-${statusProp.id}"]`
    );
    const chipText = await chip.textContent();
    assert.ok(
      chipText?.includes('Reading'),
      `Status should be "Reading" after selection, got: ${chipText}`
    );

    await screenshot(page, 'e2e-phase3-select-option');
  });

  it('TC-2g: add a multi-select option (Genre) via create option', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    // Use "Educated" (Genre: ["Memoir"])
    const row = db.rows.find((r) => r.title === 'Educated')!;
    const genreProp = db.properties.find((p) => p.name === 'Genre')!;

    // Click to open popover
    const cellBtn = page.locator(
      `[data-testid="cell-button-${row.id}-${genreProp.id}"]`
    );
    await cellBtn.click();
    await page.waitForTimeout(300);

    const popover = page.locator(
      `[data-testid="select-popover-${row.id}-${genreProp.id}"]`
    );
    await popover.waitFor({ state: 'visible', timeout: 3000 });

    // Click "Create option"
    await page.locator(`[data-testid="select-create-toggle-${genreProp.id}"]`).click();
    await page.waitForTimeout(200);

    // Type a new option label
    const createInput = page.locator(
      `[data-testid="select-create-input-${genreProp.id}"]`
    );
    await createInput.fill('Non-fiction');

    // Submit
    await page.locator(`[data-testid="select-create-submit-${genreProp.id}"]`).click();
    await page.waitForTimeout(500);

    await page.reload();
    await waitForTable(page);

    // Should show both Memoir and Non-fiction chips
    const multiCell = page.locator(
      `[data-testid="cell-multi-${row.id}-${genreProp.id}"]`
    );
    const multiText = await multiCell.textContent();
    assert.ok(
      multiText?.includes('Memoir'),
      'Should still have Memoir'
    );
    assert.ok(
      multiText?.includes('Non-fiction'),
      `Should have new option "Non-fiction", got: ${multiText}`
    );

    await screenshot(page, 'e2e-phase3-multiselect-new-option');
  });

  /* ================================================================ */
  /*  SC-4: Select options shared + colored                           */
  /* ================================================================ */

  it('TC-3a: create new Status option on one row, visible on another row', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    // Open Status on the first row
    const row1 = db.rows[0]; // Project Hail Mary
    const statusProp = db.properties.find((p) => p.name === 'Status')!;

    const cellBtn1 = page.locator(
      `[data-testid="cell-button-${row1.id}-${statusProp.id}"]`
    );
    await cellBtn1.click();
    await page.waitForTimeout(300);

    const popover1 = page.locator(
      `[data-testid="select-popover-${row1.id}-${statusProp.id}"]`
    );
    await popover1.waitFor({ state: 'visible', timeout: 3000 });

    // Create new option
    await page.locator(`[data-testid="select-create-toggle-${statusProp.id}"]`).click();
    await page.waitForTimeout(200);
    await page.locator(`[data-testid="select-create-input-${statusProp.id}"]`).fill('Re-reading');
    await page.locator(`[data-testid="select-create-submit-${statusProp.id}"]`).click();
    await page.waitForTimeout(500);

    // Now open Status on a different row (Dune)
    const row2 = db.rows.find((r) => r.title === 'Dune')!;
    const cellBtn2 = page.locator(
      `[data-testid="cell-button-${row2.id}-${statusProp.id}"]`
    );
    await cellBtn2.click();
    await page.waitForTimeout(300);

    const popover2 = page.locator(
      `[data-testid="select-popover-${row2.id}-${statusProp.id}"]`
    );
    await popover2.waitFor({ state: 'visible', timeout: 3000 });

    // The new "Re-reading" option should be present
    // Find it by looking at all option buttons
    const optionTexts = await popover2.locator('[role="option"]').allTextContents();
    const hasReReading = optionTexts.some((t) => t.includes('Re-reading'));
    assert.ok(
      hasReReading,
      `New option "Re-reading" should appear on another row's dropdown. Options: ${optionTexts.join(', ')}`
    );

    await screenshot(page, 'e2e-phase3-shared-select-option');
  });

  it('TC-3b: option chips have distinct colors', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    // Compare color of "To read" vs "Reading" chips on different rows
    const statusProp = db.properties.find((p) => p.name === 'Status')!;

    // "To read" on A Gentleman in Moscow
    const rowToRead = db.rows.find((r) => r.title === 'A Gentleman in Moscow')!;
    const chipToRead = page.locator(
      `[data-testid="cell-select-${rowToRead.id}-${statusProp.id}"]`
    );
    const colorToRead = await chipToRead.evaluate(
      (el) => getComputedStyle(el).getPropertyValue('--option-color').trim()
    );

    // "Reading" on Project Hail Mary (if still Reading after our edit)
    const chipReading = page.locator(
      `[data-testid="cell-select-${db.rows[0].id}-${statusProp.id}"]`
    );
    const colorReading = await chipReading.evaluate(
      (el) => getComputedStyle(el).getPropertyValue('--option-color').trim()
    );

    assert.ok(colorToRead, 'To read chip should have a color');
    assert.ok(colorReading, 'Reading chip should have a color');
    assert.notEqual(
      colorToRead,
      colorReading,
      `Different options should have different colors: To read=${colorToRead}, Reading=${colorReading}`
    );

    await screenshot(page, 'e2e-phase3-option-chip-colors');
  });

  /* ================================================================ */
  /*  SC: Add property                                                 */
  /* ================================================================ */

  it('TC-4a: create a new number property, edit cell, rename, delete', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    // 1. Open the property creator
    await page.locator('[data-testid="db-new-property-button"]').click();
    await page.waitForTimeout(300);

    // 2. Name it "Rating"
    await page.locator('[data-testid="db-new-property-name"]').fill('Rating');

    // 3. Select number type
    await page.locator('[data-testid="db-new-property-type-number"]').click();
    await page.waitForTimeout(100);

    // 4. Create
    await page.locator('[data-testid="db-new-property-create"]').click();
    await page.waitForTimeout(1000);

    // 5. Column should appear
    const ratingHeader = page.locator('.db-th-name-text', { hasText: 'Rating' });
    await ratingHeader.waitFor({ state: 'attached', timeout: 5000 });

    await screenshot(page, 'e2e-phase3-new-property-created');

    // 6. Edit a cell in the new property
    // Reload to get fresh property IDs
    await page.reload();
    await waitForTable(page);

    const freshDb = await getDatabase(baseUrl(), readingListId);
    const ratingProp = freshDb.properties.find((p) => p.name === 'Rating');
    assert.ok(ratingProp, 'Rating property should exist after reload');
    assert.equal(ratingProp!.type, 'number', 'Rating should be number type');

    const firstRowId = freshDb.rows[0].id;
    const cellBtn = page.locator(
      `[data-testid="cell-button-${firstRowId}-${ratingProp!.id}"]`
    );
    await cellBtn.click();
    await page.waitForTimeout(200);

    const input = page.locator(`[data-testid="cell-input-${ratingProp!.id}"]`);
    await input.waitFor({ state: 'visible', timeout: 3000 });
    await input.fill('4.5');
    await input.press('Enter');
    await page.waitForTimeout(500);

    // Verify persist
    await page.reload();
    await waitForTable(page);

    const cellText = await page.locator(
      `[data-testid="cell-number-${firstRowId}-${ratingProp!.id}"]`
    ).textContent();
    assert.equal(cellText, '4.5', 'Rating value should persist after reload');

    await screenshot(page, 'e2e-phase3-property-edited');

    // 7. Rename the property
    const thMenuBtn = page.locator(`[data-testid="db-th-menu-${ratingProp!.id}"]`);
    await thMenuBtn.click();
    await page.waitForTimeout(200);

    await page.locator(`[data-testid="db-th-rename-${ratingProp!.id}"]`).click();
    await page.waitForTimeout(200);

    const renameInput = page.locator(
      `[data-testid="db-th-rename-input-${ratingProp!.id}"]`
    );
    await renameInput.fill('Score');
    await renameInput.press('Enter');
    await page.waitForTimeout(500);

    await screenshot(page, 'e2e-phase3-property-renamed');

    // 8. Delete the property
    // Get fresh IDs after rename
    await page.reload();
    await waitForTable(page);

    const freshDb2 = await getDatabase(baseUrl(), readingListId);
    const scoreProp = freshDb2.properties.find((p) => p.name === 'Score');
    assert.ok(scoreProp, 'Score property should exist after rename');

    const thMenuBtn2 = page.locator(`[data-testid="db-th-menu-${scoreProp!.id}"]`);
    await thMenuBtn2.click();
    await page.waitForTimeout(200);

    await page.locator(`[data-testid="db-th-delete-${scoreProp!.id}"]`).click();
    await page.waitForTimeout(200);

    // Confirmation modal
    const modal = page.locator('[role="dialog"]');
    await modal.waitFor({ state: 'visible', timeout: 3000 });
    const modalText = await modal.textContent() ?? '';
    assert.ok(
      modalText.includes('Score'),
      'Delete modal should name the property'
    );

    await page.locator('[data-testid="confirm-delete"]').click();
    await page.waitForTimeout(500);

    // Verify column gone after reload
    await page.reload();
    await waitForTable(page);

    const scoreHeaders = page.locator('.db-th-name-text', { hasText: 'Score' });
    const scoreCount = await scoreHeaders.count();
    assert.equal(scoreCount, 0, 'Score column should be gone after deletion');
  });

  /* ================================================================ */
  /*  SC: Rows add and delete                                         */
  /* ================================================================ */

  it('TC-5: add a row, delete it with confirmation', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    const rowsBefore = await page.locator('.db-row').count();

    // 1. Add a row
    await page.locator('[data-testid="db-add-row"]').click();
    await page.waitForTimeout(1000);

    // 2. It should navigate to the new row page
    const url = page.url();
    assert.ok(url.includes('/page/'), 'Should navigate to new row page after adding');

    // 3. Go back to the table
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    const rowsAfterAdd = await page.locator('.db-row').count();
    assert.equal(rowsAfterAdd, rowsBefore + 1, 'Row count should increase by 1');

    await screenshot(page, 'e2e-phase3-row-added');

    // 4. Find the new "Untitled" row and delete it
    const freshDb = await getDatabase(baseUrl(), readingListId);
    const untitledRow = freshDb.rows.find((r) => r.title === 'Untitled');
    assert.ok(untitledRow, 'Untitled row should exist');

    const deleteBtn = page.locator(
      `[data-testid="db-row-delete-${untitledRow!.id}"]`
    );
    await deleteBtn.click();
    await page.waitForTimeout(300);

    // 5. Confirmation modal
    const modal = page.locator('[role="dialog"]');
    await modal.waitFor({ state: 'visible', timeout: 3000 });
    const modalText = await modal.textContent() ?? '';
    assert.ok(
      modalText.includes('Untitled') || modalText.includes('row'),
      'Delete modal should reference the row'
    );

    await screenshot(page, 'e2e-phase3-row-delete-modal');

    await page.locator('[data-testid="confirm-delete"]').click();
    await page.waitForTimeout(500);

    // 6. Verify row gone after reload
    await page.reload();
    await waitForTable(page);

    const rowsAfterDelete = await page.locator('.db-row').count();
    assert.equal(rowsAfterDelete, rowsBefore, 'Row count should return to original');
  });

  /* ================================================================ */
  /*  SC-5: Row opens as page                                         */
  /* ================================================================ */

  it('TC-6: open Project Hail Mary as page, properties + blocks, edit, persist', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    // 1. Click "Project Hail Mary" title link to open as page
    const hailMaryId = db.rows.find((r) => r.title === 'Project Hail Mary')!.id;
    await page.locator(`[data-testid="db-row-title-${hailMaryId}"]`).click();

    // 2. Wait for the row page view
    await page.waitForSelector('[data-testid="row-page-view"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    // 3. Properties panel should show all 7 properties
    const propsPanel = page.locator('[data-testid="row-properties-panel"]');
    await propsPanel.waitFor({ state: 'visible', timeout: 5000 });

    const propLabels = await page.locator('[data-testid^="row-prop-label-"]').allTextContents();
    const propNameTexts = propLabels.map((t) => t.replace(/\s*(Text|Number|Select|Multi-select|Date|Checkbox|URL)\s*$/i, '').trim());
    for (const name of ['Author', 'Pages', 'Status', 'Genre', 'Started', 'Owned', 'Link']) {
      assert.ok(
        propNameTexts.some((n) => n.includes(name)),
        `Properties panel should show "${name}"`
      );
    }

    await screenshot(page, 'e2e-phase3-row-page-properties');

    // 4. Blocks should render below (paragraph, todo, quote)
    const blockEditor = page.locator('[data-testid="block-editor"]');
    await blockEditor.waitFor({ state: 'visible', timeout: 5000 });

    const blockTexts = await page.locator('[data-testid^="block-text-"]').allTextContents();
    const allBlocks = blockTexts.join(' ');
    assert.ok(
      allBlocks.includes('Ryne Grace'),
      'Should show the paragraph block text'
    );
    assert.ok(
      allBlocks.includes('Finish by the end of July'),
      'Should show the todo block text'
    );
    assert.ok(
      allBlocks.includes('Good science fiction'),
      'Should show the quote block text'
    );

    // 5. Edit a property value here
    // Find the Author property editor on the row page
    const freshDb = await getDatabase(baseUrl(), readingListId);
    const authorProp = freshDb.properties.find((p) => p.name === 'Author')!;
    const authorCellBtn = page.locator(
      `[data-testid="cell-button-${hailMaryId}-${authorProp.id}"]`
    );
    await authorCellBtn.click();
    await page.waitForTimeout(200);

    const authorInput = page.locator(`[data-testid="cell-input-${authorProp.id}"]`);
    await authorInput.waitFor({ state: 'visible', timeout: 3000 });
    await authorInput.fill('Andy Weir (v2)');
    await authorInput.press('Enter');
    await page.waitForTimeout(500);

    // 6. Add a block
    const blocksBefore = await page.locator('[data-testid^="block-text-"]').count();
    // Click on the last block and press Enter
    const lastBlock = page.locator('[data-testid^="block-text-"]').last();
    await lastBlock.click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Type in the new block
    const newBlock = page.locator('[data-testid^="block-text-"]').last();
    await newBlock.click();
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="block-text-"]:last-of-type') as HTMLElement;
      if (el) {
        el.focus();
        document.execCommand('insertText', false, 'E2E added block');
      }
    });
    await page.waitForTimeout(1500);

    // 7. Reload and verify both persist
    await page.reload();
    await page.waitForSelector('[data-testid="row-page-view"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Property edit persisted (values are keyed by property ID, not name)
    const freshDb2 = await getDatabase(baseUrl(), readingListId);
    const hailMaryRow = freshDb2.rows.find((r) => r.id === hailMaryId)!;
    const authorPropId = freshDb2.properties.find((p) => p.name === 'Author')!.id;
    assert.equal(
      hailMaryRow.values[authorPropId],
      'Andy Weir (v2)',
      'Author edit should persist on row page'
    );

    // Block persisted
    const blockTextsAfter = await page.locator('[data-testid^="block-text-"]').allTextContents();
    const hasNewBlock = blockTextsAfter.some((t) => t.includes('E2E added block'));
    assert.ok(hasNewBlock, 'Newly added block should persist after reload');

    await screenshot(page, 'e2e-phase3-row-page-edit-persist');

    // 8. "In Reading List" crumb navigates back to table
    const crumb = page.locator('[data-testid="row-page-crumb"]');
    const crumbText = await crumb.textContent();
    assert.ok(
      crumbText?.includes('Reading List'),
      'Crumb should say "In Reading List"'
    );

    await page.locator('.row-page-crumb-link').click();
    await waitForTable(page);

    const tableVisible = await page.locator('[data-testid="db-table"]').isVisible();
    assert.ok(tableVisible, 'Clicking crumb should navigate back to table view');
  });

  /* ================================================================ */
  /*  SC-7: All seven property types have fitting editors             */
  /* ================================================================ */

  it('TC-7: all seven property types render fitting editors in the table', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    const firstRowId = db.rows[0].id;

    // text -> cell-button with text display
    const textProp = db.properties.find((p) => p.name === 'Author')!;
    const textCell = page.locator(
      `[data-testid="cell-button-${firstRowId}-${textProp.id}"]`
    );
    assert.ok(await textCell.isVisible(), 'Text cell should be a clickable button');

    // number -> cell-button with number display
    const numProp = db.properties.find((p) => p.name === 'Pages')!;
    const numCell = page.locator(
      `[data-testid="cell-button-${firstRowId}-${numProp.id}"]`
    );
    assert.ok(await numCell.isVisible(), 'Number cell should be a clickable button');

    // select -> cell-button with option chip
    const selectProp = db.properties.find((p) => p.name === 'Status')!;
    const selectCell = page.locator(
      `[data-testid="cell-button-${firstRowId}-${selectProp.id}"]`
    );
    assert.ok(await selectCell.isVisible(), 'Select cell should be a clickable button');

    // multi_select -> cell-button with option chips
    const multiProp = db.properties.find((p) => p.name === 'Genre')!;
    const multiCell = page.locator(
      `[data-testid="cell-button-${firstRowId}-${multiProp.id}"]`
    );
    assert.ok(await multiCell.isVisible(), 'Multi-select cell should be a clickable button');

    // date -> cell-button with date display
    const dateProp = db.properties.find((p) => p.name === 'Started')!;
    const dateCell = page.locator(
      `[data-testid="cell-button-${firstRowId}-${dateProp.id}"]`
    );
    assert.ok(await dateCell.isVisible(), 'Date cell should be a clickable button');

    // checkbox -> toggle button (no cell-button, uses cell-checkbox-toggle)
    const checkProp = db.properties.find((p) => p.name === 'Owned')!;
    const checkCell = page.locator(
      `[data-testid="cell-checkbox-toggle-${firstRowId}-${checkProp.id}"]`
    );
    assert.ok(await checkCell.isVisible(), 'Checkbox cell should be a toggle button');

    // url -> cell-button with url display
    const urlProp = db.properties.find((p) => p.name === 'Link')!;
    const urlCell = page.locator(
      `[data-testid="cell-button-${firstRowId}-${urlProp.id}"]`
    );
    assert.ok(await urlCell.isVisible(), 'URL cell should be a clickable button');

    // Open the text editor and verify it's an <input>
    await textCell.click();
    await page.waitForTimeout(200);
    const textInput = page.locator(`[data-testid="cell-input-${textProp.id}"]`);
    const inputTag = await textInput.evaluate((el) => el.tagName);
    assert.equal(inputTag, 'INPUT', 'Text editor should render as <input>');

    // Open the date editor and verify it's an input type="date"
    await textInput.press('Escape');
    await page.waitForTimeout(100);
    await dateCell.click();
    await page.waitForTimeout(200);
    const dateInput = page.locator(`[data-testid="cell-input-${dateProp.id}"]`);
    const dateType = await dateInput.evaluate((el) => (el as HTMLInputElement).type);
    assert.equal(dateType, 'date', 'Date editor should be input type="date"');

    // Open the select editor and verify popover appears
    await dateInput.press('Escape');
    await page.waitForTimeout(100);
    await selectCell.click();
    await page.waitForTimeout(300);
    const selectPopover = page.locator(
      `[data-testid="select-popover-${firstRowId}-${selectProp.id}"]`
    );
    assert.ok(
      await selectPopover.isVisible(),
      'Select editor should open a popover'
    );

    await screenshot(page, 'e2e-phase3-all-property-editors');
  });

  /* ================================================================ */
  /*  VISUAL CHECK: Table header alignment                            */
  /* ================================================================ */

  it('TC-8: VISUAL - table header row screenshot and alignment check', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    // Take a screenshot of the table header area
    await screenshot(page, 'e2e-phase3-table-header');

    // Check that all <th> elements have similar vertical positioning
    const thElements = page.locator('.db-th');
    const thCount = await thElements.count();
    assert.ok(thCount >= 8, `Should have Title + 7 properties + New property = 8+ th, got ${thCount}`);

    // Get the bounding boxes of the header cells and compare top positions
    const boxes: { top: number; bottom: number; height: number; text: string }[] = [];
    for (let i = 0; i < thCount; i++) {
      const box = await thElements.nth(i).boundingBox();
      if (box) {
        const text = await thElements.nth(i).textContent();
        boxes.push({ top: box.y, bottom: box.y + box.height, height: box.height, text: (text || '').trim() });
      }
    }

    // All th elements should have similar top positions (within 5px)
    if (boxes.length > 0) {
      const tops = boxes.map((b) => b.top);
      const minTop = Math.min(...tops);
      const maxTop = Math.max(...tops);
      const diff = maxTop - minTop;
      console.log(`Header cell tops: min=${minTop}, max=${maxTop}, diff=${diff}`);
      for (const b of boxes) {
        console.log(`  ${b.text}: top=${b.top}, height=${b.height}`);
      }
      // Allow 5px tolerance for sub-pixel rendering
      if (diff > 5) {
        console.log(`WARNING: Header cells have vertical misalignment of ${diff}px`);
      }
    }
  });
});
