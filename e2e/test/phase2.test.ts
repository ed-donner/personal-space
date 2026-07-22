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

interface Block {
  id: string;
  pageId: string;
  type: string;
  content: Record<string, unknown>;
  position: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function waitForTree(page: Page) {
  await page.waitForSelector('[data-testid^="page-row-"]', { timeout: 10000 });
  await page.waitForTimeout(300);
}

/** Wait until at least `count` .editor-block elements exist in the DOM. */
async function waitForBlockCount(page: Page, count: number) {
  await page.waitForFunction(
    (n: number) => document.querySelectorAll('.editor-block').length >= n,
    count,
    { timeout: 10000 }
  );
}

async function findPageByTitle(baseUrl: string, title: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/tree`);
  const { pages } = (await res.json()) as { pages: TreePage[] };
  const p = pages.find((pg) => pg.title === title);
  if (!p) throw new Error(`Page "${title}" not found in tree`);
  return p.id;
}

async function getBlocks(baseUrl: string, pageId: string): Promise<Block[]> {
  const res = await fetch(`${baseUrl}/api/pages/${pageId}/blocks`);
  const { blocks } = (await res.json()) as { blocks: Block[] };
  return [...blocks].sort((a, b) => a.position - b.position);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Phase 2 -- The editor (e2e)', () => {
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

  /** Navigate to the Japan 2027 page and wait for blocks to render. */
  async function gotoJapan() {
    await page.goto(`${baseUrl()}/page/${japanId}`);
    await page.waitForSelector('[data-testid="block-editor"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid^="block-text-"]', { timeout: 10000 });
    // Let React settle
    await page.waitForTimeout(200);
  }

  /* ================================================================ */
  /*  TC-1: typing, autosave, reload  (SC-3)                          */
  /* ================================================================ */

  it('TC-1: typing into a page autosaves and survives reload, no save button', async () => {
    await gotoJapan();

    // Find the paragraph block ("Two weeks, landing in Tokyo...")
    const blocks = await getBlocks(baseUrl(), japanId);
    const para = blocks.find((b) => b.type === 'paragraph');
    assert.ok(para, 'Japan 2027 should have a paragraph block');

    // Place cursor at the end of the contenteditable and type via execCommand
    await page.evaluate(({ blockId, text }) => {
      const el = document.querySelector(`[data-testid="block-text-${blockId}"]`) as HTMLElement;
      if (!el) throw new Error('Block text element not found');
      el.focus();
      // Move cursor to end
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false); // false = collapse to end
      selection!.removeAllRanges();
      selection!.addRange(range);
      // Insert text (triggers native input event that React picks up)
      document.execCommand('insertText', false, text);
    }, { blockId: para.id, text: ' E2E typing test.' });

    // Wait for autosave debounce (500 ms) + buffer
    await page.waitForTimeout(1500);

    // Reload
    await page.reload();
    await page.waitForSelector('[data-testid="block-editor"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid^="block-text-"]', { timeout: 10000 });

    const textAfter = await page
      .locator(`[data-testid="block-text-${para.id}"]`)
      .textContent();
    assert.ok(
      textAfter?.includes('E2E typing test.'),
      `Paragraph should contain "E2E typing test." after reload, got: ${textAfter}`
    );

    // No save button anywhere
    const saveCount = await page
      .locator('button:has-text("Save"), button:has-text("save"), [data-testid*="save"]')
      .count();
    assert.equal(saveCount, 0, 'No save button should exist');

    await screenshot(page, 'e2e-phase2-typing-autosave');
  });

  /* ================================================================ */
  /*  TC-2a: slash menu -- all 11 types, filter, keyboard insert      */
  /*  (SC-1, SC-2)                                                    */
  /* ================================================================ */

  it('TC-2a: slash menu opens with 11 types, filters, inserts via keyboard', async () => {
    await gotoJapan();

    // Create a fresh empty block at the end by pressing Enter on the last block
    const blocks = await getBlocks(baseUrl(), japanId);
    const lastBlock = blocks[blocks.length - 1];
    const lastText = page.locator(`[data-testid="block-text-${lastBlock.id}"]`);
    await lastText.click();
    // Use execCommand to press Enter (creates new block)
    await page.keyboard.press('Enter');

    // Wait for the new block to appear
    await waitForBlockCount(page, blocks.length + 1);
    await page.waitForTimeout(500);

    // Get the new block's id from the API so we can target it precisely
    const blocksNow = await getBlocks(baseUrl(), japanId);
    const newBlock = blocksNow[blocksNow.length - 1];

    // Type "/" via execCommand to reliably trigger React onInput
    await page.evaluate((blockId: string) => {
      const el = document.querySelector(`[data-testid="block-text-${blockId}"]`) as HTMLElement;
      if (!el) throw new Error('Block text element not found');
      el.focus();
      document.execCommand('insertText', false, '/');
    }, newBlock.id);
    await page.waitForTimeout(500);

    const slashMenu = page.locator('.slash-menu');
    await slashMenu.waitFor({ state: 'visible', timeout: 5000 });

    // All 11 block types should be listed
    const allItems = slashMenu.locator('[role="option"]');
    const allCount = await allItems.count();
    assert.equal(allCount, 11, `Slash menu should list 11 block types, got ${allCount}`);

    await screenshot(page, 'e2e-phase2-slash-menu-all');

    // Re-focus the contenteditable, place cursor at end, then type "hea" to
    // append to "/" making "/hea".  React re-render from the slash menu
    // opening can reset cursor position, so we re-establish it.
    await page.evaluate((blockId: string) => {
      const el = document.querySelector(`[data-testid="block-text-${blockId}"]`) as HTMLElement;
      if (!el) throw new Error('Block text element not found');
      el.focus();
      // Place cursor at the end
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false); // false = collapse to end
      selection!.removeAllRanges();
      selection!.addRange(range);
      document.execCommand('insertText', false, 'hea');
    }, newBlock.id);

    // Wait for the filter to take effect (React re-render)
    await page.waitForFunction(
      () => document.querySelectorAll('.slash-menu [role="option"]').length === 3,
      { timeout: 5000 }
    );

    const filteredItems = slashMenu.locator('[role="option"]');
    const filteredCount = await filteredItems.count();
    assert.equal(filteredCount, 3, `Filtered menu should show 3 headings, got ${filteredCount}`);

    const filteredTexts = await filteredItems.allTextContents();
    assert.ok(filteredTexts.some((t) => t.includes('Heading 1')), 'Should include Heading 1');
    assert.ok(filteredTexts.some((t) => t.includes('Heading 2')), 'Should include Heading 2');
    assert.ok(filteredTexts.some((t) => t.includes('Heading 3')), 'Should include Heading 3');

    await screenshot(page, 'e2e-phase2-slash-menu-filtered');

    // ArrowDown to the second item (Heading 2) and Enter to pick it
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    const activeItem = slashMenu.locator('[aria-selected="true"]');
    const activeText = await activeItem.textContent();
    assert.ok(
      activeText?.includes('Heading 2'),
      `Active item should be Heading 2, got: ${activeText}`
    );

    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Menu should be closed
    const menuVisible = await slashMenu.isVisible().catch(() => false);
    assert.ok(!menuVisible, 'Slash menu should close after Enter');

    // The block that was "/" should now be an h2
    const convertedBlock = page.locator(`[data-testid="block-${newBlock.id}"]`);
    const blockType = await convertedBlock.getAttribute('data-block-type');
    assert.equal(blockType, 'h2', 'New block should be converted to h2');

    await screenshot(page, 'e2e-phase2-slash-insert-keyboard');
  });

  /* ================================================================ */
  /*  TC-2b: slash menu -- mouse click inserts callout                 */
  /*  (SC-2)                                                          */
  /* ================================================================ */

  it('TC-2b: slash menu inserts via mouse click', async () => {
    await gotoJapan();

    const blocks = await getBlocks(baseUrl(), japanId);
    const lastBlock = blocks[blocks.length - 1];
    const lastText = page.locator(`[data-testid="block-text-${lastBlock.id}"]`);
    await lastText.click();
    await page.keyboard.press('Enter');

    await waitForBlockCount(page, blocks.length + 1);
    await page.waitForTimeout(500);

    const blocksNow = await getBlocks(baseUrl(), japanId);
    const newBlock = blocksNow[blocksNow.length - 1];

    // Type "/" via execCommand
    await page.evaluate((blockId: string) => {
      const el = document.querySelector(`[data-testid="block-text-${blockId}"]`) as HTMLElement;
      if (!el) throw new Error('Block text element not found');
      el.focus();
      document.execCommand('insertText', false, '/');
    }, newBlock.id);
    await page.waitForTimeout(500);

    const slashMenu = page.locator('.slash-menu');
    await slashMenu.waitFor({ state: 'visible', timeout: 5000 });

    // Hover and click the "Callout" option
    const calloutItem = slashMenu.locator('[role="option"]:has-text("Callout")');
    await calloutItem.hover();
    await page.waitForTimeout(100);
    await calloutItem.click();
    await page.waitForTimeout(500);

    const menuVisible = await slashMenu.isVisible().catch(() => false);
    assert.ok(!menuVisible, 'Slash menu should close after click');

    const convertedBlock = page.locator(`[data-testid="block-${newBlock.id}"]`);
    const blockType = await convertedBlock.getAttribute('data-block-type');
    assert.equal(blockType, 'callout', 'New block should be callout');

    await screenshot(page, 'e2e-phase2-slash-insert-mouse');
  });

  /* ================================================================ */
  /*  TC-3: slash menu Escape closes without inserting  (SC-2)        */
  /* ================================================================ */

  it('TC-3: slash menu closes on Escape without inserting', async () => {
    await gotoJapan();

    const blocks = await getBlocks(baseUrl(), japanId);
    const lastBlock = blocks[blocks.length - 1];
    const lastText = page.locator(`[data-testid="block-text-${lastBlock.id}"]`);
    await lastText.click();
    await page.keyboard.press('Enter');

    await waitForBlockCount(page, blocks.length + 1);
    await page.waitForTimeout(500);

    const blocksNow = await getBlocks(baseUrl(), japanId);
    const newBlock = blocksNow[blocksNow.length - 1];

    // Type "/" via execCommand
    await page.evaluate((blockId: string) => {
      const el = document.querySelector(`[data-testid="block-text-${blockId}"]`) as HTMLElement;
      if (!el) throw new Error('Block text element not found');
      el.focus();
      document.execCommand('insertText', false, '/');
    }, newBlock.id);
    await page.waitForTimeout(500);

    const slashMenu = page.locator('.slash-menu');
    await slashMenu.waitFor({ state: 'visible', timeout: 5000 });

    // Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const menuVisible = await slashMenu.isVisible().catch(() => false);
    assert.ok(!menuVisible, 'Slash menu should close on Escape');

    // The text should be cleared (Escape removes the "/")
    const blockTextAfter = await page.locator(`[data-testid="block-text-${newBlock.id}"]`).textContent();
    assert.equal(blockTextAfter, '', 'Block text should be empty after Escape');

    await screenshot(page, 'e2e-phase2-slash-escape');
  });

  /* ================================================================ */
  /*  TC-4: todo checkbox toggle persists  (SC-4)                     */
  /* ================================================================ */

  it('TC-4: todo checkbox toggle persists across reload', async () => {
    await gotoJapan();

    // Find the "Reserve ryokan in Kyoto" todo (unchecked in seed)
    const blocks = await getBlocks(baseUrl(), japanId);
    const todoBlock = blocks.find(
      (b) => b.type === 'todo' && b.content.text === 'Reserve ryokan in Kyoto'
    );
    assert.ok(todoBlock, 'Should find "Reserve ryokan in Kyoto" todo block');
    assert.equal(todoBlock.content.checked, false, 'Should start unchecked');

    // Click the checkbox
    const checkbox = page.locator(
      `[data-testid="block-${todoBlock.id}"] .block-todo-checkbox`
    );
    await checkbox.click();
    await page.waitForTimeout(1500); // debounce + buffer

    // Verify the check happened in the DOM before reload
    const isCheckedNow = await checkbox.isChecked();
    assert.ok(isCheckedNow, 'Checkbox should be checked immediately after click');

    // Reload
    await page.reload();
    await page.waitForSelector('[data-testid="block-editor"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid^="block-text-"]', { timeout: 10000 });

    const checkboxAfter = page.locator(
      `[data-testid="block-${todoBlock.id}"] .block-todo-checkbox`
    );
    const isCheckedAfter = await checkboxAfter.isChecked();
    assert.ok(isCheckedAfter, 'Todo should remain checked after reload');

    await screenshot(page, 'e2e-phase2-todo-toggle');
  });

  /* ================================================================ */
  /*  TC-5: drag reorder persists  (SC-5)                             */
  /* ================================================================ */

  it('TC-5: drag reorder via keyboard sensor persists across reload', async () => {
    await gotoJapan();

    // Get the Osaka numbered block (move it down 2 positions)
    const blocksBefore = await getBlocks(baseUrl(), japanId);
    const osakaBlock = blocksBefore.find(
      (b) => b.type === 'numbered' && b.content.text?.includes('Osaka')
    );
    assert.ok(osakaBlock, 'Should find Osaka numbered block');
    const osakaPosBefore = osakaBlock.position;

    // Focus the drag handle via :focus-within (click text first)
    const textEl = page.locator(`[data-testid="block-text-${osakaBlock.id}"]`);
    await textEl.click();
    await page.waitForTimeout(100);

    const handle = page.locator(`[data-testid="block-drag-${osakaBlock.id}"]`);
    await handle.focus();
    await page.waitForTimeout(200);

    // Keyboard sensor: Space to lift, ArrowDown x2, Space to drop
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500); // debounce

    // Reload
    await page.reload();
    await page.waitForSelector('[data-testid="block-editor"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid^="block-text-"]', { timeout: 10000 });

    // Verify the order changed
    const blocksAfter = await getBlocks(baseUrl(), japanId);
    const osakaAfter = blocksAfter.find(
      (b) => b.type === 'numbered' && b.content.text?.includes('Osaka')
    );
    assert.ok(osakaAfter, 'Osaka block should still exist after reload');
    assert.notEqual(
      osakaPosBefore,
      osakaAfter.position,
      `Osaka should have moved from position ${osakaPosBefore} to ${osakaAfter.position}`
    );

    await screenshot(page, 'e2e-phase2-drag-reorder');
  });

  /* ================================================================ */
  /*  TC-6: Enter / Backspace block behaviour  (SC-1)                 */
  /* ================================================================ */

  it('TC-6: Enter in bulleted -> new bulleted; Enter in paragraph -> new paragraph; Backspace removes empty block', async () => {
    await gotoJapan();

    const blocks0 = await getBlocks(baseUrl(), japanId);
    const count0 = blocks0.length;

    /* --- Part A: Enter at end of bulleted item -> new bulleted --- */
    const bulletedBlock = blocks0.find(
      (b) => b.type === 'bulleted' && b.content.text?.includes('Rail pass')
    );
    assert.ok(bulletedBlock, 'Should find "Rail pass" bulleted block');

    const bulletedText = page.locator(`[data-testid="block-text-${bulletedBlock.id}"]`);
    await bulletedText.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);

    const blocks1 = await getBlocks(baseUrl(), japanId);
    assert.equal(blocks1.length, count0 + 1, 'One new block after Enter on bulleted');

    const bulletedIdx = blocks1.findIndex((b) => b.id === bulletedBlock.id);
    const afterBulleted = blocks1[bulletedIdx + 1];
    assert.ok(afterBulleted, 'Should have a block after the bulleted item');
    assert.equal(afterBulleted.type, 'bulleted', 'New block after bulleted should be bulleted');

    /* --- Part B: Enter at end of paragraph -> new paragraph --- */
    const paraBlock = blocks1.find((b) => b.type === 'paragraph');
    assert.ok(paraBlock, 'Should find a paragraph block');

    const paraText = page.locator(`[data-testid="block-text-${paraBlock.id}"]`);
    await paraText.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);

    const blocks2 = await getBlocks(baseUrl(), japanId);
    assert.equal(blocks2.length, count0 + 2, 'Two new blocks total');

    const paraIdx = blocks2.findIndex((b) => b.id === paraBlock.id);
    const afterPara = blocks2[paraIdx + 1];
    assert.ok(afterPara, 'Should have a block after the paragraph');
    assert.equal(afterPara.type, 'paragraph', 'New block after paragraph should be paragraph');

    /* --- Part C: Backspace at start of empty block removes it --- */
    const emptyText = page.locator(`[data-testid="block-text-${afterPara.id}"]`);
    await emptyText.click();
    await page.keyboard.press('Home');
    await page.waitForTimeout(100);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(800);

    const blocks3 = await getBlocks(baseUrl(), japanId);
    assert.equal(blocks3.length, count0 + 1, 'Empty block removed, net +1 from Part A');

    await screenshot(page, 'e2e-phase2-enter-backspace');
  });

  /* ================================================================ */
  /*  TC-7: all block types visible and distinct  (SC-1)              */
  /* ================================================================ */

  it('TC-7: all 11 block types are visible and render distinctly on Japan 2027', async () => {
    await gotoJapan();

    // Every block type in the seed should exist in the DOM
    const expectedTypes = [
      'callout', 'h1', 'paragraph', 'h2', 'numbered',
      'todo', 'divider', 'quote', 'h3', 'bulleted', 'code',
    ] as const;

    for (const type of expectedTypes) {
      const el = page.locator(`[data-block-type="${type}"]`).first();
      const visible = await el.isVisible();
      assert.ok(visible, `Block type "${type}" should be visible`);
    }

    // Distinct visual affordances
    // Callout: panel wrapper
    assert.ok(
      await page.locator('.block-callout-panel').first().isVisible(),
      'Callout should render with .block-callout-panel'
    );

    // Bulleted: bullet marker
    const bulletMarker = page.locator('.block-bullet-marker').first();
    assert.ok(await bulletMarker.isVisible(), 'Bulleted should have bullet marker');
    assert.equal(await bulletMarker.textContent(), '\u2022', 'Bullet marker is "bullet"');

    // Numbered: number marker
    const numberMarker = page.locator('.block-number-marker').first();
    assert.ok(await numberMarker.isVisible(), 'Numbered should have number marker');
    const numberText = await numberMarker.textContent();
    assert.ok(numberText?.endsWith('.'), 'Number marker should end with "."');

    // Todo: checkbox
    assert.ok(
      await page.locator('.block-todo-checkbox').first().isVisible(),
      'Todo should have checkbox'
    );

    // Quote: curly-quote mark
    const quoteMark = page.locator('.block-quote-mark').first();
    assert.ok(await quoteMark.isVisible(), 'Quote should have quote mark');

    // Divider: <hr>
    assert.ok(
      await page.locator('.block-divider-rule').first().isVisible(),
      'Divider should render as <hr>'
    );

    // Code: monospace-styled panel
    assert.ok(
      await page.locator('.block-text-code').first().isVisible(),
      'Code block should have .block-text-code'
    );

    // Headings: distinct font sizes via CSS classes
    assert.ok(
      await page.locator('.block-text-h1').first().isVisible(),
      'H1 should have .block-text-h1'
    );
    assert.ok(
      await page.locator('.block-text-h2').first().isVisible(),
      'H2 should have .block-text-h2'
    );
    assert.ok(
      await page.locator('.block-text-h3').first().isVisible(),
      'H3 should have .block-text-h3'
    );

    // Paragraph: present (default, no special marker)
    assert.ok(
      await page.locator('.block-text-paragraph').first().isVisible(),
      'Paragraph should have .block-text-paragraph'
    );

    await screenshot(page, 'e2e-phase2-all-block-types');
  });
});
