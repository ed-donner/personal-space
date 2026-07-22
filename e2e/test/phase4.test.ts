/**
 * Phase 4 -- Board and list views, filters and sorts (e2e).
 *
 * Maps to REQUIREMENTS.md Phase 4 success criteria 1-8.
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

interface PropertyOption {
  id: string;
  label: string;
  color: string;
}

interface Property {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  options: PropertyOption[] | null;
  position: number;
}

interface RowPage {
  id: string;
  parentId: string;
  title: string;
  kind: string;
  values: Record<string, unknown>;
}

interface ViewSettings {
  filters?: { propertyId: string; op: string; value?: unknown }[];
  sort?: { propertyId: string; direction: 'asc' | 'desc' } | null;
  groupBy?: string | null;
}

interface DatabaseResponse {
  page: TreePage;
  properties: Property[];
  rows: RowPage[];
  views: { table: ViewSettings; board: ViewSettings; list: ViewSettings };
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

async function waitForTable(page: Page) {
  await page.waitForSelector('[data-testid="db-table"]', { timeout: 15000 });
  await page.waitForTimeout(300);
}

async function waitForBoard(page: Page) {
  await page.waitForSelector('[data-testid="board-view"]', { timeout: 10000 });
  await page.waitForTimeout(300);
}

async function waitForList(page: Page) {
  await page.waitForSelector('[data-testid="list-view"]', { timeout: 10000 });
  await page.waitForTimeout(300);
}

/** Navigate to a database page and ensure we're on the table view. */
async function openDatabase(page: Page, base: string, id: string) {
  await page.goto(`${base}/page/${id}`);
  await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  // Ensure table view is active
  const isTableActive = await page.locator('[data-testid="db-view-tab-table"]').getAttribute('aria-selected');
  if (isTableActive !== 'true') {
    await page.click('[data-testid="db-view-tab-table"]');
    await page.waitForTimeout(500);
  }
  await waitForTable(page);
}

/** Switch view by clicking the tab. */
async function switchView(page: Page, viewType: 'table' | 'board' | 'list') {
  await page.click(`[data-testid="db-view-tab-${viewType}"]`);
  await page.waitForTimeout(500);
}

/** Remove all filter chips from the current view. */
async function clearAllFilters(page: Page, viewType: 'table' | 'board' | 'list') {
  for (let i = 0; i < 5; i++) {
    const chips = page.locator(`[data-testid="view-filter-chips-${viewType}"] > [data-testid^="view-filter-chip-"]`);
    const count = await chips.count();
    if (count === 0) break;
    // Click the remove button of the first chip
    const removeBtn = page.locator(`[data-testid="view-filter-chips-${viewType}"] [data-testid$="-remove"]`).first();
    if (await removeBtn.count() > 0) {
      await removeBtn.click();
      await page.waitForTimeout(400);
    }
  }
}

/** Remove sort if present. */
async function clearSort(page: Page, viewType: 'table' | 'board' | 'list') {
  const sortRemove = page.locator(`[data-testid="view-sort-chips-${viewType}"] [data-testid="view-sort-chip-remove"]`);
  if (await sortRemove.count() > 0) {
    await sortRemove.click();
    await page.waitForTimeout(400);
  }
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Phase 4 -- Board and list views, filters and sorts (e2e)', () => {
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
  /*  SC-1: View switcher                                             */
  /* ================================================================ */

  it('TC-1a: Reading List switches Table -> Board -> List -> Table', async () => {
    await openDatabase(page, baseUrl(), readingListId);

    const tableRows = await page.locator('.db-row').count();
    assert.ok(tableRows >= 4, `Table should show rows, got ${tableRows}`);

    await switchView(page, 'board');
    await waitForBoard(page);
    const boardCards = await page.locator('.board-card-host').count();
    assert.ok(boardCards >= tableRows, `Board should show >= ${tableRows} cards, got ${boardCards}`);

    await switchView(page, 'list');
    await waitForList(page);
    const listItems = await page.locator('.list-row').count();
    assert.ok(listItems >= tableRows, `List should show >= ${tableRows} items, got ${listItems}`);

    await switchView(page, 'table');
    await waitForTable(page);
    const tableRowsAgain = await page.locator('.db-row').count();
    assert.equal(tableRowsAgain, tableRows, 'Table row count should be stable');

    const activeText = await page.locator('.db-view-switcher-tab.is-active').textContent();
    assert.ok(activeText?.toLowerCase().includes('table'), `Active tab should be Table, got: ${activeText}`);
  });

  it('TC-1b: active view persists after refresh', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await switchView(page, 'board');
    await waitForBoard(page);

    let activeText = await page.locator('.db-view-switcher-tab.is-active').textContent();
    assert.ok(activeText?.toLowerCase().includes('board'), `Should be on Board tab, got: ${activeText}`);

    await page.reload();
    await page.waitForSelector('[data-testid="board-view"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    activeText = await page.locator('.db-view-switcher-tab.is-active').textContent();
    assert.ok(activeText?.toLowerCase().includes('board'), `After refresh, active tab should be Board, got: ${activeText}`);
  });

  /* ================================================================ */
  /*  SC-7: Seeded settings (run before any filter/sort modifications)*/
  /* ================================================================ */

  it('TC-8a: Reading List table hides Abandoned, sorted by Author asc', async () => {
    await openDatabase(page, baseUrl(), readingListId);

    const titles = await page.locator('.db-row-title').allTextContents();
    assert.ok(!titles.some(t => t.includes('Sapiens')), `Table should NOT show Sapiens. Got: ${titles}`);
    assert.ok(titles.some(t => t.includes('Hail Mary')), 'Table should show Project Hail Mary');

    const authorProp = db.properties.find(p => p.name === 'Author')!;
    const authorCells = await page.locator(`[data-testid^="cell-text-"][data-testid$="-${authorProp.id}"]`).allTextContents();
    for (let i = 1; i < authorCells.length; i++) {
      assert.ok(
        authorCells[i - 1].localeCompare(authorCells[i]) <= 0,
        `Authors sorted asc: "${authorCells[i - 1]}" <= "${authorCells[i]}"`
      );
    }

    const sortText = await page.locator('[data-testid="view-sort-chip"]').textContent();
    assert.ok(sortText?.includes('Author'), `Sort chip should show Author, got: ${sortText}`);
    assert.ok(sortText?.toLowerCase().includes('asc'), `Sort chip should show asc, got: ${sortText}`);
  });

  it('TC-8b: Renovation Tasks board grouped by Room', async () => {
    const renovationId = await findPageByTitle(baseUrl(), 'Renovation Tasks');
    const renovationDb = await getDatabase(baseUrl(), renovationId);

    await page.goto(`${baseUrl()}/page/${renovationId}`);
    await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    await switchView(page, 'board');
    await waitForBoard(page);

    const groupByText = await page.locator('[data-testid="view-groupby-button-board"]').textContent();
    assert.ok(groupByText?.includes('Room'), `Board should be grouped by Room, got: ${groupByText}`);

    const roomProp = renovationDb.properties.find(p => p.name === 'Room')!;
    for (const opt of roomProp.options!) {
      assert.ok(
        await page.locator(`[data-testid="board-column-${opt.id}"]`).count() > 0,
        `Should have column for Room="${opt.label}"`
      );
    }

    await screenshot(page, 'e2e-phase4-renovation-board');
  });

  it('TC-8c: Renovation Tasks table filtered to unchecked Done + sorted by Target date', async () => {
    const renovationId = await findPageByTitle(baseUrl(), 'Renovation Tasks');

    await page.goto(`${baseUrl()}/page/${renovationId}`);
    await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    // Ensure table view
    const isTableActive = await page.locator('[data-testid="db-view-tab-table"]').getAttribute('aria-selected');
    if (isTableActive !== 'true') {
      await page.click('[data-testid="db-view-tab-table"]');
      await page.waitForTimeout(500);
    }
    await waitForTable(page);

    const titles = await page.locator('.db-row-title').allTextContents();
    assert.ok(!titles.some(t => t.includes('Paint the living room')), `Should NOT show "Paint the living room" (Done=true). Got: ${titles}`);
    assert.ok(titles.some(t => t.includes('Replace worktops')), 'Should show "Replace worktops"');

    const sortText = await page.locator('[data-testid="view-sort-chip"]').textContent();
    assert.ok(sortText?.includes('Target date'), `Sort chip should show Target date, got: ${sortText}`);

    await screenshot(page, 'e2e-phase4-renovation-table');
  });

  /* ================================================================ */
  /*  VISUAL CHECK: seeded filter value                               */
  /* ================================================================ */

  it('TC-9: VISUAL - seeded Status filter value control', async () => {
    await openDatabase(page, baseUrl(), readingListId);

    // The seeded table has Status is_not "Abandoned" filter
    const chipCount = await page.locator('[data-testid="view-filter-chips-table"] > [data-testid^="view-filter-chip-"]').count();
    assert.ok(chipCount >= 1, 'Seeded table should have at least 1 filter chip');

    const firstChip = page.locator('[data-testid="view-filter-chips-table"] > [data-testid^="view-filter-chip-"]').first();
    const chipText = await firstChip.textContent();
    assert.ok(chipText?.includes('Status'), `Filter chip should show "Status", got: ${chipText}`);

    // Check the value select control
    const valueSelect = page.locator('[data-testid="view-filter-chip-value-select"]');
    if (await valueSelect.count() > 0) {
      const selectedText = await valueSelect.locator('option:checked').textContent();
      console.log(`Filter value select: selectedText="${selectedText}"`);

      await screenshot(page, 'e2e-phase4-seeded-filter-visual');

      if (!selectedText || selectedText.trim() === '') {
        console.log('WARNING: Filter value control appears blank');
      }
    } else {
      await screenshot(page, 'e2e-phase4-seeded-filter-visual');
    }
  });

  /* ================================================================ */
  /*  SC-2: Board grouping by Status                                  */
  /* ================================================================ */

  it('TC-2: board grouped by Status shows columns for each option', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await switchView(page, 'board');
    await waitForBoard(page);

    const statusProp = db.properties.find((p) => p.name === 'Status')!;
    for (const opt of statusProp.options!) {
      const col = page.locator(`[data-testid="board-column-${opt.id}"]`);
      assert.ok(await col.count() > 0, `Board should have column for "${opt.label}"`);
    }
    // "No value" column
    assert.ok(await page.locator('[data-testid="board-column-none"]').count() > 0, 'Should have "No value" column');

    // Verify a card in the To read column (Dune starts there before TC-3 drag)
    const toReadOptId = statusProp.options!.find(o => o.label === 'To read')!.id;
    const toReadTitles = await page.locator(`[data-testid="board-column-${toReadOptId}"] .board-card-title`).allTextContents();
    assert.ok(toReadTitles.some(t => t.includes('Dune')), `To read column should have "Dune"`);
    assert.ok(toReadTitles.some(t => t.includes('Gentleman')), `To read column should have "Gentleman"`);

    await screenshot(page, 'e2e-phase4-board-grouped-status');
  });

  /* ================================================================ */
  /*  SC-3: Card drag between columns                                 */
  /* ================================================================ */

  it('TC-3: drag Dune from "To read" to "Reading" (pointer drag)', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await switchView(page, 'board');
    await waitForBoard(page);

    const statusProp = db.properties.find((p) => p.name === 'Status')!;
    const toReadOpt = statusProp.options!.find(o => o.label === 'To read')!;
    const readingOpt = statusProp.options!.find(o => o.label === 'Reading')!;
    const duneRow = db.rows.find(r => r.title === 'Dune')!;

    // Verify Dune is in "To read" column
    const toReadCol = page.locator(`[data-testid="board-column-${toReadOpt.id}"]`);
    assert.ok(
      await toReadCol.locator(`[data-testid="board-card-title-${duneRow.id}"]`).count() > 0,
      'Dune should be in "To read" column'
    );

    // Pointer drag: mousedown on handle, move to Reading column, mouseup
    const handle = page.locator(`[data-testid="board-card-handle-${duneRow.id}"]`);
    const target = page.locator(`[data-testid="board-column-header-${readingOpt.id}"]`);
    const handleBox = await handle.boundingBox();
    const targetBox = await target.boundingBox();

    assert.ok(handleBox, 'Drag handle should have bounding box');
    assert.ok(targetBox, 'Target column should have bounding box');

    // Move in steps for dnd-kit to detect
    await page.mouse.move(handleBox.x + 5, handleBox.y + 5);
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) {
      const frac = i / 15;
      await page.mouse.move(
        handleBox.x + (targetBox.x - handleBox.x) * frac + 10,
        handleBox.y + (targetBox.y - handleBox.y) * frac + 10
      );
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(1500);

    // Verify via API
    const freshDb = await getDatabase(baseUrl(), readingListId);
    const duneFresh = freshDb.rows.find(r => r.id === duneRow.id)!;
    assert.equal(duneFresh.values[statusProp.id], readingOpt.id, 'Dune should now have Status = Reading');

    // Verify via Table view
    await switchView(page, 'table');
    await waitForTable(page);
    const cellText = await page.locator(`[data-testid="cell-select-${duneRow.id}-${statusProp.id}"]`).textContent();
    assert.ok(cellText?.includes('Reading'), `Table should show Dune as "Reading", got: ${cellText}`);

    // Reload and verify persistence
    await page.reload();
    await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 10000 });
    await page.waitForTimeout(500);
    const persistDb = await getDatabase(baseUrl(), readingListId);
    const dunePersist = persistDb.rows.find(r => r.id === duneRow.id)!;
    assert.equal(dunePersist.values[statusProp.id], readingOpt.id, 'Drag should persist after reload');

    await screenshot(page, 'e2e-phase4-card-drag');

    // Restore Dune to "To read"
    await fetch(`${baseUrl()}/api/rows/${duneRow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { [statusProp.id]: toReadOpt.id } }),
    });
  });

  it('TC-3b: drag card to "No value" and back via API simulation', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await switchView(page, 'board');
    await waitForBoard(page);

    const statusProp = db.properties.find((p) => p.name === 'Status')!;
    const toReadOpt = statusProp.options!.find(o => o.label === 'To read')!;
    const duneRow = db.rows.find(r => r.title === 'Dune')!;

    // Move Dune to "No value" via API
    await fetch(`${baseUrl()}/api/rows/${duneRow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { [statusProp.id]: null } }),
    });
    await page.reload();
    await switchView(page, 'board');
    await waitForBoard(page);

    // Dune should be in "No value" column
    const noValueCol = page.locator('[data-testid="board-column-none"]');
    assert.ok(
      await noValueCol.locator(`[data-testid="board-card-title-${duneRow.id}"]`).count() > 0,
      'Dune should be in "No value" column'
    );

    // Move back via API
    await fetch(`${baseUrl()}/api/rows/${duneRow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { [statusProp.id]: toReadOpt.id } }),
    });
    await page.reload();
    await switchView(page, 'board');
    await waitForBoard(page);

    const toReadCol = page.locator(`[data-testid="board-column-${toReadOpt.id}"]`);
    assert.ok(
      await toReadCol.locator(`[data-testid="board-card-title-${duneRow.id}"]`).count() > 0,
      'Dune should be back in "To read" column'
    );

    await screenshot(page, 'e2e-phase4-drag-no-value');
  });

  /* ================================================================ */
  /*  SC-4: Filters                                                   */
  /* ================================================================ */

  it('TC-4a: text contains filter (Author contains "weir")', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await clearAllFilters(page, 'table');
    await clearSort(page, 'table');

    // Open filter panel
    const filterBtn = page.locator(`[data-testid="view-filter-button-table"]`);
    const isExpanded = await filterBtn.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await filterBtn.click();
      await page.waitForTimeout(300);
    }

    // Wait for the filter panel to appear
    await page.waitForSelector('[data-testid="view-filter-panel-table"]', { timeout: 3000 });

    // Add Author filter
    const authorProp = db.properties.find(p => p.name === 'Author')!;
    await page.waitForSelector(`[data-testid="view-filter-add-${authorProp.id}"]`, { timeout: 3000 });
    await page.click(`[data-testid="view-filter-add-${authorProp.id}"]`);
    await page.waitForTimeout(300);

    // Set value to "weir"
    await page.locator('[data-testid="view-filter-chip-value-text"]').fill('weir');
    await page.waitForTimeout(500);

    const rows = await page.locator('.db-row').count();
    assert.equal(rows, 1, `Filter "Author contains weir" should show 1 row, got ${rows}`);

    const rowTitle = await page.locator('.db-row-title').first().textContent();
    assert.ok(rowTitle?.includes('Hail Mary'), `Should show "Project Hail Mary", got: ${rowTitle}`);

    // Case-insensitive: remove filter, add "WEIR"
    await page.locator('[data-testid="view-filter-chips-table"] [data-testid$="-remove"]').first().click();
    await page.waitForTimeout(400);

    // Reopen filter panel
    if (await filterBtn.getAttribute('aria-expanded') !== 'true') {
      await filterBtn.click();
      await page.waitForTimeout(300);
    }
    await page.waitForSelector('[data-testid="view-filter-panel-table"]', { timeout: 3000 });
    await page.click(`[data-testid="view-filter-add-${authorProp.id}"]`);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="view-filter-chip-value-text"]').fill('WEIR');
    await page.waitForTimeout(500);

    const rows2 = await page.locator('.db-row').count();
    assert.equal(rows2, 1, `Case-insensitive "WEIR" should also show 1 row, got ${rows2}`);

    await screenshot(page, 'e2e-phase4-filter-text-contains');
    await clearAllFilters(page, 'table');
  });

  it('TC-4b: select is / is_not filter', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await clearAllFilters(page, 'table');
    await clearSort(page, 'table');

    const statusProp = db.properties.find(p => p.name === 'Status')!;

    await page.click(`[data-testid="view-filter-button-table"]`);
    await page.waitForTimeout(300);
    await page.click(`[data-testid="view-filter-add-${statusProp.id}"]`);
    await page.waitForTimeout(300);

    await page.locator('[data-testid="view-filter-chip-value-select"]').selectOption({ label: 'Reading' });
    await page.waitForTimeout(500);

    const rows = await page.locator('.db-row').count();
    assert.equal(rows, 1, `Filter "Status is Reading" should show 1 row, got ${rows}`);

    // Switch to is_not
    await page.locator('[data-testid="view-filter-chip-0-op"]').selectOption('is_not');
    await page.waitForTimeout(500);

    const rowsNot = await page.locator('.db-row').count();
    assert.ok(rowsNot >= 2, `Filter "Status is not Reading" should show >= 2 rows, got ${rowsNot}`);

    await screenshot(page, 'e2e-phase4-filter-select-is');
    await clearAllFilters(page, 'table');
  });

  it('TC-4c: checkbox is_checked / is_not_checked filter (Owned)', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await clearAllFilters(page, 'table');
    await clearSort(page, 'table');

    const ownedProp = db.properties.find(p => p.name === 'Owned')!;

    await page.click(`[data-testid="view-filter-button-table"]`);
    await page.waitForTimeout(300);
    await page.click(`[data-testid="view-filter-add-${ownedProp.id}"]`);
    await page.waitForTimeout(300);

    const rowsChecked = await page.locator('.db-row').count();
    assert.ok(rowsChecked >= 1, `Filter "Owned is checked" should show >= 1 row, got ${rowsChecked}`);

    // Switch to is_not_checked
    await page.locator('[data-testid="view-filter-chip-0-op"]').selectOption('is_not_checked');
    await page.waitForTimeout(500);

    const rowsNotChecked = await page.locator('.db-row').count();
    assert.ok(rowsNotChecked >= 1, `Filter "Owned is not checked" should show >= 1 row, got ${rowsNotChecked}`);

    await screenshot(page, 'e2e-phase4-filter-checkbox');
    await clearAllFilters(page, 'table');
  });

  it('TC-4d: date before / after filter', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await clearAllFilters(page, 'table');
    await clearSort(page, 'table');

    const startedProp = db.properties.find(p => p.name === 'Started')!;

    await page.click(`[data-testid="view-filter-button-table"]`);
    await page.waitForTimeout(300);
    await page.click(`[data-testid="view-filter-add-${startedProp.id}"]`);
    await page.waitForTimeout(300);

    // Set date value
    await page.locator('[data-testid="view-filter-chip-value-date"]').evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, '2026-06-01');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    const rowsBefore = await page.locator('.db-row').count();
    assert.ok(rowsBefore >= 1, `Filter "Started before 2026-06-01" should show >= 1 row, got ${rowsBefore}`);

    // Switch to after
    await page.locator('[data-testid="view-filter-chip-0-op"]').selectOption('after');
    await page.waitForTimeout(500);

    const rowsAfter = await page.locator('.db-row').count();
    assert.ok(rowsAfter >= 1, `Filter "Started after 2026-06-01" should show >= 1 row, got ${rowsAfter}`);

    await screenshot(page, 'e2e-phase4-filter-date');
    await clearAllFilters(page, 'table');
  });

  it('TC-4e: AND semantics -- two filters narrow further', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await clearAllFilters(page, 'table');
    await clearSort(page, 'table');

    const statusProp = db.properties.find(p => p.name === 'Status')!;
    const ownedProp = db.properties.find(p => p.name === 'Owned')!;

    // Add Status = Reading
    const filterBtn = page.locator(`[data-testid="view-filter-button-table"]`);
    if (await filterBtn.getAttribute('aria-expanded') !== 'true') {
      await filterBtn.click();
      await page.waitForTimeout(300);
    }
    await page.waitForSelector('[data-testid="view-filter-panel-table"]', { timeout: 3000 });
    await page.click(`[data-testid="view-filter-add-${statusProp.id}"]`);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="view-filter-chip-value-select"]').selectOption({ label: 'Reading' });
    await page.waitForTimeout(500);

    const rowsOne = await page.locator('.db-row').count();
    assert.equal(rowsOne, 1, `Status=Reading should show 1 row`);

    // Add Owned = is_checked
    if (await filterBtn.getAttribute('aria-expanded') !== 'true') {
      await filterBtn.click();
      await page.waitForTimeout(300);
    }
    await page.waitForSelector('[data-testid="view-filter-panel-table"]', { timeout: 3000 });
    await page.click(`[data-testid="view-filter-add-${ownedProp.id}"]`);
    await page.waitForTimeout(500);

    const rowsTwo = await page.locator('.db-row').count();
    assert.ok(rowsTwo <= rowsOne, `AND should narrow: ${rowsTwo} <= ${rowsOne}`);

    await screenshot(page, 'e2e-phase4-filter-and');
    await clearAllFilters(page, 'table');
  });

  it('TC-4f: removing a filter chip restores rows', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await clearAllFilters(page, 'table');
    await clearSort(page, 'table');

    const statusProp = db.properties.find(p => p.name === 'Status')!;

    // Add Status = Finished
    await page.click(`[data-testid="view-filter-button-table"]`);
    await page.waitForTimeout(300);
    await page.click(`[data-testid="view-filter-add-${statusProp.id}"]`);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="view-filter-chip-value-select"]').selectOption({ label: 'Finished' });
    await page.waitForTimeout(500);

    const rowsFiltered = await page.locator('.db-row').count();
    assert.ok(rowsFiltered >= 1, `Should have rows with Status=Finished`);

    // Remove the filter
    await page.locator('[data-testid="view-filter-chips-table"] [data-testid$="-remove"]').first().click();
    await page.waitForTimeout(500);

    const rowsAfter = await page.locator('.db-row').count();
    assert.ok(rowsAfter > rowsFiltered, `Removing filter should restore rows: ${rowsAfter} > ${rowsFiltered}`);
    assert.ok(rowsAfter >= 4, `Should have >= 4 rows after removing filter, got ${rowsAfter}`);
  });

  it('TC-4g: filters persist after refresh', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await clearAllFilters(page, 'table');
    await clearSort(page, 'table');

    const authorProp = db.properties.find(p => p.name === 'Author')!;

    await page.click(`[data-testid="view-filter-button-table"]`);
    await page.waitForTimeout(300);
    await page.click(`[data-testid="view-filter-add-${authorProp.id}"]`);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="view-filter-chip-value-text"]').fill('Weir');
    await page.waitForTimeout(500);

    assert.equal(await page.locator('.db-row').count(), 1, 'Before refresh: 1 row');

    await page.reload();
    await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    assert.equal(await page.locator('.db-row').count(), 1, 'After refresh: filter persists, 1 row');

    const chipCount = await page.locator('[data-testid="view-filter-chips-table"] > [data-testid^="view-filter-chip-"]').count();
    assert.ok(chipCount >= 1, 'Filter chip should persist after refresh');

    await screenshot(page, 'e2e-phase4-filter-persist');
    await clearAllFilters(page, 'table');
  });

  /* ================================================================ */
  /*  SC-4 continued: Sort                                             */
  /* ================================================================ */

  it('TC-5a: sort table by Pages desc, toggle to asc', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await clearAllFilters(page, 'table');
    await clearSort(page, 'table');

    // Open sort panel
    await page.click(`[data-testid="view-sort-button-table"]`);
    await page.waitForTimeout(300);

    // Select "Pages" property and "Descending"
    await page.locator('[data-testid="view-sort-panel-property"]').selectOption({ label: 'Pages' });
    await page.locator('[data-testid="view-sort-panel-direction"]').selectOption('desc');
    await page.click(`[data-testid="view-sort-panel-apply-table"]`);
    await page.waitForTimeout(500);

    const sortText = await page.locator('[data-testid="view-sort-chip"]').textContent();
    assert.ok(sortText?.includes('Pages'), 'Sort chip should show Pages');
    assert.ok(sortText?.toLowerCase().includes('desc'), 'Sort chip should show desc');

    await screenshot(page, 'e2e-phase4-sort-pages-desc');

    // Toggle to asc
    await page.click('[data-testid="view-sort-chip-direction"]');
    await page.waitForTimeout(500);

    const sortTextAfter = await page.locator('[data-testid="view-sort-chip"]').textContent();
    assert.ok(sortTextAfter?.toLowerCase().includes('asc'), 'After toggle, sort should be asc');

    await screenshot(page, 'e2e-phase4-sort-pages-asc');
    await clearSort(page, 'table');
  });

  it('TC-5b: sort by Title works', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await clearAllFilters(page, 'table');
    await clearSort(page, 'table');

    await page.click(`[data-testid="view-sort-button-table"]`);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="view-sort-panel-property"]').selectOption('title');
    await page.locator('[data-testid="view-sort-panel-direction"]').selectOption('asc');
    await page.click(`[data-testid="view-sort-panel-apply-table"]`);
    await page.waitForTimeout(500);

    const sortText = await page.locator('[data-testid="view-sort-chip"]').textContent();
    assert.ok(sortText?.includes('Title'), 'Sort chip should show Title');

    const titles = await page.locator('.db-row-title').allTextContents();
    for (let i = 1; i < titles.length; i++) {
      assert.ok(
        titles[i - 1].localeCompare(titles[i]) <= 0,
        `Rows sorted by Title asc: "${titles[i - 1]}" <= "${titles[i]}"`
      );
    }

    await screenshot(page, 'e2e-phase4-sort-title');
    await clearSort(page, 'table');
  });

  it('TC-5c: sort persists after refresh', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await clearAllFilters(page, 'table');
    await clearSort(page, 'table');

    await page.click(`[data-testid="view-sort-button-table"]`);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="view-sort-panel-property"]').selectOption('title');
    await page.locator('[data-testid="view-sort-panel-direction"]').selectOption('desc');
    await page.click(`[data-testid="view-sort-panel-apply-table"]`);
    await page.waitForTimeout(500);

    await page.reload();
    await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    const sortText = await page.locator('[data-testid="view-sort-chip"]').textContent();
    assert.ok(sortText?.includes('Title'), 'Sort persists: Title');
    assert.ok(sortText?.toLowerCase().includes('desc'), 'Sort persists: desc');

    await screenshot(page, 'e2e-phase4-sort-persist');
    await clearSort(page, 'table');
  });

  /* ================================================================ */
  /*  SC-5: Per-view memory                                           */
  /* ================================================================ */

  it('TC-6: different filter/sort on table vs board', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await clearAllFilters(page, 'table');
    await clearSort(page, 'table');

    const authorProp = db.properties.find(p => p.name === 'Author')!;

    // TABLE: add Author contains "weir"
    await page.click(`[data-testid="view-filter-button-table"]`);
    await page.waitForTimeout(300);
    await page.click(`[data-testid="view-filter-add-${authorProp.id}"]`);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="view-filter-chip-value-text"]').fill('weir');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.db-row').count(), 1, 'Table: 1 row with Author=weir');

    // Switch to Board - should NOT have the Author filter
    await switchView(page, 'board');
    await waitForBoard(page);
    const boardCards = await page.locator('.board-card-host').count();
    assert.ok(boardCards > 1, `Board should NOT be filtered by Author, got ${boardCards} cards`);

    // BOARD: add a sort by Title
    await page.click(`[data-testid="view-sort-button-board"]`);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="view-sort-panel-property"]').selectOption('title');
    await page.locator('[data-testid="view-sort-panel-direction"]').selectOption('asc');
    await page.click(`[data-testid="view-sort-panel-apply-board"]`);
    await page.waitForTimeout(500);

    // Switch back to Table - filter should persist
    await switchView(page, 'table');
    await waitForTable(page);
    assert.equal(await page.locator('.db-row').count(), 1, 'Table filter persists after switching');

    await screenshot(page, 'e2e-phase4-per-view-memory');

    // Verify persistence after refresh
    await page.reload();
    await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 10000 });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.db-row').count(), 1, 'Table filter persists after refresh');

    await switchView(page, 'board');
    await waitForBoard(page);
    const boardSort = await page.locator('[data-testid="view-sort-chip"]').textContent();
    assert.ok(boardSort?.includes('Title'), 'Board sort persists after refresh');

    // Cleanup
    await switchView(page, 'table');
    await waitForTable(page);
    await clearAllFilters(page, 'table');
    await switchView(page, 'board');
    await waitForBoard(page);
    await clearSort(page, 'board');
  });

  it('TC-6b: board groupBy persists after refresh', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await switchView(page, 'board');
    await waitForBoard(page);

    const groupByText = await page.locator('[data-testid="view-groupby-button-board"]').textContent();
    assert.ok(groupByText?.includes('Status'), `Board should be grouped by Status, got: ${groupByText}`);

    await page.reload();
    await page.waitForSelector('[data-testid="board-view"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    const groupByTextAfter = await page.locator('[data-testid="view-groupby-button-board"]').textContent();
    assert.ok(groupByTextAfter?.includes('Status'), `After refresh, groupBy should be Status, got: ${groupByTextAfter}`);

    await screenshot(page, 'e2e-phase4-board-groupby-persist');
  });

  /* ================================================================ */
  /*  SC-6: List view                                                 */
  /* ================================================================ */

  it('TC-7: list view shows row titles and properties', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await switchView(page, 'list');
    await waitForList(page);

    const listItems = await page.locator('.list-row').count();
    assert.ok(listItems >= 4, `List should show >= 4 rows, got ${listItems}`);

    const titles = await page.locator('[data-testid^="list-row-title-"]').allTextContents();
    assert.ok(titles.length >= 4, `Should have >= 4 title links, got ${titles.length}`);

    await screenshot(page, 'e2e-phase4-list-view');
  });

  it('TC-7b: list view respects its own filter/sort', async () => {
    await openDatabase(page, baseUrl(), readingListId);
    await switchView(page, 'list');
    await waitForList(page);

    // List has seeded sort: title asc
    const titles = await page.locator('[data-testid^="list-row-title-"]').allTextContents();
    for (let i = 1; i < titles.length; i++) {
      assert.ok(
        titles[i - 1].localeCompare(titles[i]) <= 0,
        `List sorted by title asc: "${titles[i - 1]}" <= "${titles[i]}"`
      );
    }

    // Add a filter on list
    await page.click(`[data-testid="view-filter-button-list"]`);
    await page.waitForTimeout(300);
    const authorProp = db.properties.find(p => p.name === 'Author')!;
    await page.click(`[data-testid="view-filter-add-${authorProp.id}"]`);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="view-filter-chip-value-text"]').fill('weir');
    await page.waitForTimeout(500);

    const filteredCount = await page.locator('.list-row').count();
    assert.equal(filteredCount, 1, 'List filter should narrow to 1 row');

    await screenshot(page, 'e2e-phase4-list-filtered');

    // Switch to table - should NOT have this filter
    await switchView(page, 'table');
    await waitForTable(page);
    const tableRows = await page.locator('.db-row').count();
    assert.ok(tableRows > 1, `Table should not be affected by list filter, got ${tableRows} rows`);

    // Cleanup list filter
    await switchView(page, 'list');
    await waitForList(page);
    await clearAllFilters(page, 'list');
  });
});
