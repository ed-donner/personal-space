import { chromium, Browser, Page } from 'playwright';
import path from 'node:path';

const SCREENSHOTS_DIR = path.resolve(import.meta.dirname, '..', '..', 'screenshots');

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browser;
}

export async function newPage(port: number): Promise<Page> {
  const b = await getBrowser();
  const page = await b.newPage();
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Take a screenshot and save it to the screenshots directory.
 * Returns the relative path from the repo root.
 */
export async function screenshot(
  page: Page,
  name: string
): Promise<string> {
  const fs = await import('node:fs');
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return path.relative(path.resolve(SCREENSHOTS_DIR, '..'), filePath);
}
