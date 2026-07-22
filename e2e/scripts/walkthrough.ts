/**
 * Phase 6 -- Complete walkthrough of the running app in a real browser.
 *
 * Exercises EVERY feature in REQUIREMENTS.md, both themes, screenshots of every screen,
 * console error capture throughout.
 *
 * Uses the e2e server helper to manage its own server lifecycle with a fresh DB.
 */
import { chromium, type Page, type Browser } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { startServer, cleanupDb, type ServerHandle } from '../helpers/server.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCREENSHOTS_DIR = path.resolve(ROOT, 'screenshots');

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const errors: string[] = [];
let screenshotCount = 0;

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshotCount++;
  console.log(`  [shot ${screenshotCount}] ${name}.png`);
}

async function waitForTree(page: Page) {
  await page.waitForSelector('[data-testid^="page-row-"]', { timeout: 10000 });
  await page.waitForTimeout(400);
}

async function apiTree(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/tree`);
  return (await res.json()) as { pages: { id: string; parentId: string | null; title: string; kind: string; icon: string | null; position: number }[] };
}

async function apiDb(baseUrl: string, id: string) {
  const res = await fetch(`${baseUrl}/api/databases/${id}`);
  return res.json() as any;
}

async function findPage(baseUrl: string, title: string) {
  const { pages } = await apiTree(baseUrl);
  return pages.find((p) => p.title === title)!;
}

async function goTo(baseUrl: string, page: Page, pageId: string) {
  await page.goto(`${baseUrl}/page/${pageId}`);
  await page.waitForTimeout(600);
}

async function theme(page: Page, t: 'light' | 'dark') {
  const cur = await page.locator('html').getAttribute('data-theme');
  if (cur !== t) {
    const btn = page.locator('.theme-toggle');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(400);
  }
}

async function quickFind(page: Page) {
  await page.click('[data-testid="sidebar-search"]');
  await page.waitForSelector('[data-testid="quick-find-backdrop"]', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(300);
}

async function qfType(page: Page, q: string) {
  await page.locator('.quick-find input').fill(q);
  await page.waitForTimeout(700);
}

async function qfClose(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/* ------------------------------------------------------------------ */
/*  Main walkthrough                                                    */
/* ------------------------------------------------------------------ */

async function run() {
  console.log('=== PHASE 6 WALKTHROUGH ===\n');

  const server = await startServer();
  await server.waitForReady();
  const BASE = `http://localhost:${server.port}`;
  console.log(`Server: port ${server.port}, DB: ${server.dbPath}\n`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // Capture console errors
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`); });
  page.on('pageerror', (e) => { errors.push(`[pageerror] ${e.message}`); });

  // Start in light mode on root
  await page.goto(BASE);
  await waitForTree(page);
  await theme(page, 'light');

  /* ================================================================ */
  /*  AREA 1: SIDEBAR                                                  */
  /* ================================================================ */
  console.log('--- AREA 1: Sidebar ---');

  // Seeded tree with icons
  const tree = await apiTree(BASE);
  const titles = tree.pages.map((p) => p.title);
  console.log(`  Total pages in tree: ${titles.length}`);
  for (const want of ['Travel', 'Japan 2027', 'Reading List', 'Renovation Tasks', 'Recipes', 'Journal', '2026', 'July', 'May', 'February']) {
    console.log(`    "${want}": ${titles.includes(want)}`);
  }

  // Check icons in sidebar DOM
  const icons = await page.locator('.tree-icon').allTextContents();
  console.log(`  Tree icons rendered: ${icons.length}`);

  await shot(page, 'final-light-sidebar-full');

  // Dark sidebar
  await theme(page, 'dark');
  await shot(page, 'final-dark-sidebar-full');
  await theme(page, 'light');

  // Create top-level page
  console.log('\n  Create + rename + delete flow');
  const urlBefore = page.url();
  await page.locator('[data-testid="new-page-top"]').click();
  await page.waitForFunction((u: string) => window.location.pathname.startsWith('/page/') && window.location.href !== u, urlBefore, { timeout: 10000 });
  await page.waitForTimeout(500);
  const newId = page.url().split('/page/')[1];
  console.log(`  Created page id: ${newId}`);

  // Rename via sidebar rename button
  const renameBtn = page.locator(`[data-testid="rename-${newId}"]`);
  if (await renameBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await renameBtn.click();
    const inp = page.locator(`[data-testid="rename-input-${newId}"]`);
    await inp.waitFor({ state: 'visible', timeout: 3000 });
    await inp.fill('Walkthrough Test Page');
    await inp.press('Enter');
    await page.waitForTimeout(500);
    console.log('  Renamed to "Walkthrough Test Page"');
  }

  // Delete with confirmation modal
  const testRow = page.locator(`[data-testid="page-row-${newId}"]`);
  if (await testRow.isVisible({ timeout: 2000 }).catch(() => false)) {
    const delBtn = page.locator(`[data-testid="page-delete-${newId}"]`);
    if (await delBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await delBtn.click();
    } else {
      await testRow.hover();
      await page.waitForTimeout(200);
      if (await delBtn.isVisible({ timeout: 2000 }).catch(() => false)) await delBtn.click();
    }
    await page.waitForTimeout(300);
    const dialog = page.locator('[role="dialog"]');
    if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
      await shot(page, 'final-light-delete-modal');
      // Cancel
      const cancel = page.locator('button:has-text("Cancel")');
      if (await cancel.isVisible()) { await cancel.click(); await page.waitForTimeout(200); }
      console.log('  Delete modal shown, cancelled');
    } else {
      console.log('  Delete modal not found');
    }
  }

  // Active highlighting
  const japan = await findPage(BASE, 'Japan 2027');
  await goTo(BASE, page, japan.id);
  await waitForTree(page);
  const activeRows = page.locator('[data-testid^="page-row-"].is-active');
  console.log(`  Active row highlight: ${(await activeRows.count()) > 0}`);
  await shot(page, 'final-light-active-highlight');

  /* ================================================================ */
  /*  AREA 2: EDITOR                                                   */
  /* ================================================================ */
  console.log('\n--- AREA 2: Editor ---');

  await goTo(BASE, page, japan.id);
  await page.waitForSelector('[data-testid="page-title"]', { timeout: 10000 });
  await page.waitForTimeout(500);

  // Block count
  const blockEls = page.locator('[data-testid^="block-"]');
  const blockCount = await blockEls.count();
  console.log(`  Blocks on Japan 2027: ${blockCount}`);
  await shot(page, 'final-light-editor-blocks');

  // Check distinct block types
  const blockTypes = new Set<string>();
  for (let i = 0; i < blockCount; i++) {
    const id = await blockEls.nth(i).getAttribute('data-testid');
    if (id) {
      const type = id.replace('block-', '');
      blockTypes.add(type);
    }
  }
  console.log(`  Distinct block types: ${blockTypes.size} -- [${[...blockTypes].join(', ')}]`);

  // Autosave: type at the bottom, refresh, check
  const lastBlock = blockEls.last();
  await lastBlock.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Walkthrough autosave test 2026');
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForTimeout(1500);
  const bodyText = await page.locator('.block-editor-shell').textContent().catch(() => '');
  const autosaved = bodyText.includes('Walkthrough autosave test 2026');
  console.log(`  Autosave persists: ${autosaved}`);
  if (!autosaved) errors.push('[DEFECT?] Autosave content did not persist after reload');

  // No save button
  const saveBtns = page.locator('button:has-text("Save")');
  console.log(`  Save buttons: ${(await saveBtns.count())}`);

  // Slash menu
  const lastBlock2 = blockEls.last();
  await lastBlock2.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.waitForTimeout(400);
  const slashVisible = await page.locator('.slash-menu, [role="listbox"]').first().isVisible().catch(() => false);
  console.log(`  Slash menu visible: ${slashVisible}`);
  await shot(page, 'final-light-slash-menu');

  // Filter
  await page.keyboard.type('hea');
  await page.waitForTimeout(300);
  await shot(page, 'final-light-slash-menu-filtered');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Todo toggle
  const todoCbs = page.locator('.block-todo-checkbox');
  if ((await todoCbs.count()) > 0) {
    const cb = todoCbs.first();
    const was = await cb.isChecked();
    await cb.click();
    await page.waitForTimeout(500);
    const now = await cb.isChecked();
    console.log(`  Todo toggle: ${was} -> ${now}`);
  } else {
    console.log('  No todo checkboxes found');
  }

  await shot(page, 'final-light-editor-full');

  // Dark editor
  await theme(page, 'dark');
  await shot(page, 'final-dark-editor-blocks');
  await theme(page, 'light');

  /* ================================================================ */
  /*  AREA 3: DATABASES                                                */
  /* ================================================================ */
  console.log('\n--- AREA 3: Databases ---');

  const rl = await findPage(BASE, 'Reading List');
  const rlDb = await apiDb(BASE, rl.id);
  console.log(`  Reading List: ${rlDb.properties.length} properties, ${rlDb.rows.length} rows`);
  console.log(`  Types: ${rlDb.properties.map((p: any) => p.type).join(', ')}`);

  await goTo(BASE, page, rl.id);
  await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  await shot(page, 'final-light-table-view');

  // Edit a cell
  const firstCell = page.locator('.db-cell').first();
  if (await firstCell.isVisible()) {
    await firstCell.click();
    await page.waitForTimeout(300);
    await shot(page, 'final-light-cell-edit');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // Select option popover
  const statusCells = page.locator('.db-cell-select');
  if ((await statusCells.count()) > 0) {
    await statusCells.first().click();
    await page.waitForTimeout(300);
    await shot(page, 'final-light-select-popover');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // Row page (Project Hail Mary)
  const hailMary = rlDb.rows.find((r: any) => r.title === 'Project Hail Mary');
  if (hailMary) {
    await goTo(BASE, page, hailMary.id);
    await page.waitForTimeout(1000);
    const propsVisible = await page.locator('.row-properties-panel, [data-testid="row-properties-panel"]').first().isVisible().catch(() => false);
    console.log(`  Row page props panel: ${propsVisible}`);
    await shot(page, 'final-light-row-page');

    await theme(page, 'dark');
    await shot(page, 'final-dark-row-page');
    await theme(page, 'light');
  }

  /* ================================================================ */
  /*  AREA 4: VIEWS                                                    */
  /* ================================================================ */
  console.log('\n--- AREA 4: Views ---');

  // Board on Reading List
  await goTo(BASE, page, rl.id);
  await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
  await page.waitForTimeout(500);

  const boardTab = page.locator('[data-testid="db-view-tab-board"]');
  if (await boardTab.isVisible()) {
    await boardTab.click();
    await page.waitForSelector('[data-testid="board-view"]', { timeout: 10000 });
    await page.waitForTimeout(500);
    const boardGroups = await page.locator('.board-group, [data-testid="board-group"]').count();
    console.log(`  Board groups: ${boardGroups}`);
    await shot(page, 'final-light-board-view');
  }

  // List view
  const listTab = page.locator('[data-testid="db-view-tab-list"]');
  if (await listTab.isVisible()) {
    await listTab.click();
    await page.waitForTimeout(1000);
    await shot(page, 'final-light-list-view');
  }

  // Back to table
  const tableTab = page.locator('[data-testid="db-view-tab-table"]');
  if (await tableTab.isVisible()) {
    await tableTab.click();
    await page.waitForTimeout(500);
  }

  // Renovation Tasks board
  const rt = await findPage(BASE, 'Renovation Tasks');
  await goTo(BASE, page, rt.id);
  await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const rtBoard = page.locator('[data-testid="db-view-tab-board"]');
  if (await rtBoard.isVisible()) {
    await rtBoard.click();
    await page.waitForSelector('[data-testid="board-view"]', { timeout: 10000 });
    await page.waitForTimeout(500);
    await shot(page, 'final-light-renovation-board');
    console.log('  Renovation Tasks board rendered');
  }

  // Recipes all 3 views
  const recipes = await findPage(BASE, 'Recipes');
  await goTo(BASE, page, recipes.id);
  await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  await shot(page, 'final-light-recipes-table');

  const rBoard = page.locator('[data-testid="db-view-tab-board"]');
  if (await rBoard.isVisible()) {
    await rBoard.click();
    await page.waitForSelector('[data-testid="board-view"]', { timeout: 10000 });
    await page.waitForTimeout(500);
    await shot(page, 'final-light-recipes-board');
  }

  const rList = page.locator('[data-testid="db-view-tab-list"]');
  if (await rList.isVisible()) {
    await rList.click();
    await page.waitForTimeout(1000);
    await shot(page, 'final-light-recipes-list');
  }

  // Filter builder
  await goTo(BASE, page, rl.id);
  await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const tblTab = page.locator('[data-testid="db-view-tab-table"]');
  if (await tblTab.isVisible()) { await tblTab.click(); await page.waitForTimeout(500); }

  const filterBtn = page.locator('[data-testid="filter-btn"], button:has-text("Filter")').first();
  if (await filterBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await filterBtn.click();
    await page.waitForTimeout(500);
    await shot(page, 'final-light-filter-builder');
    console.log('  Filter builder opened');
  }

  // Dark views
  await theme(page, 'dark');
  await goTo(BASE, page, rl.id);
  await page.waitForSelector('[data-testid="db-view-switcher"]', { timeout: 15000 });
  await page.waitForTimeout(500);

  const bd = page.locator('[data-testid="db-view-tab-board"]');
  if (await bd.isVisible()) { await bd.click(); await page.waitForSelector('[data-testid="board-view"]', { timeout: 10000 }); await page.waitForTimeout(500); }
  await shot(page, 'final-dark-board-view');

  const td = page.locator('[data-testid="db-view-tab-table"]');
  if (await td.isVisible()) { await td.click(); await page.waitForTimeout(500); }
  await shot(page, 'final-dark-table-view');

  const ld = page.locator('[data-testid="db-view-tab-list"]');
  if (await ld.isVisible()) { await ld.click(); await page.waitForTimeout(1000); }
  await shot(page, 'final-dark-list-view');

  await theme(page, 'light');

  /* ================================================================ */
  /*  AREA 5: SEARCH                                                   */
  /* ================================================================ */
  console.log('\n--- AREA 5: Search ---');

  await goTo(BASE, page, rl.id);
  await waitForTree(page);

  // By button
  await quickFind(page);
  await shot(page, 'final-light-quick-find-open');

  // Live narrowing
  await qfType(page, 'japan');
  await shot(page, 'final-light-search-results');
  const resultTitles = await page.locator('.quick-find-result-title').allTextContents();
  console.log(`  Results for "japan": ${resultTitles.join(', ')}`);

  // Jump
  const firstRes = page.locator('.quick-find-result').first();
  if (await firstRes.isVisible()) {
    await firstRes.click();
    await page.waitForTimeout(1000);
    console.log('  Jumped to result');
  }

  // No results
  await quickFind(page);
  await qfType(page, 'xyznonexistent');
  await shot(page, 'final-light-search-no-results');
  await qfClose(page);

  // Ctrl+K
  await page.keyboard.press('Control+k');
  await page.waitForSelector('[data-testid="quick-find-backdrop"]', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(300);
  await qfType(page, 'hail');
  await shot(page, 'final-light-search-ctrlk');
  await qfClose(page);

  // Dark search
  await theme(page, 'dark');
  await quickFind(page);
  await qfType(page, 'japan');
  await shot(page, 'final-dark-search-results');
  await qfClose(page);
  await theme(page, 'light');

  /* ================================================================ */
  /*  AREA 6: THEMES                                                   */
  /* ================================================================ */
  console.log('\n--- AREA 6: Themes ---');

  await goTo(BASE, page, japan.id);
  await waitForTree(page);
  await theme(page, 'dark');
  await shot(page, 'final-dark-sidebar-page');

  // Not-found page
  await page.goto(`${BASE}/page/nonexistent-id-12345`);
  await page.waitForTimeout(1000);
  await shot(page, 'final-dark-not-found');
  await theme(page, 'light');
  await page.reload();
  await page.waitForTimeout(1000);
  await shot(page, 'final-light-not-found');

  /* ================================================================ */
  /*  AREA 7: LOOK AND FEEL                                            */
  /* ================================================================ */
  console.log('\n--- AREA 7: Look and Feel ---');

  await goTo(BASE, page, japan.id);
  await waitForTree(page);
  const saveBtnsFinal = page.locator('button:has-text("Save")');
  console.log(`  Save buttons on page: ${await saveBtnsFinal.count()}`);

  // Check for gradient usage via computed styles
  const gradientCheck = await page.evaluate(() => {
    let gradients = 0;
    document.querySelectorAll('*').forEach((el) => {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none' && bg.includes('gradient')) gradients++;
    });
    return gradients;
  });
  console.log(`  Elements with gradient backgrounds: ${gradientCheck}`);
  if (gradientCheck > 0) errors.push(`[look-and-feel] ${gradientCheck} elements have gradient backgrounds`);

  // Final full-app screenshots
  await theme(page, 'light');
  await shot(page, 'final-light-full-app');
  await theme(page, 'dark');
  await shot(page, 'final-dark-full-app');

  /* ================================================================ */
  /*  SUMMARY                                                          */
  /* ================================================================ */
  console.log('\n=== WALKTHROUGH COMPLETE ===');
  console.log(`Screenshots: ${screenshotCount}`);
  console.log(`Console errors / findings: ${errors.length}`);
  errors.forEach((e) => console.log(`  !! ${e}`));

  // Cleanup
  await page.close();
  await browser.close();
  await server.kill();
  cleanupDb(server.dbPath);
  console.log('Server and DB cleaned up.');
  process.exit(0);
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
