/**
 * DEF-007 retest -- Sort referencing deleted property stays in persisted settings.
 *
 * Fix: DELETE /api/properties/:id now nulls sort and groupBy when they reference
 * the deleted property, inside the same transaction; other properties' settings
 * untouched.
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

describe('DEF-007 retest -- sort/groupBy nullified when property deleted', () => {
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

  it('TC-1: sort on Priority, delete Priority, sort nulled in settings', async () => {
    const priorityProp = renovationDb.properties.find(p => p.name === 'Priority')!;

    // Set list view sort to Priority desc via API.
    const patchRes = await fetch(`${baseUrl()}/api/databases/${renovationId}/views/list`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { sort: { propertyId: priorityProp.id, direction: 'desc' } } }),
    });
    assert.ok(patchRes.ok, `PATCH view settings should succeed, got ${patchRes.status}`);

    // Verify sort is set.
    const db1 = await getDatabase(baseUrl(), renovationId);
    const listSort1 = db1.views.list.sort;
    assert.ok(listSort1, 'List view should have sort');
    assert.equal(listSort1!.propertyId, priorityProp.id, 'Sort should reference Priority');

    // Delete the Priority property.
    const delRes = await fetch(`${baseUrl()}/api/properties/${priorityProp.id}`, { method: 'DELETE' });
    assert.ok(delRes.ok, `DELETE property should succeed, got ${delRes.status}`);

    // Verify sort is nulled.
    const db2 = await getDatabase(baseUrl(), renovationId);
    const listSort2 = db2.views.list.sort;
    assert.ok(!listSort2, `List view sort should be null after property delete, got: ${JSON.stringify(listSort2)}`);

    // Reload and verify no broken sort chip in list view.
    await openDatabase(page, baseUrl(), renovationId);
    await page.click('[data-testid="db-view-tab-list"]');
    await page.waitForTimeout(500);

    const sortChipCount = await page.locator('[data-testid="view-sort-chips-list"] [data-testid="view-sort-chip"]').count();
    assert.equal(sortChipCount, 0, `No sort chip should render after sort nulled, got ${sortChipCount}`);

    await screenshot(page, 'def007-retest-sort-gone');
  });

  it('TC-2: groupBy on Room, delete Room, groupBy nulled in settings (API)', async () => {
    const roomProp = renovationDb.properties.find(p => p.name === 'Room')!;

    // Set board groupBy to Room via API.
    const patchRes = await fetch(`${baseUrl()}/api/databases/${renovationId}/views/board`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { groupBy: roomProp.id } }),
    });
    assert.ok(patchRes.ok, `PATCH view settings should succeed, got ${patchRes.status}`);

    // Verify groupBy is set.
    const db1 = await getDatabase(baseUrl(), renovationId);
    assert.equal(db1.views.board.groupBy, roomProp.id, 'Board groupBy should reference Room');

    // Delete the Room property.
    const delRes = await fetch(`${baseUrl()}/api/properties/${roomProp.id}`, { method: 'DELETE' });
    assert.ok(delRes.ok, `DELETE property should succeed, got ${delRes.status}`);

    // Verify groupBy is nulled.
    const db2 = await getDatabase(baseUrl(), renovationId);
    assert.ok(!db2.views.board.groupBy, `Board groupBy should be null after property delete, got: ${JSON.stringify(db2.views.board.groupBy)}`);

    await screenshot(page, 'def007-retest-groupby-api-nulled');
  });

  it('TC-3: sort/groupBy on other properties survive after deleting a different property', async () => {
    // Use the freshly seeded database (new server in before()).
    // Set table sort to Done (checkbox), board groupBy to Status (select - but Status was not deleted).
    // Wait - we need to check what properties are left. Room and Priority were deleted in TC-1/TC-2.
    // Use properties that still exist.
    const doneProp = renovationDb.properties.find(p => p.name === 'Done')!;
    const targetDateProp = renovationDb.properties.find(p => p.name === 'Target date')!;

    // Set table sort to Done, list sort to Target date.
    await fetch(`${baseUrl()}/api/databases/${renovationId}/views/table`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { sort: { propertyId: doneProp.id, direction: 'asc' } } }),
    });
    await fetch(`${baseUrl()}/api/databases/${renovationId}/views/list`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { sort: { propertyId: targetDateProp.id, direction: 'desc' } } }),
    });

    // Create and delete a temp property.
    const createRes = await fetch(`${baseUrl()}/api/databases/${renovationId}/properties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'TempSort', type: 'text' }),
    });
    const tempProp = (await createRes.json()) as Property;
    await fetch(`${baseUrl()}/api/properties/${tempProp.id}`, { method: 'DELETE' });

    // Verify sort on Done survived.
    const db = await getDatabase(baseUrl(), renovationId);
    assert.ok(db.views.table.sort, 'Table sort should survive');
    assert.equal(db.views.table.sort!.propertyId, doneProp.id, 'Sort should still reference Done');

    // Verify sort on Target date survived.
    assert.ok(db.views.list.sort, 'List sort should survive');
    assert.equal(db.views.list.sort!.propertyId, targetDateProp.id, 'List sort should still reference Target date');

    // Reload and verify UI.
    await openDatabase(page, baseUrl(), renovationId);

    const sortText = await page.locator('[data-testid="view-sort-chip"]').textContent();
    assert.ok(sortText?.includes('Done'), `Sort chip should show Done, got: ${sortText}`);

    await screenshot(page, 'def007-retest-other-survive');
  });
});
