/**
 * DEF-001 retest: Slash menu dismissed when clicking outside the block.
 *
 * Repro steps from DEFECTS.md + regression around the fix.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type Page } from 'playwright';
import { startServer, cleanupDb, type ServerHandle } from '../helpers/server.js';
import { getBrowser, screenshot, closeBrowser } from '../helpers/browser.js';

async function waitForTree(page: Page) {
  await page.waitForSelector('[data-testid^="page-row-"]', { timeout: 10000 });
  await page.waitForTimeout(300);
}

async function findPageByTitle(baseUrl: string, title: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/tree`);
  const { pages } = (await res.json()) as { pages: { id: string; title: string }[] };
  const p = pages.find((pg) => pg.title === title);
  if (!p) throw new Error(`Page "${title}" not found in tree`);
  return p.id;
}

interface BlockInfo {
  testid: string;
  text: string | null;
}

async function getLastBlockId(page: Page): Promise<string> {
  const blocks: BlockInfo[] = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid^="block-text-"]');
    return Array.from(els).map((el) => ({
      testid: el.getAttribute('data-testid')!,
      text: el.textContent,
    }));
  });
  return blocks[blocks.length - 1].testid.replace('block-text-', '');
}

/** Create a new empty block at the bottom of the page and return its id. */
async function createNewBlock(page: Page): Promise<string> {
  const lastId = await getLastBlockId(page);
  await page.locator(`[data-testid="block-text-${lastId}"]`).click();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  return getLastBlockId(page);
}

/** Open the slash menu by inserting / into a block via execCommand. */
async function openSlashMenu(page: Page, blockId: string): Promise<boolean> {
  await page.evaluate((id: string) => {
    const el = document.querySelector(
      `[data-testid="block-text-${id}"]`
    ) as HTMLElement;
    if (!el) throw new Error('Block text element not found');
    el.focus();
    document.execCommand('insertText', false, '/');
  }, blockId);
  await page.waitForTimeout(500);
  const slashMenu = page.locator('.slash-menu');
  return slashMenu.isVisible();
}

const SLASH_MENU = '.slash-menu';

describe('DEF-001 retest -- slash menu dismissed on outside click', () => {
  let server: ServerHandle;
  let page: Page;
  let japanId: string;
  const baseUrl = () => `http://localhost:${server.port}`;

  before(async () => {
    server = await startServer();
    await server.waitForReady();
    const browser = await getBrowser();
    page = await browser.newPage();
    japanId = await findPageByTitle(baseUrl(), 'Japan 2027');
  });

  after(async () => {
    try { await page?.close(); } catch { /* ignore */ }
    try { await closeBrowser(); } catch { /* ignore */ }
    try { await server?.kill(); } catch { /* ignore */ }
    try { cleanupDb(server?.dbPath ?? ''); } catch { /* ignore */ }
    process.exit(0);
  });

  // --- DEF-001 repro: title click must dismiss the menu ---
  it('clicking page title dismisses the slash menu', async () => {
    await page.goto(`${baseUrl()}/page/${japanId}`);
    await page.waitForSelector('[data-testid="block-editor"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid^="block-text-"]', { timeout: 10000 });
    await page.waitForTimeout(300);

    // Create new block and open slash menu
    const blockId = await createNewBlock(page);
    const opened = await openSlashMenu(page, blockId);
    assert.ok(opened, 'Slash menu must open after /');

    await screenshot(page, 'def-001-retest-menu-open');

    // DEF-001 step: click the page title
    await page.locator('[data-testid="page-title"]').click();
    await page.waitForTimeout(500);

    const menuStillVisible = await page
      .locator(SLASH_MENU)
      .isVisible()
      .catch(() => false);

    await screenshot(page, 'def-001-retest-after-title-click');

    assert.ok(
      !menuStillVisible,
      'DEF-001: slash menu must be dismissed after clicking the page title'
    );
  });

  // --- Regression: clicking inside the menu must NOT dismiss it ---
  it('clicking inside the slash menu does NOT dismiss it', async () => {
    await page.goto(`${baseUrl()}/page/${japanId}`);
    await page.waitForSelector('[data-testid="block-editor"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid^="block-text-"]', { timeout: 10000 });
    await page.waitForTimeout(300);

    const blockId = await createNewBlock(page);
    const opened = await openSlashMenu(page, blockId);
    assert.ok(opened, 'Slash menu must open');

    // Hover an option (inside the menu)
    const option = page.locator(`${SLASH_MENU} [role="option"]`).first();
    await option.hover();
    await page.waitForTimeout(300);

    const stillVisible = await page
      .locator(SLASH_MENU)
      .isVisible()
      .catch(() => false);
    assert.ok(
      stillVisible,
      'Slash menu must remain open when clicking/hovering inside it'
    );
  });

  // --- Regression: Escape still closes ---
  it('Escape still closes the slash menu', async () => {
    await page.goto(`${baseUrl()}/page/${japanId}`);
    await page.waitForSelector('[data-testid="block-editor"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid^="block-text-"]', { timeout: 10000 });
    await page.waitForTimeout(300);

    const blockId = await createNewBlock(page);
    const opened = await openSlashMenu(page, blockId);
    assert.ok(opened, 'Slash menu must open');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const closed = !(await page.locator(SLASH_MENU).isVisible().catch(() => false));
    assert.ok(closed, 'Escape must close the slash menu');
  });

  // --- Regression: filter + keyboard pick still works ---
  it('slash menu filters and keyboard pick works', async () => {
    await page.goto(`${baseUrl()}/page/${japanId}`);
    await page.waitForSelector('[data-testid="block-editor"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid^="block-text-"]', { timeout: 10000 });
    await page.waitForTimeout(300);

    const blockId = await createNewBlock(page);
    // Type /hea to open and filter
    await page.evaluate((id: string) => {
      const el = document.querySelector(
        `[data-testid="block-text-${id}"]`
      ) as HTMLElement;
      el.focus();
      document.execCommand('insertText', false, '/hea');
    }, blockId);
    await page.waitForTimeout(500);

    const slashMenu = page.locator(SLASH_MENU);
    await slashMenu.waitFor({ state: 'visible', timeout: 5000 });

    const count = await slashMenu.locator('[role="option"]').count();
    assert.equal(count, 3, 'Filtered menu should show 3 heading types');

    // ArrowDown + Enter to pick Heading 2
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const closed = !(await slashMenu.isVisible().catch(() => false));
    assert.ok(closed, 'Menu must close after keyboard pick');

    // Verify the block was converted to h2
    const blockType = await page
      .locator(`[data-testid="block-${blockId}"]`)
      .getAttribute('data-block-type');
    assert.equal(blockType, 'h2', 'Block should be converted to h2');
  });

  // --- Regression: mouse click pick still works ---
  it('slash menu mouse click pick still works', async () => {
    await page.goto(`${baseUrl()}/page/${japanId}`);
    await page.waitForSelector('[data-testid="block-editor"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid^="block-text-"]', { timeout: 10000 });
    await page.waitForTimeout(300);

    const blockId = await createNewBlock(page);
    const opened = await openSlashMenu(page, blockId);
    assert.ok(opened, 'Slash menu must open');

    await page
      .locator(`${SLASH_MENU} [role="option"]:has-text("Callout")`)
      .click();
    await page.waitForTimeout(500);

    const closed = !(await page.locator(SLASH_MENU).isVisible().catch(() => false));
    assert.ok(closed, 'Menu must close after mouse click pick');

    const blockType = await page
      .locator(`[data-testid="block-${blockId}"]`)
      .getAttribute('data-block-type');
    assert.equal(blockType, 'callout', 'Block should be converted to callout');
  });
});
