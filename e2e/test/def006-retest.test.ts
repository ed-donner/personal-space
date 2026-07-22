/**
 * DEF-006 retest -- Filter referencing deleted property shows "Unknown" label.
 *
 * Fix: DELETE /api/properties/:id now removes filters referencing the deleted
 * property from every view settings of that database, inside the same transaction.
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

describe('DEF-006 retest -- filter removed when property deleted', () => {
  let server: ServerHandle;
  let page: Page;
  let renovationId: string;
  let renovationDb: DatabaseResponse;
  const baseUrl = () => `http://localhost:${server.port}`;

  before(async () => {
    server = await startServer();
    await server.waitForReady();
    const browser = await getBrowser();
    page = await browser.newPage();
    renovationId = await findPageByTitle(baseUrl(), 'Renovation Tasks');
    renovationDb = await getDatabase(baseUrl(), renovationId);
  });

  after(async () => {
    try { await page?.close(); } catch { /* ignore */ }
    try { await closeBrowser(); } catch { /* ignore */ }
    try { await server?.kill(); } catch { /* ignore */ }
    try { cleanupDb(server?.dbPath ?? ''); } catch { /* ignore */ }
  });

  it('TC-1: filter on property, delete property, filter is gone from settings (API)', async () => {
    const notesProp = renovationDb.properties.find(p => p.name === 'Notes')!;

    // Verify initial table view has a Done is_not_checked filter.
    const db0 = await getDatabase(baseUrl(), renovationId);
    const tableFilters0 = db0.views.table.filters ?? [];
    assert.ok(tableFilters0.length >= 1, 'Table should have at least the seeded Done filter');

    // Add a filter on Notes containing "sign-off" via API.
    const patchedFilters = [...tableFilters0, { propertyId: notesProp.id, op: 'contains', value: 'sign-off' }];
    const patchRes = await fetch(`${baseUrl()}/api/databases/${renovationId}/views/table`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { filters: patchedFilters } }),
    });
    assert.ok(patchRes.ok, `PATCH should succeed, got ${patchRes.status}`);

    // Verify the Notes filter is now in settings.
    const db1 = await getDatabase(baseUrl(), renovationId);
    const tableFilters1 = db1.views.table.filters ?? [];
    const notesFilter = tableFilters1.find(f => f.propertyId === notesProp.id);
    assert.ok(notesFilter, 'Notes filter should be in settings after adding');

    // Delete the Notes property via API.
    const delRes = await fetch(`${baseUrl()}/api/properties/${notesProp.id}`, { method: 'DELETE' });
    assert.ok(delRes.ok, `DELETE property should succeed, got ${delRes.status}`);

    // Verify: the Notes filter is GONE from settings.
    const db2 = await getDatabase(baseUrl(), renovationId);
    const tableFilters2 = db2.views.table.filters ?? [];
    const orphanedFilter = tableFilters2.find(f => f.propertyId === notesProp.id);
    assert.ok(!orphanedFilter, `No filter should reference deleted Notes property. Filters: ${JSON.stringify(tableFilters2)}`);

    // Verify: the Done filter SURVIVES.
    const doneProp = renovationDb.properties.find(p => p.name === 'Done')!;
    const doneFilter = tableFilters2.find(f => f.propertyId === doneProp.id);
    assert.ok(doneFilter, 'Done is_not_checked filter should survive property delete');

    await screenshot(page, 'def006-retest-api-filter-gone');
  });

  it('TC-2: UI shows no broken chip after property delete, filter chip for deleted property gone', async () => {
    await openDatabase(page, baseUrl(), renovationId);

    // Reload to pick up the settings change from TC-1.
    await page.reload();
    await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    // The table had the Done filter (seeded) + Notes filter (added in TC-1).
    // After deleting Notes, only the Done filter should remain.
    const chipCount = await page.locator('[data-testid="view-filter-chips-table"] > [data-testid^="view-filter-chip-"]').count();
    assert.equal(chipCount, 1, `Only Done filter chip should remain, got ${chipCount}`);

    // Verify the surviving chip is for Done (not Notes).
    const chipText = await page.locator('[data-testid="view-filter-chips-table"] > [data-testid^="view-filter-chip-"]').first().textContent();
    assert.ok(chipText?.includes('Done'), `Surviving chip should reference Done, got: ${chipText}`);
    assert.ok(!chipText?.includes('Notes'), `No chip should reference deleted Notes, got: ${chipText}`);

    // All rows should be shown (Done is_not_checked hides 1 row: "Paint the living room").
    const rowsAfter = await page.locator('.db-row').count();
    assert.equal(rowsAfter, renovationDb.rows.length - 1, `All rows except Done=true should show, got ${rowsAfter}`);

    await screenshot(page, 'def006-retest-ui-no-broken-chip');
  });

  it('TC-3: no console errors after property deletion', async () => {
    await openDatabase(page, baseUrl(), renovationId);

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.reload();
    await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 10000 });
    await page.waitForTimeout(1000);

    assert.equal(consoleErrors.length, 0, `No console errors expected, got: ${JSON.stringify(consoleErrors)}`);
  });
});
