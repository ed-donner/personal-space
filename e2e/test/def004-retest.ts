/**
 * DEF-004 retest -- orphaned select values stripped when option removed.
 *
 * Steps (from DEFECTS.md):
 * 1. Create a test database via API.
 * 2. Add a select property with options.
 * 3. Create a row and set its select value.
 * 4. PATCH the property to remove that option.
 * 5. Verify the row's value key is stripped.
 *
 * Expected: After option removal, select key removed, multi_select filtered,
 * cell renders "Empty" without errors.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type Page } from 'playwright';
import { startServer, cleanupDb, type ServerHandle } from '../helpers/server.js';
import { getBrowser, screenshot, closeBrowser } from '../helpers/browser.js';

interface Property {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  options: { id: string; label: string; color: string }[] | null;
  position: number;
}

interface DatabaseResponse {
  page: { id: string; title: string; kind: string };
  properties: Property[];
  rows: { id: string; parentId: string; title: string; kind: string; values: Record<string, unknown> }[];
}

describe('DEF-004 retest -- orphaned select values', () => {
  let server: ServerHandle;
  let page: Page;
  const baseUrl = () => `http://localhost:${server.port}`;

  before(async () => {
    server = await startServer();
    await server.waitForReady();
    const browser = await getBrowser();
    page = await browser.newPage();
  });

  after(async () => {
    try { await page?.close(); } catch { /* ignore */ }
    try { await closeBrowser(); } catch { /* ignore */ }
    try { await server?.kill(); } catch { /* ignore */ }
    try { cleanupDb(server?.dbPath ?? ''); } catch { /* ignore */ }
  });

  it('select: orphaned option id is stripped from row when option removed via API', async () => {
    // 1. Create a test database
    const dbRes = await fetch(`${baseUrl()}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'DEF004 Test DB', kind: 'database' }),
    });
    assert.ok(dbRes.ok, 'Should create test database');
    const dbPage = await dbRes.json();

    // 2. Add a select property with two options
    const propRes = await fetch(`${baseUrl()}/api/databases/${dbPage.id}/properties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Task Status',
        type: 'select',
        options: [
          { label: 'Draft', color: '#8a8f98' },
          { label: 'Ready', color: '#3d9a50' },
        ],
      }),
    });
    assert.ok(propRes.ok, 'Should create property');
    const prop: Property = await propRes.json();
    const draftOpt = prop.options!.find((o) => o.label === 'Draft')!;
    const readyOpt = prop.options!.find((o) => o.label === 'Ready')!;

    // 3. Create a row and set Task Status to "Draft"
    const rowRes = await fetch(`${baseUrl()}/api/databases/${dbPage.id}/rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test Row' }),
    });
    assert.ok(rowRes.ok, 'Should create row');
    const row = await rowRes.json();

    const patchRowRes = await fetch(`${baseUrl()}/api/rows/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { [prop.id]: draftOpt.id } }),
    });
    assert.ok(patchRowRes.ok, 'Should set row value');

    // Verify value is set
    const db1: DatabaseResponse = await (await fetch(`${baseUrl()}/api/databases/${dbPage.id}`)).json();
    const r1 = db1.rows.find((r) => r.id === row.id)!;
    assert.equal(r1.values[prop.id], draftOpt.id, 'Row should have Draft value');

    // 4. PATCH property to remove "Draft" option (keep only "Ready")
    const patchPropRes = await fetch(`${baseUrl()}/api/properties/${prop.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        options: [{ id: readyOpt.id, label: 'Ready', color: '#3d9a50' }],
      }),
    });
    assert.ok(patchPropRes.ok, 'Should update property options');

    // 5. Verify row's select value key is stripped
    const db2: DatabaseResponse = await (await fetch(`${baseUrl()}/api/databases/${dbPage.id}`)).json();
    const r2 = db2.rows.find((r) => r.id === row.id)!;
    assert.ok(
      !(prop.id in r2.values),
      `Row should NOT have a value for the removed option. Values: ${JSON.stringify(r2.values)}`
    );

    // 6. Navigate to the database and verify cell shows "Empty"
    await page.goto(`${baseUrl()}/page/${dbPage.id}`);
    await page.waitForSelector('[data-testid="db-table"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    const emptyCell = page.locator(`[data-testid="cell-select-${row.id}-${prop.id}"]`);
    const cellText = await emptyCell.textContent();
    assert.ok(
      cellText?.includes('Empty'),
      `Cell should render "Empty" for orphaned value, got: ${cellText}`
    );

    await screenshot(page, 'def-004-retest-select');
  });

  it('multi_select: orphaned option ids are filtered, surviving options kept', async () => {
    // 1. Create a test database
    const dbRes = await fetch(`${baseUrl()}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'DEF004 Multi DB', kind: 'database' }),
    });
    assert.ok(dbRes.ok);
    const dbPage = await dbRes.json();

    // 2. Add a multi_select property with three options
    const propRes = await fetch(`${baseUrl()}/api/databases/${dbPage.id}/properties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tags',
        type: 'multi_select',
        options: [
          { label: 'Alpha', color: '#ecad0a' },
          { label: 'Beta', color: '#209dd7' },
          { label: 'Gamma', color: '#753991' },
        ],
      }),
    });
    assert.ok(propRes.ok);
    const prop: Property = await propRes.json();
    const alphaOpt = prop.options!.find((o) => o.label === 'Alpha')!;
    const betaOpt = prop.options!.find((o) => o.label === 'Beta')!;
    const gammaOpt = prop.options!.find((o) => o.label === 'Gamma')!;

    // 3. Create a row with Alpha + Beta selected
    const rowRes = await fetch(`${baseUrl()}/api/databases/${dbPage.id}/rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Multi Row' }),
    });
    assert.ok(rowRes.ok);
    const row = await rowRes.json();

    await fetch(`${baseUrl()}/api/rows/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { [prop.id]: [alphaOpt.id, betaOpt.id] } }),
    });

    // 4. Remove "Alpha" option via PATCH (keep Beta + Gamma)
    await fetch(`${baseUrl()}/api/properties/${prop.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        options: [
          { id: betaOpt.id, label: 'Beta', color: '#209dd7' },
          { id: gammaOpt.id, label: 'Gamma', color: '#753991' },
        ],
      }),
    });

    // 5. Verify: Alpha removed, Beta kept
    const db2: DatabaseResponse = await (await fetch(`${baseUrl()}/api/databases/${dbPage.id}`)).json();
    const r2 = db2.rows.find((r) => r.id === row.id)!;
    const multiVal = r2.values[prop.id] as string[];
    assert.ok(Array.isArray(multiVal), 'Value should still be an array');
    assert.ok(!multiVal.includes(alphaOpt.id), 'Alpha should be removed from multi_select');
    assert.ok(multiVal.includes(betaOpt.id), 'Beta should survive');
    assert.equal(multiVal.length, 1, `Should have 1 option left, got ${multiVal.length}`);

    // 6. Navigate and verify cell
    await page.goto(`${baseUrl()}/page/${dbPage.id}`);
    await page.waitForSelector('[data-testid="db-table"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    const multiCell = page.locator(`[data-testid="cell-multi-${row.id}-${prop.id}"]`);
    const cellText = await multiCell.textContent();
    assert.ok(cellText?.includes('Beta'), `Cell should show Beta, got: ${cellText}`);
    assert.ok(!cellText?.includes('Alpha'), `Cell should NOT show Alpha, got: ${cellText}`);

    await screenshot(page, 'def-004-retest-multiselect');
  });
});
