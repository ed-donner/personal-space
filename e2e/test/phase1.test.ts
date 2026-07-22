import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type Page } from 'playwright';
import { startServer, cleanupDb, type ServerHandle } from '../helpers/server.js';
import { getBrowser, screenshot, closeBrowser } from '../helpers/browser.js';

/**
 * Wait for the sidebar tree to have at least one page row loaded.
 * The nav element exists immediately but tree data loads async.
 */
async function waitForTree(page: Page) {
  await page.waitForSelector('[data-testid^="page-row-"]', { timeout: 10000 });
  // Give React a tick to finish rendering all rows
  await page.waitForTimeout(300);
}

describe('Phase 1 -- Pages and sidebar (e2e)', () => {
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
    // Force exit -- the Node test runner hangs on pending promises from
    // Playwright's browser close or the server's child process.
    process.exit(0);
  });

  // ---- TC-1: sidebar shows seeded tree with emoji icons (SC-1) ----
  it('TC-1: sidebar shows the seeded tree with emoji icons', async () => {
    await page.goto(baseUrl());
    await waitForTree(page);

    // Spot-check top-level pages in the tree
    const body = await page.textContent('nav[aria-label="Pages"]') ?? '';

    const expectedTopLevel = [
      { title: 'Projects', icon: '\u{1F4CB}' },
      { title: 'Travel', icon: '\u2708\uFE0F' },
      { title: 'Journal', icon: '\u{1F4D3}' },
      { title: 'Reading', icon: '\u{1F4DA}' },
    ];

    for (const { title } of expectedTopLevel) {
      assert.ok(
        body.includes(title),
        `Sidebar should contain seeded page "${title}"`
      );
    }

    // Check emoji icons are rendered in the DOM (inside .tree-icon spans)
    const icons = await page.locator('.tree-icon').allTextContents();
    for (const expected of expectedTopLevel) {
      assert.ok(
        icons.some((t) => t.includes(expected.icon)),
        `Sidebar should show emoji icon "${expected.icon}" for "${expected.title}"`
      );
    }

    // defaultExpandedIds opens roots + their immediate children, so:
    // Projects -> Home Renovation, Work  (visible)
    // Travel -> Japan 2027                (visible)
    // Journal -> 2026                     (visible)
    // Reading (leaf)                      (visible)
    const expandedBody = await page.textContent('nav[aria-label="Pages"]') ?? '';
    for (const child of ['Home Renovation', 'Work', 'Japan 2027', '2026']) {
      assert.ok(
        expandedBody.includes(child),
        `Sidebar should contain "${child}" (default expanded)`
      );
    }

    await screenshot(page, 'e2e-phase1-seeded-sidebar');
  });

  // ---- TC-2: create a new page (SC-5) ----
  it('TC-2: create a new page from the sidebar', async () => {
    await page.goto(baseUrl());
    await waitForTree(page);

    // Record current URL so we can detect navigation to the new page
    const urlBefore = page.url();

    const newPageBtn = page.locator('[data-testid="new-page-top"]');
    await newPageBtn.click();

    // Wait for the URL to change to a /page/ path different from the current one
    await page.waitForFunction(
      (prevUrl: string) => {
        return (
          window.location.pathname.startsWith('/page/') &&
          window.location.href !== prevUrl
        );
      },
      urlBefore,
      { timeout: 10000 }
    );

    // The page title should say "Untitled" (default)
    const titleEl = page.locator('[data-testid="page-title"]');
    await titleEl.waitFor({ state: 'visible', timeout: 5000 });
    const titleText = await titleEl.textContent();
    assert.equal(titleText, 'Untitled', 'New page should have default title "Untitled"');

    // The new page should appear in the sidebar
    const sidebarText = await page.textContent('nav[aria-label="Pages"]') ?? '';
    assert.ok(
      sidebarText.includes('Untitled'),
      'New "Untitled" page should appear in the sidebar tree'
    );

    await screenshot(page, 'e2e-phase1-created-page');
  });

  // ---- TC-3: rename a page from the sidebar (SC-2) ----
  it('TC-3: rename a page from the sidebar', async () => {
    await page.goto(baseUrl());
    await waitForTree(page);

    // Create a fresh page to rename
    const urlBefore = page.url();
    const newPageBtn = page.locator('[data-testid="new-page-top"]');
    await newPageBtn.click();
    await page.waitForFunction(
      (prevUrl: string) =>
        window.location.pathname.startsWith('/page/') &&
        window.location.href !== prevUrl,
      urlBefore,
      { timeout: 10000 }
    );
    await page.waitForTimeout(500);

    // Get the page id from the URL
    const pageId = page.url().split('/page/')[1];
    assert.ok(pageId, 'Should have a page id in the URL');

    // The row for the new page should be the active row (is-active class)
    // Actions are visible on .is-active rows -- no need to hover.
    const renameBtn = page.locator(`[data-testid="rename-${pageId}"]`);
    await renameBtn.click({ timeout: 5000 });

    // The rename input should appear
    const renameInput = page.locator(`[data-testid="rename-input-${pageId}"]`);
    await renameInput.waitFor({ state: 'visible', timeout: 3000 });

    // Clear and type a new name
    await renameInput.fill('My Renamed Page');
    await renameInput.press('Enter');

    // Wait for the rename to commit and tree to refresh
    await page.waitForTimeout(800);

    // Verify the new title shows in the sidebar tree
    const sidebarText = await page.textContent('nav[aria-label="Pages"]') ?? '';
    assert.ok(
      sidebarText.includes('My Renamed Page'),
      'Renamed title should appear in sidebar'
    );

    // Verify the page header shows the new title
    const headerTitle = await page.locator('[data-testid="page-title"]').textContent();
    assert.equal(
      headerTitle,
      'My Renamed Page',
      'Page header should show the renamed title'
    );
  });

  // ---- TC-4: delete with confirmation and cascade (SC-2) ----
  it('TC-4: delete a page with children shows confirmation and removes them', async () => {
    await page.goto(baseUrl());
    await waitForTree(page);

    // Create a parent page
    const urlBefore = page.url();
    const newPageBtn = page.locator('[data-testid="new-page-top"]');
    await newPageBtn.click();
    await page.waitForFunction(
      (prevUrl: string) =>
        window.location.pathname.startsWith('/page/') &&
        window.location.href !== prevUrl,
      urlBefore,
      { timeout: 10000 }
    );
    const parentId = page.url().split('/page/')[1];

    // Rename it (row is active so actions are visible)
    const renameBtn = page.locator(`[data-testid="rename-${parentId}"]`);
    await renameBtn.click({ timeout: 5000 });
    const renameInput = page.locator(`[data-testid="rename-input-${parentId}"]`);
    await renameInput.waitFor({ state: 'visible', timeout: 3000 });
    await renameInput.fill('Parent To Delete');
    await renameInput.press('Enter');
    await page.waitForTimeout(800);

    // Create a child page under it
    const addChildBtn = page.locator(`[data-testid="add-child-${parentId}"]`);
    // The parent row should now be active; actions visible.
    await addChildBtn.click({ timeout: 5000 });

    // Wait for navigation to the new child page
    await page.waitForFunction(
      (prevId: string) => {
        return (
          window.location.pathname.startsWith('/page/') &&
          !window.location.pathname.endsWith('/' + prevId)
        );
      },
      parentId,
      { timeout: 10000 }
    );
    const childId = page.url().split('/page/')[1];

    // Rename the child
    const childRenameBtn = page.locator(`[data-testid="rename-${childId}"]`);
    await childRenameBtn.click({ timeout: 5000 });
    const childRenameInput = page.locator(`[data-testid="rename-input-${childId}"]`);
    await childRenameInput.waitFor({ state: 'visible', timeout: 3000 });
    await childRenameInput.fill('Child To Delete');
    await childRenameInput.press('Enter');
    await page.waitForTimeout(800);

    // Verify both appear in sidebar
    let sidebarText = await page.textContent('nav[aria-label="Pages"]') ?? '';
    assert.ok(sidebarText.includes('Parent To Delete'), 'Parent should be in sidebar');
    assert.ok(sidebarText.includes('Child To Delete'), 'Child should be in sidebar');

    // Click delete on the parent. The parent row may not be active,
    // so hover first to reveal the action buttons.
    const parentRow = page.locator(`[data-testid="page-row-${parentId}"]`);
    await parentRow.hover();
    await page.waitForTimeout(200);
    const deleteBtn = page.locator(`[data-testid="delete-${parentId}"]`);
    await deleteBtn.click({ timeout: 5000 });

    // Confirmation modal should appear naming the page
    const modal = page.locator('[role="dialog"]');
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    const modalText = await modal.textContent() ?? '';
    assert.ok(
      modalText.includes('Parent To Delete'),
      'Modal should name the page being deleted'
    );
    assert.ok(
      modalText.includes('nested') || modalText.includes('also deleted'),
      'Modal should warn about nested pages being deleted'
    );

    await screenshot(page, 'e2e-phase1-delete-modal');

    // Confirm deletion
    const confirmBtn = page.locator('[data-testid="confirm-delete"]');
    await confirmBtn.click();

    // Wait for modal to close and sidebar to update
    await page.waitForFunction(
      () => !document.querySelector('[role="dialog"]'),
      { timeout: 5000 }
    );
    await page.waitForTimeout(500);

    // Verify both parent and child are gone
    sidebarText = await page.textContent('nav[aria-label="Pages"]') ?? '';
    assert.ok(
      !sidebarText.includes('Parent To Delete'),
      'Parent should be removed from sidebar'
    );
    assert.ok(
      !sidebarText.includes('Child To Delete'),
      'Child should be removed from sidebar (cascade)'
    );
  });

  // ---- TC-5: changes survive browser refresh (SC-3) ----
  it('TC-5: changes survive a browser refresh', async () => {
    await page.goto(baseUrl());
    await waitForTree(page);

    // Create and rename a page
    const urlBefore = page.url();
    const newPageBtn = page.locator('[data-testid="new-page-top"]');
    await newPageBtn.click();
    await page.waitForFunction(
      (prevUrl: string) =>
        window.location.pathname.startsWith('/page/') &&
        window.location.href !== prevUrl,
      urlBefore,
      { timeout: 10000 }
    );
    const pageId = page.url().split('/page/')[1];

    const renameBtn = page.locator(`[data-testid="rename-${pageId}"]`);
    await renameBtn.click({ timeout: 5000 });
    const renameInput = page.locator(`[data-testid="rename-input-${pageId}"]`);
    await renameInput.waitFor({ state: 'visible', timeout: 3000 });
    await renameInput.fill('Persistent Page');
    await renameInput.press('Enter');
    await page.waitForTimeout(800);

    // Verify it's there
    let sidebarText = await page.textContent('nav[aria-label="Pages"]') ?? '';
    assert.ok(sidebarText.includes('Persistent Page'), 'Page should be in sidebar before refresh');

    // Refresh the browser
    await page.reload();
    await waitForTree(page);

    // Verify it persists
    sidebarText = await page.textContent('nav[aria-label="Pages"]') ?? '';
    assert.ok(
      sidebarText.includes('Persistent Page'),
      'Renamed page should survive browser refresh'
    );
  });

  // ---- TC-6: changes survive server restart (SC-3) ----
  it('TC-6: changes survive a full server restart', async () => {
    const dbPath = server.dbPath;

    // Create a page
    await page.goto(baseUrl());
    await waitForTree(page);

    const urlBefore = page.url();
    const newPageBtn = page.locator('[data-testid="new-page-top"]');
    await newPageBtn.click();
    await page.waitForFunction(
      (prevUrl: string) =>
        window.location.pathname.startsWith('/page/') &&
        window.location.href !== prevUrl,
      urlBefore,
      { timeout: 10000 }
    );
    const pageId = page.url().split('/page/')[1];

    const renameBtn = page.locator(`[data-testid="rename-${pageId}"]`);
    await renameBtn.click({ timeout: 5000 });
    const renameInput = page.locator(`[data-testid="rename-input-${pageId}"]`);
    await renameInput.waitFor({ state: 'visible', timeout: 3000 });
    await renameInput.fill('Restart Survivor');
    await renameInput.press('Enter');
    await page.waitForTimeout(800);

    // Verify before restart
    let sidebarText = await page.textContent('nav[aria-label="Pages"]') ?? '';
    assert.ok(sidebarText.includes('Restart Survivor'), 'Page should exist before restart');

    // Kill the server
    await server.kill();
    await page.close();

    // Restart the server with the SAME database path
    server = await startServer(dbPath);
    await server.waitForReady();

    const browser = await getBrowser();
    page = await browser.newPage();
    await page.goto(baseUrl());
    await waitForTree(page);

    // Verify the change survived
    sidebarText = await page.textContent('nav[aria-label="Pages"]') ?? '';
    assert.ok(
      sidebarText.includes('Restart Survivor'),
      'Page should survive full server restart'
    );
  });

  // ---- TC-7: no save button exists anywhere ----
  it('TC-7: no save button exists anywhere in the app', async () => {
    await page.goto(baseUrl());
    await waitForTree(page);

    // Check for any button/link with text containing "save" (case-insensitive)
    const saveButtons = page.locator(
      'button:has-text("Save"), button:has-text("save"), a:has-text("Save"), a:has-text("save"), [data-testid*="save"]'
    );
    const count = await saveButtons.count();
    assert.equal(
      count,
      0,
      'No save button should exist anywhere in the app'
    );

    // Also check the page view area specifically
    const pageView = page.locator('.page-view');
    if (await pageView.isVisible()) {
      const pageViewSave = pageView.locator('button:has-text("Save"), button:has-text("save")');
      const pvCount = await pageViewSave.count();
      assert.equal(pvCount, 0, 'No save button in page view area');
    }
  });
});
