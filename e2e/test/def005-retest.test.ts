/**
 * DEF-005 retest -- Filter value control renders blank on persisted option-id filters.
 *
 * Root cause: seed resolves filter values to option IDs (e.g. "opt-abc") but the
 * FilterChipValue select used value={o.label} (e.g. "Abandoned").  Since the stored
 * ID doesn't match any label, the select rendered empty.
 *
 * Fix: filter value control now uses option ids for its option values so persisted
 * option-id filters render their label selected.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type Page } from 'playwright';
import { startServer, cleanupDb, type ServerHandle } from '../helpers/server.js';
import { getBrowser, screenshot, closeBrowser } from '../helpers/browser.js';

interface TreePage { id: string; parentId: string | null; title: string; icon: string | null; kind: string; position: number; }
interface PropertyOption { id: string; label: string; color: string; }
interface Property { id: string; databaseId: string; name: string; type: string; options: PropertyOption[] | null; position: number; }
interface RowPage { id: string; parentId: string; title: string; kind: string; values: Record<string, unknown>; }
interface ViewSettings { filters?: { propertyId: string; op: string; value?: unknown }[]; sort?: { propertyId: string; direction: 'asc' | 'desc' } | null; groupBy?: string | null; }
interface DatabaseResponse { page: TreePage; properties: Property[]; rows: RowPage[]; views: { table: ViewSettings; board: ViewSettings; list: ViewSettings }; }

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

async function openDatabase(page: Page, base: string, id: string) {
  await page.goto(`${base}/page/${id}`);
  await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const isTableActive = await page.locator('[data-testid="db-view-tab-table"]').getAttribute('aria-selected');
  if (isTableActive !== 'true') {
    await page.click('[data-testid="db-view-tab-table"]');
    await page.waitForTimeout(500);
  }
  await waitForTable(page);
}

describe('DEF-005 retest -- filter value control shows persisted option id', () => {
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

  it('TC-1: seeded Status filter value control shows "Abandoned"', async () => {
    await openDatabase(page, baseUrl(), readingListId);

    // The seeded table has Status is_not "Abandoned" filter.
    const chipCount = await page.locator('[data-testid="view-filter-chips-table"] > [data-testid^="view-filter-chip-"]').count();
    assert.ok(chipCount >= 1, 'Seeded table should have at least 1 filter chip');

    const firstChip = page.locator('[data-testid="view-filter-chips-table"] > [data-testid^="view-filter-chip-"]').first();
    const chipText = await firstChip.textContent();
    assert.ok(chipText?.includes('Status'), `Filter chip should show "Status", got: ${chipText}`);

    // Check the value select control shows "Abandoned" selected.
    const valueSelect = page.locator('[data-testid="view-filter-chip-value-select"]');
    const selectCount = await valueSelect.count();
    assert.ok(selectCount > 0, 'Filter value select should exist');

    const selectedText = await valueSelect.locator('option:checked').textContent();
    console.log(`Filter value select: selectedText="${selectedText}"`);
    assert.ok(
      selectedText?.includes('Abandoned'),
      `Filter value should show "Abandoned", got: "${selectedText}"`
    );

    await screenshot(page, 'def005-retest-seeded-filter');
  });

  it('TC-2: changing filter value PATCHes the option ID and narrows correctly', async () => {
    await openDatabase(page, baseUrl(), readingListId);

    // Change the value from Abandoned to Reading via the select control.
    const valueSelect = page.locator('[data-testid="view-filter-chip-value-select"]');
    await valueSelect.selectOption({ label: 'Reading' });
    await page.waitForTimeout(500);

    // Verify PATCH was sent by checking the API.
    const freshDb = await getDatabase(baseUrl(), readingListId);
    const tableFilters = freshDb.views.table.filters ?? [];
    assert.ok(tableFilters.length >= 1, 'Table should still have at least 1 filter');
    const statusFilter = tableFilters.find(f => f.op === 'is_not');
    assert.ok(statusFilter, 'Should have is_not filter on Status');

    const statusProp = db.properties.find(p => p.name === 'Status')!;
    const readingOpt = statusProp.options!.find(o => o.label === 'Reading')!;
    assert.equal(
      statusFilter!.value,
      readingOpt.id,
      `Filter value should be the option ID for Reading, got: ${statusFilter!.value}`
    );

    // The filter narrows: only non-Reading rows should show (Sapiens=Abandoned, others=To read/Finished).
    const titles = await page.locator('.db-row-title').allTextContents();
    assert.ok(!titles.some(t => t.includes('Hail Mary')), `Should NOT show Hail Mary (Status=Reading). Got: ${titles}`);
    assert.ok(titles.some(t => t.includes('Dune')), 'Should show Dune (Status=To read)');

    await screenshot(page, 'def005-retest-change-value');
  });

  it('TC-3: text-contains and date filters still work alongside select filter', async () => {
    await openDatabase(page, baseUrl(), readingListId);

    // Clear existing filter first
    const removeBtn = page.locator('[data-testid="view-filter-chips-table"] [data-testid$="-remove"]').first();
    if (await removeBtn.count() > 0) {
      await removeBtn.click();
      await page.waitForTimeout(400);
    }

    // Add Author text-contains filter
    const filterBtn = page.locator('[data-testid="view-filter-button-table"]');
    if (await filterBtn.getAttribute('aria-expanded') !== 'true') {
      await filterBtn.click();
      await page.waitForTimeout(300);
    }
    await page.waitForSelector('[data-testid="view-filter-panel-table"]', { timeout: 3000 });

    const authorProp = db.properties.find(p => p.name === 'Author')!;
    await page.click(`[data-testid="view-filter-add-${authorProp.id}"]`);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="view-filter-chip-value-text"]').fill('weir');
    await page.waitForTimeout(500);

    const rowsText = await page.locator('.db-row').count();
    assert.equal(rowsText, 1, `Author contains "weir" should show 1 row, got ${rowsText}`);

    // Remove text filter and add date filter
    await page.locator('[data-testid="view-filter-chips-table"] [data-testid$="-remove"]').first().click();
    await page.waitForTimeout(400);

    if (await filterBtn.getAttribute('aria-expanded') !== 'true') {
      await filterBtn.click();
      await page.waitForTimeout(300);
    }
    await page.waitForSelector('[data-testid="view-filter-panel-table"]', { timeout: 3000 });

    const startedProp = db.properties.find(p => p.name === 'Started')!;
    await page.click(`[data-testid="view-filter-add-${startedProp.id}"]`);
    await page.waitForTimeout(300);

    await page.locator('[data-testid="view-filter-chip-value-date"]').evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, '2026-06-01');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    const rowsDate = await page.locator('.db-row').count();
    assert.ok(rowsDate >= 1, `Date before 2026-06-01 should show >= 1 row, got ${rowsDate}`);

    await screenshot(page, 'def005-retest-date-filter');
    // Cleanup
    await page.locator('[data-testid="view-filter-chips-table"] [data-testid$="-remove"]').first().click();
    await page.waitForTimeout(400);
  });

  it('TC-4: filters persist after refresh', async () => {
    await openDatabase(page, baseUrl(), readingListId);

    // Add a Status = Reading filter
    const filterBtn = page.locator('[data-testid="view-filter-button-table"]');
    if (await filterBtn.getAttribute('aria-expanded') !== 'true') {
      await filterBtn.click();
      await page.waitForTimeout(300);
    }
    await page.waitForSelector('[data-testid="view-filter-panel-table"]', { timeout: 3000 });

    const statusProp = db.properties.find(p => p.name === 'Status')!;
    await page.click(`[data-testid="view-filter-add-${statusProp.id}"]`);
    await page.waitForTimeout(300);
    await page.locator('[data-testid="view-filter-chip-value-select"]').selectOption({ label: 'Reading' });
    await page.waitForTimeout(500);

    const rowsBefore = await page.locator('.db-row').count();
    assert.equal(rowsBefore, 1, 'Before refresh: 1 row with Status=Reading');

    await page.reload();
    await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    const rowsAfter = await page.locator('.db-row').count();
    assert.equal(rowsAfter, 1, 'After refresh: filter persists, 1 row');

    // The value select should still show Reading.
    const valueSelect = page.locator('[data-testid="view-filter-chip-value-select"]');
    const selectedText = await valueSelect.locator('option:checked').textContent();
    assert.ok(
      selectedText?.includes('Reading'),
      `After refresh, filter value should show "Reading", got: "${selectedText}"`
    );

    await screenshot(page, 'def005-retest-persist');
  });
});
