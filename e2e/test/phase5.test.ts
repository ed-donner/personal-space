/**
 * Phase 5 -- Quick-find search, light/dark theme, full seed (e2e).
 *
 * Maps to REQUIREMENTS.md Phase 5 success criteria 1-5.
 * Fresh temp DB per run via the server helper, auto-seeded.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type Page, type Browser, type BrowserContext } from 'playwright';
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

interface DatabaseResponse {
  page: TreePage;
  properties: { id: string; name: string; type: string; options: { id: string; label: string; color: string }[] | null }[];
  rows: { id: string; parentId: string; title: string; kind: string; values: Record<string, unknown> }[];
  views: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function waitForTree(page: Page) {
  await page.waitForSelector('[data-testid^="page-row-"]', { timeout: 10000 });
  await page.waitForTimeout(300);
}

async function findPageByTitle(baseUrl: string, title: string): Promise<TreePage> {
  const res = await fetch(`${baseUrl}/api/tree`);
  const { pages } = (await res.json()) as { pages: TreePage[] };
  const p = pages.find((pg) => pg.title === title);
  if (!p) throw new Error(`Page "${title}" not found in tree`);
  return p;
}

async function getDatabase(baseUrl: string, id: string): Promise<DatabaseResponse> {
  const res = await fetch(`${baseUrl}/api/databases/${id}`);
  return res.json() as Promise<DatabaseResponse>;
}

async function openQuickFindByButton(page: Page) {
  await page.click('[data-testid="sidebar-search"]');
  await page.waitForSelector('[data-testid="quick-find-backdrop"]', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(200);
}

async function openQuickFindByKeyboard(page: Page) {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('[data-testid="quick-find-backdrop"]', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(200);
}

async function closeQuickFind(page: Page) {
  await page.keyboard.press('Escape');
  // Wait for backdrop to become hidden or removed
  try {
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="quick-find-backdrop"]') ||
            (document.querySelector('[data-testid="quick-find-backdrop"]') as HTMLElement).style.display === 'none' ||
            !(document.querySelector('[data-testid="quick-find-backdrop"]') as HTMLElement).offsetParent,
      { timeout: 3000 }
    );
  } catch { /* may already be gone */ }
  await page.waitForTimeout(200);
}

async function typeInQuickFind(page: Page, query: string) {
  const input = page.locator('.quick-find input');
  await input.fill(query);
  await page.waitForTimeout(600); // debounce (200ms) + API round-trip
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Phase 5 -- Quick-find search, theme and full seed (e2e)', () => {
  let server: ServerHandle;
  let page: Page;
  let readingListId: string;
  let readingListDb: DatabaseResponse;
  let recipesId: string;
  let recipesDb: DatabaseResponse;
  let japanPageId: string;
  let hailMaryRowId: string;
  const baseUrl = () => `http://localhost:${server.port}`;

  before(async () => {
    server = await startServer();
    await server.waitForReady();
    const browser = await getBrowser();
    page = await browser.newPage();

    // Fetch seed data via API for use in assertions
    readingListId = (await findPageByTitle(baseUrl(), 'Reading List')).id;
    readingListDb = await getDatabase(baseUrl(), readingListId);
    hailMaryRowId = readingListDb.rows.find((r) => r.title === 'Project Hail Mary')!.id;
    recipesId = (await findPageByTitle(baseUrl(), 'Recipes')).id;
    recipesDb = await getDatabase(baseUrl(), recipesId);
    japanPageId = (await findPageByTitle(baseUrl(), 'Japan 2027')).id;

    // Navigate to app -- start on the Reading List page
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTree(page);
  });

  after(async () => {
    try { await page?.close(); } catch { /* ignore */ }
    try { await closeBrowser(); } catch { /* ignore */ }
    try { await server?.kill(); } catch { /* ignore */ }
    try { cleanupDb(server?.dbPath ?? ''); } catch { /* ignore */ }
  });

  /* ================================================================ */
  /*  SC-1: Quick-find opens BOTH ways                               */
  /* ================================================================ */

  it('TC-1a: quick-find opens via sidebar search button', async () => {
    await openQuickFindByButton(page);

    const dialog = page.locator('[role="dialog"]');
    assert.ok(await dialog.isVisible(), 'Quick-find dialog should be visible');
    assert.equal(await dialog.getAttribute('aria-label'), 'Search workspace');

    await screenshot(page, 'e2e-phase5-quick-find-button');
    await closeQuickFind(page);
  });

  it('TC-1b: quick-find opens via Ctrl+K with focused input', async () => {
    await openQuickFindByKeyboard(page);

    const dialog = page.locator('[role="dialog"]');
    assert.ok(await dialog.isVisible(), 'Quick-find dialog should be visible after Ctrl+K');

    const input = page.locator('.quick-find input');
    const isFocused = await input.evaluate((el) => document.activeElement === el);
    assert.ok(isFocused, 'Input should be focused after Ctrl+K');

    await screenshot(page, 'e2e-phase5-quick-find-ctrlk');
    await closeQuickFind(page);
  });

  /* ================================================================ */
  /*  SC-1: Live narrowing                                           */
  /* ================================================================ */

  it('TC-2a: type "jap" -- Japan 2027 appears', async () => {
    await openQuickFindByKeyboard(page);
    await typeInQuickFind(page, 'jap');

    const titles = await page.locator('.quick-find-result-title').allTextContents();
    assert.ok(titles.some((t) => t.includes('Japan 2027')), `Should find Japan 2027, got: ${titles}`);

    await screenshot(page, 'e2e-phase5-search-jap');
    await closeQuickFind(page);
  });

  it('TC-2b: type "japx" -- no-results state', async () => {
    await openQuickFindByKeyboard(page);
    await typeInQuickFind(page, 'japx');

    const noResults = page.locator('.quick-find-empty strong');
    assert.ok(await noResults.isVisible(), 'No results message should be visible');
    const text = await noResults.textContent();
    assert.ok(text?.includes('No results'), `Should say "No results", got: ${text}`);

    await screenshot(page, 'e2e-phase5-search-no-results');
    await closeQuickFind(page);
  });

  it('TC-2c: type "reading" -- Reading List database appears', async () => {
    await openQuickFindByKeyboard(page);
    await typeInQuickFind(page, 'reading');

    const titles = await page.locator('.quick-find-result-title').allTextContents();
    assert.ok(titles.some((t) => t.includes('Reading List')), `Should find Reading List, got: ${titles}`);

    await screenshot(page, 'e2e-phase5-search-reading');
    await closeQuickFind(page);
  });

  it('TC-2d: type "hail" -- Project Hail Mary with "In Reading List" suffix', async () => {
    await openQuickFindByKeyboard(page);
    await typeInQuickFind(page, 'hail');

    const titles = await page.locator('.quick-find-result-title').allTextContents();
    assert.ok(titles.some((t) => t.includes('Project Hail Mary')), `Should find Project Hail Mary, got: ${titles}`);

    const parents = await page.locator('.quick-find-parent').allTextContents();
    assert.ok(parents.some((p) => p.includes('In Reading List')), `Should show "In Reading List" suffix, got: ${parents}`);

    await screenshot(page, 'e2e-phase5-search-hail');
    await closeQuickFind(page);
  });

  /* ================================================================ */
  /*  SC-1: Jump to result                                          */
  /* ================================================================ */

  it('TC-3a: clicking a page result navigates to that page', async () => {
    await openQuickFindByKeyboard(page);
    await typeInQuickFind(page, 'japan');

    // Click the first (and likely only) result
    const firstResult = page.locator('.quick-find-result').first();
    await firstResult.click();
    await page.waitForTimeout(500);

    // Should navigate to Japan 2027
    const title = await page.locator('[data-testid="page-title"]').textContent();
    assert.ok(title?.includes('Japan 2027'), `Should navigate to Japan 2027, got: ${title}`);

    // Quick-find should be closed
    assert.ok(!(await page.locator('[role="dialog"]').isVisible()), 'Quick-find should be closed after jump');
  });

  it('TC-3b: clicking a row result navigates to row page with properties panel', async () => {
    await openQuickFindByKeyboard(page);
    await typeInQuickFind(page, 'hail');

    // Click the result
    const result = page.locator('.quick-find-result').first();
    await result.click();
    await page.waitForTimeout(1000);

    // Should be on row page
    assert.ok(await page.locator('[data-testid="row-page-view"]').isVisible(), 'Should be on row page view');
    assert.ok(await page.locator('[data-testid="row-properties-panel"]').isVisible(), 'Properties panel should be visible');

    const rowTitle = await page.locator('[data-testid="row-title"]').textContent();
    assert.ok(rowTitle?.includes('Project Hail Mary'), `Should show Project Hail Mary title, got: ${rowTitle}`);
  });

  it('TC-3c: keyboard arrows move selection, Enter jumps', async () => {
    // Navigate back to a known page first
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTree(page);

    await openQuickFindByKeyboard(page);
    // "the" returns multiple row results: Fix the garden fence, Retile the shower, The Design of Everyday Things
    await typeInQuickFind(page, 'the');

    // First result should be active by default
    let activeTitle = await page.locator('.quick-find-result.is-active .quick-find-result-title').textContent();
    assert.ok(activeTitle, 'First result should be active');

    // Press ArrowDown to move to second result
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    const secondActiveTitle = await page.locator('.quick-find-result.is-active .quick-find-result-title').textContent();
    assert.ok(secondActiveTitle, 'Second result should be active after ArrowDown');
    assert.notEqual(activeTitle, secondActiveTitle, 'Active result should have changed');

    // Press Enter to jump
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Quick-find should be closed
    assert.ok(!(await page.locator('[role="dialog"]').isVisible()), 'Quick-find should be closed after Enter');

    // Should have navigated to a page
    const url = page.url();
    assert.ok(url.includes('/page/'), `Should navigate to a page, URL: ${url}`);
  });

  it('TC-3d: Escape closes; reopening starts fresh', async () => {
    await openQuickFindByKeyboard(page);
    await typeInQuickFind(page, 'some query');
    await page.waitForTimeout(300);

    // Verify something is typed
    let inputValue = await page.locator('.quick-find input').inputValue();
    assert.ok(inputValue.length > 0, 'Input should have text');

    // Escape closes
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.ok(!(await page.locator('[role="dialog"]').isVisible()), 'Quick-find should be closed after Escape');

    // Reopen -- input should be empty (fresh start)
    await openQuickFindByKeyboard(page);
    inputValue = await page.locator('.quick-find input').inputValue();
    assert.equal(inputValue, '', 'Input should be empty after reopening');

    await closeQuickFind(page);
  });

  /* ================================================================ */
  /*  SC-2: Theme toggle                                             */
  /* ================================================================ */

  it('TC-4a: toggle to dark via sidebar footer toggle', async () => {
    // Navigate to a page so the full UI is visible
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await waitForTree(page);

    const themeToggle = page.locator('.theme-toggle');
    await themeToggle.scrollIntoViewIfNeeded();
    await themeToggle.click();
    await page.waitForTimeout(300);

    // Assert data-theme="dark" on <html>
    const theme = await page.locator('html').getAttribute('data-theme');
    assert.equal(theme, 'dark', 'HTML should have data-theme="dark"');

    // Assert visibly dark background (computed style)
    const bgColor = await page.locator('.app-main').evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });
    // Dark theme --color-bg: #14171c => rgb(20, 23, 28)
    assert.ok(bgColor !== 'rgb(255, 255, 255)', `Background should not be white in dark mode, got: ${bgColor}`);
    const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const [, r, g, b] = match.map(Number);
      assert.ok(r < 50 && g < 50 && b < 50, `Background should be dark, got: rgb(${r},${g},${b})`);
    }

    await screenshot(page, 'e2e-phase5-dark-mode-toggle');
  });

  it('TC-4b: dark theme persists after reload', async () => {
    await page.reload();
    await waitForTree(page);

    const theme = await page.locator('html').getAttribute('data-theme');
    assert.equal(theme, 'dark', 'Theme should persist as dark after reload');
    await screenshot(page, 'e2e-phase5-dark-persist-reload');
  });

  it('TC-4c: toggle back to light', async () => {
    const themeToggle = page.locator('.theme-toggle');
    await themeToggle.scrollIntoViewIfNeeded();
    await themeToggle.click();
    await page.waitForTimeout(300);

    const theme = await page.locator('html').getAttribute('data-theme');
    assert.equal(theme, 'light', 'HTML should have data-theme="light"');
    await screenshot(page, 'e2e-phase5-light-mode-toggle');
  });

  it('TC-4d: light theme persists after reload', async () => {
    await page.reload();
    await waitForTree(page);

    const theme = await page.locator('html').getAttribute('data-theme');
    assert.equal(theme, 'light', 'Theme should persist as light after reload');
  });

  it('TC-4e: localStorage ps:theme persists across new browser context', async () => {
    // Toggle to dark
    const themeToggle = page.locator('.theme-toggle');
    await themeToggle.scrollIntoViewIfNeeded();
    await themeToggle.click();
    await page.waitForTimeout(300);

    const theme = await page.locator('html').getAttribute('data-theme');
    assert.equal(theme, 'dark', 'Should be dark after toggle');

    // Verify localStorage
    const storedTheme = await page.evaluate(() => window.localStorage.getItem('ps:theme'));
    assert.equal(storedTheme, 'dark', 'localStorage ps:theme should be "dark"');

    // Create a fresh browser context, inject the same localStorage, and load the app
    const browser: Browser = await getBrowser();
    const context: BrowserContext = await browser.newContext();
    const storageState = await page.evaluate(() => {
      const state: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)!;
        state[key] = window.localStorage.getItem(key)!;
      }
      return state;
    });

    const newPage = await context.newPage();
    await newPage.addInitScript((state: Record<string, string>) => {
      for (const [key, value] of Object.entries(state)) {
        window.localStorage.setItem(key, value);
      }
    }, storageState);

    await newPage.goto(`${baseUrl()}/page/${readingListId}`);
    await newPage.waitForSelector('[data-testid^="page-row-"]', { timeout: 10000 });
    await newPage.waitForTimeout(500);

    const newTheme = await newPage.locator('html').getAttribute('data-theme');
    assert.equal(newTheme, 'dark', 'New context should have dark theme from localStorage');

    await screenshot(newPage, 'e2e-phase5-dark-new-context');
    await newPage.close();
    await context.close();
  });

  /* ================================================================ */
  /*  SC-5: Dark-mode sanity screenshots                             */
  /* ================================================================ */

  it('TC-5a: dark block page -- no pure-white backgrounds', async () => {
    // Ensure dark mode
    const currentTheme = await page.locator('html').getAttribute('data-theme');
    if (currentTheme !== 'dark') {
      const toggle = page.locator('.theme-toggle');
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
      await page.waitForTimeout(300);
    }

    // Navigate to Japan 2027 (a rich block page)
    await page.goto(`${baseUrl()}/page/${japanPageId}`);
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Sample key structural elements
    for (const selector of ['.app-main', '.page-view', '.page-header']) {
      const el = page.locator(selector).first();
      if (await el.count() > 0) {
        const bg = await el.evaluate((e) => window.getComputedStyle(e).backgroundColor);
        assert.ok(bg !== 'rgb(255, 255, 255)', `${selector} must not have white bg in dark mode, got: ${bg}`);
      }
    }

    await screenshot(page, 'e2e-phase5-dark-block-page');
  });

  it('TC-5b: dark table view -- no pure-white backgrounds', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await page.waitForSelector('[data-testid="db-table"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    for (const selector of ['.app-main', '.page-view', '.db-table']) {
      const el = page.locator(selector).first();
      if (await el.count() > 0) {
        const bg = await el.evaluate((e) => window.getComputedStyle(e).backgroundColor);
        assert.ok(bg !== 'rgb(255, 255, 255)', `${selector} must not have white bg in dark mode, got: ${bg}`);
      }
    }

    await screenshot(page, 'e2e-phase5-dark-table');
  });

  it('TC-5c: dark board view -- no pure-white backgrounds', async () => {
    await page.goto(`${baseUrl()}/page/${readingListId}`);
    await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.click('[data-testid="db-view-tab-board"]');
    await page.waitForSelector('[data-testid="board-view"]', { timeout: 10000 });
    await page.waitForTimeout(500);

    for (const selector of ['.app-main', '.page-view', '.board-view']) {
      const el = page.locator(selector).first();
      if (await el.count() > 0) {
        const bg = await el.evaluate((e) => window.getComputedStyle(e).backgroundColor);
        assert.ok(bg !== 'rgb(255, 255, 255)', `${selector} must not have white bg in dark mode, got: ${bg}`);
      }
    }

    await screenshot(page, 'e2e-phase5-dark-board');
  });

  it('TC-5d: dark row page -- no pure-white backgrounds', async () => {
    await page.goto(`${baseUrl()}/page/${hailMaryRowId}`);
    await page.waitForSelector('[data-testid="row-page-view"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    for (const selector of ['.app-main', '.page-view', '.row-properties-panel']) {
      const el = page.locator(selector).first();
      if (await el.count() > 0) {
        const bg = await el.evaluate((e) => window.getComputedStyle(e).backgroundColor);
        assert.ok(bg !== 'rgb(255, 255, 255)', `${selector} must not have white bg in dark mode, got: ${bg}`);
      }
    }

    await screenshot(page, 'e2e-phase5-dark-row-page');
  });

  it('TC-5e: dark quick-find dialog -- no pure-white backgrounds', async () => {
    await openQuickFindByKeyboard(page);
    await typeInQuickFind(page, 'japan');
    await page.waitForTimeout(500);

    const bg = await page.locator('.quick-find').evaluate((e) => window.getComputedStyle(e).backgroundColor);
    assert.ok(bg !== 'rgb(255, 255, 255)', `Quick-find dialog must not have white bg in dark mode, got: ${bg}`);

    await screenshot(page, 'e2e-phase5-dark-quick-find');
    await closeQuickFind(page);

    // Restore to light mode for remaining tests
    const toggle = page.locator('.theme-toggle');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await page.waitForTimeout(300);
  });

  /* ================================================================ */
  /*  SC-3: Full-seed presence                                       */
  /* ================================================================ */

  it('TC-6a: Recipes database in sidebar with 5 rows', async () => {
    // Check sidebar has Recipes
    const sidebarText = await page.locator('.sidebar-tree').textContent();
    assert.ok(sidebarText?.includes('Recipes'), 'Sidebar should contain Recipes');

    // Verify 5 rows via API
    assert.equal(recipesDb.rows.length, 5, `Recipes should have 5 rows, got ${recipesDb.rows.length}`);

    // Navigate to Recipes database via URL (reliable pattern)
    await page.goto(`${baseUrl()}/page/${recipesId}`);
    await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    const tableRows = await page.locator('.db-row').count();
    assert.equal(tableRows, 5, `Should show 5 recipe rows, got ${tableRows}`);

    await screenshot(page, 'e2e-phase5-recipes-database');
  });

  it('TC-6b: Journal > 2026 > July/May/February nested', async () => {
    // Check sidebar text
    const sidebarText = await page.locator('.sidebar-tree').textContent();
    assert.ok(sidebarText?.includes('Journal'), 'Sidebar should contain Journal');
    assert.ok(sidebarText?.includes('2026'), 'Sidebar should contain 2026');
    assert.ok(sidebarText?.includes('July'), 'Sidebar should contain July');
    assert.ok(sidebarText?.includes('May'), 'Sidebar should contain May');
    assert.ok(sidebarText?.includes('February'), 'Sidebar should contain February');

    // Verify nesting via tree API
    const treeRes = await fetch(`${baseUrl()}/api/tree`);
    const { pages: treePages } = (await treeRes.json()) as { pages: TreePage[] };

    const journal = treePages.find((p) => p.title === 'Journal');
    assert.ok(journal, 'Journal page should exist in tree');

    const year2026 = treePages.find((p) => p.title === '2026');
    assert.ok(year2026, '2026 page should exist in tree');
    assert.equal(year2026.parentId, journal.id, '2026 should be child of Journal');

    for (const month of ['July', 'May', 'February']) {
      const monthPage = treePages.find((p) => p.title === month);
      assert.ok(monthPage, `${month} should exist in tree`);
      assert.equal(monthPage.parentId, year2026.id, `${month} should be child of 2026`);
    }

    await screenshot(page, 'e2e-phase5-journal-nesting');
  });

  it('TC-6c: search finds a recipe row', async () => {
    await openQuickFindByKeyboard(page);
    await typeInQuickFind(page, 'marcella');

    const titles = await page.locator('.quick-find-result-title').allTextContents();
    assert.ok(
      titles.some((t) => t.includes('Marcella')),
      `Should find recipe "Marcella Hazan", got: ${titles}`
    );

    await screenshot(page, 'e2e-phase5-search-recipe');
    await closeQuickFind(page);
  });
});
