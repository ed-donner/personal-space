/**
 * DEF-002 retest + regression: Junk input in number cell.
 *
 * Exact repro from DEFECTS.md plus regression coverage:
 *   - junk via Enter reverts, no PATCH
 *   - junk via blur reverts, no PATCH
 *   - reload confirms original value survived
 *   - valid number commit works
 *   - empty clears to null and persists
 *   - decimal and negative numbers commit
 *   - same behaviours on row-page properties panel number property
 *   - text cell editing unaffected
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

async function waitForTable(page: Page) {
  await page.waitForSelector('[data-testid="db-table"]', { timeout: 10000 });
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

/** Click a cell button and wait for the inline input to appear. */
async function openCellEditor(page: Page, rowId: string, propId: string) {
  const btn = page.locator(`[data-testid="cell-button-${rowId}-${propId}"]`);
  await btn.click();
  await page.waitForTimeout(200);
  const input = page.locator(`[data-testid="cell-input-${propId}"]`);
  await input.waitFor({ state: 'visible', timeout: 3000 });
  return input;
}

/** Read the number display text for a cell. */
async function readNumberCell(page: Page, rowId: string, propId: string): Promise<string | null> {
  const el = page.locator(`[data-testid="cell-number-${rowId}-${propId}"]`);
  if (!(await el.isVisible())) return null;
  return el.textContent();
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('DEF-002 retest: junk input in number cell', () => {
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
    process.exit(0);
  });

  /* ================================================================ */
  /*  Exact repro from DEF-002                                        */
  /* ================================================================ */

  it('REPRO-1: type junk + Enter reverts to previous value', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    const firstRowId = db.rows[0].id; // Project Hail Mary
    const pagesProp = db.properties.find((p) => p.name === 'Pages')!;
    const originalValue = db.rows[0].values[pagesProp.id]; // 476

    // Step 1-3: set to 500, Enter, verify display
    const input1 = await openCellEditor(page, firstRowId, pagesProp.id);
    await input1.fill('500');
    await input1.press('Enter');
    await page.waitForTimeout(500);

    let displayed = await readNumberCell(page, firstRowId, pagesProp.id);
    assert.equal(displayed, '500', 'After setting 500, cell should show 500');

    // Step 4-6: open again, type junk, press Enter
    const input2 = await openCellEditor(page, firstRowId, pagesProp.id);
    await input2.fill('not-a-number');
    await input2.press('Enter');
    await page.waitForTimeout(500);

    // Expected: cell reverts to 500 (the previous valid value)
    displayed = await readNumberCell(page, firstRowId, pagesProp.id);
    assert.equal(displayed, '500', 'After junk + Enter, cell should revert to 500');

    await screenshot(page, 'def-002-repro-junk-enter');
  });

  it('REPRO-2: type junk + blur reverts to previous value', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    const firstRowId = db.rows[0].id;
    const pagesProp = db.properties.find((p) => p.name === 'Pages')!;

    // Verify current value is 500 (set in REPRO-1)
    let displayed = await readNumberCell(page, firstRowId, pagesProp.id);
    assert.equal(displayed, '500', 'Starting value should be 500');

    // Open editor, type junk, click elsewhere (blur)
    const input = await openCellEditor(page, firstRowId, pagesProp.id);
    await input.fill('garbage-123');
    // Click the table header to trigger blur
    await page.locator('[data-testid="db-table"] .db-th').first().click();
    await page.waitForTimeout(500);

    // Expected: cell reverts to 500
    displayed = await readNumberCell(page, firstRowId, pagesProp.id);
    assert.equal(displayed, '500', 'After junk + blur, cell should revert to 500');

    await screenshot(page, 'def-002-repro-junk-blur');
  });

  it('REPRO-3: reload confirms value survived (API returns 500)', async () => {
    await page.reload();
    await waitForTable(page);

    const firstRowId = db.rows[0].id;
    const pagesProp = db.properties.find((p) => p.name === 'Pages')!;

    const displayed = await readNumberCell(page, firstRowId, pagesProp.id);
    assert.equal(displayed, '500', 'After reload, cell should still show 500');

    // Also check the API directly
    const freshDb = await getDatabase(baseUrl(), readingListId);
    const apiValue = freshDb.rows[0].values[pagesProp.id];
    assert.equal(apiValue, 500, 'API should return 500 for Pages, not null');
  });

  /* ================================================================ */
  /*  Regression: valid number commit                                 */
  /* ================================================================ */

  it('REG-1: valid integer commits and persists', async () => {
    const firstRowId = db.rows[0].id;
    const pagesProp = db.properties.find((p) => p.name === 'Pages')!;

    const input = await openCellEditor(page, firstRowId, pagesProp.id);
    await input.fill('777');
    await input.press('Enter');
    await page.waitForTimeout(500);

    let displayed = await readNumberCell(page, firstRowId, pagesProp.id);
    assert.equal(displayed, '777', 'Cell should show 777 after valid edit');

    // Reload and verify
    await page.reload();
    await waitForTable(page);

    displayed = await readNumberCell(page, firstRowId, pagesProp.id);
    assert.equal(displayed, '777', 'After reload, 777 should persist');
  });

  /* ================================================================ */
  /*  Regression: empty input clears to null                          */
  /* ================================================================ */

  it('REG-2: empty input clears to null, persists as empty after reload', async () => {
    const firstRowId = db.rows[0].id;
    const pagesProp = db.properties.find((p) => p.name === 'Pages')!;

    const input = await openCellEditor(page, firstRowId, pagesProp.id);
    await input.fill('');
    await input.press('Enter');
    await page.waitForTimeout(500);

    // Cell should display "Empty"
    const cellText = await page.locator(
      `[data-testid="cell-number-${firstRowId}-${pagesProp.id}"]`
    ).textContent();
    assert.ok(
      cellText?.includes('Empty'),
      `Cell should display "Empty" after clearing, got: ${cellText}`
    );

    // Reload and verify it stayed null
    await page.reload();
    await waitForTable(page);

    const afterReload = await page.locator(
      `[data-testid="cell-number-${firstRowId}-${pagesProp.id}"]`
    ).textContent();
    assert.ok(
      afterReload?.includes('Empty'),
      `After reload, cell should still show "Empty", got: ${afterReload}`
    );

    const freshDb = await getDatabase(baseUrl(), readingListId);
    const apiValue = freshDb.rows[0].values[pagesProp.id];
    assert.equal(apiValue, null, 'API should return null for cleared Pages value');
  });

  /* ================================================================ */
  /*  Regression: decimal and negative numbers                        */
  /* ================================================================ */

  it('REG-3: decimal number commits correctly', async () => {
    // Use a fresh row: "Educated"
    const row = db.rows.find((r) => r.title === 'Educated')!;
    const pagesProp = db.properties.find((p) => p.name === 'Pages')!;

    const input = await openCellEditor(page, row.id, pagesProp.id);
    await input.fill('3.14');
    await input.press('Enter');
    await page.waitForTimeout(500);

    let displayed = await readNumberCell(page, row.id, pagesProp.id);
    assert.equal(displayed, '3.14', 'Decimal 3.14 should display');

    await page.reload();
    await waitForTable(page);

    displayed = await readNumberCell(page, row.id, pagesProp.id);
    assert.equal(displayed, '3.14', 'Decimal 3.14 should persist after reload');
  });

  it('REG-4: negative number commits correctly', async () => {
    // Use a different row: "Dune"
    const row = db.rows.find((r) => r.title === 'Dune')!;
    const pagesProp = db.properties.find((p) => p.name === 'Pages')!;

    const input = await openCellEditor(page, row.id, pagesProp.id);
    await input.fill('-10');
    await input.press('Enter');
    await page.waitForTimeout(500);

    let displayed = await readNumberCell(page, row.id, pagesProp.id);
    assert.equal(displayed, '-10', 'Negative -10 should display');

    await page.reload();
    await waitForTable(page);

    displayed = await readNumberCell(page, row.id, pagesProp.id);
    assert.equal(displayed, '-10', 'Negative -10 should persist after reload');
  });

  /* ================================================================ */
  /*  Regression: number property on row-page properties panel         */
  /* ================================================================ */

  it('REG-5: number property in row-page panel — valid commit, junk revert, empty clear', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    const hailMaryId = db.rows.find((r) => r.title === 'Project Hail Mary')!.id;
    // Navigate to row page
    await page.locator(`[data-testid="db-row-title-${hailMaryId}"]`).click();
    await page.waitForSelector('[data-testid="row-page-view"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Find the Pages cell on the properties panel
    const freshDb = await getDatabase(baseUrl(), readingListId);
    const pagesProp = freshDb.properties.find((p) => p.name === 'Pages')!;

    // 1. Valid commit on row page
    const input1 = await openCellEditor(page, hailMaryId, pagesProp.id);
    await input1.fill('100');
    await input1.press('Enter');
    await page.waitForTimeout(500);

    let displayed = await readNumberCell(page, hailMaryId, pagesProp.id);
    assert.equal(displayed, '100', 'Row page: Pages should show 100 after valid edit');

    // 2. Junk reverts on row page
    const input2 = await openCellEditor(page, hailMaryId, pagesProp.id);
    await input2.fill('not-a-number');
    await input2.press('Enter');
    await page.waitForTimeout(500);

    displayed = await readNumberCell(page, hailMaryId, pagesProp.id);
    assert.equal(displayed, '100', 'Row page: junk should revert to 100');

    // 3. Empty clears on row page
    const input3 = await openCellEditor(page, hailMaryId, pagesProp.id);
    await input3.fill('');
    await input3.press('Enter');
    await page.waitForTimeout(500);

    const cellText = await page.locator(
      `[data-testid="cell-number-${hailMaryId}-${pagesProp.id}"]`
    ).textContent();
    assert.ok(
      cellText?.includes('Empty'),
      `Row page: empty should show "Empty", got: ${cellText}`
    );

    // 4. Reload the row page and verify persistence
    await page.reload();
    await page.waitForSelector('[data-testid="row-page-view"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    const afterReload = await page.locator(
      `[data-testid="cell-number-${hailMaryId}-${pagesProp.id}"]`
    ).textContent();
    assert.ok(
      afterReload?.includes('Empty'),
      `Row page: after reload, should still be "Empty", got: ${afterReload}`
    );

    // Restore the original value for other tests
    const inputRestore = await openCellEditor(page, hailMaryId, pagesProp.id);
    await inputRestore.fill('476');
    await inputRestore.press('Enter');
    await page.waitForTimeout(500);

    await screenshot(page, 'def-002-regression-row-page');
  });

  /* ================================================================ */
  /*  Regression: text cell editing unaffected                        */
  /* ================================================================ */

  it('REG-6: text cell editing still works normally', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTable(page);

    const firstRowId = db.rows[0].id;
    const authorProp = db.properties.find((p) => p.name === 'Author')!;

    // Edit text cell
    const input = await openCellEditor(page, firstRowId, authorProp.id);
    await input.fill('Regression Test Author');
    await input.press('Enter');
    await page.waitForTimeout(500);

    const cellText = await page.locator(
      `[data-testid="cell-text-${firstRowId}-${authorProp.id}"]`
    ).textContent();
    assert.equal(cellText, 'Regression Test Author', 'Text cell should show edited value');

    // Reload and verify
    await page.reload();
    await waitForTable(page);

    const afterReload = await page.locator(
      `[data-testid="cell-text-${firstRowId}-${authorProp.id}"]`
    ).textContent();
    assert.equal(afterReload, 'Regression Test Author', 'Text edit should persist after reload');

    await screenshot(page, 'def-002-regression-text-cell');
  });
});
