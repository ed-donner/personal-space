import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open QuickFind via keyboard shortcut Ctrl+K (works on any platform in Playwright). */
async function openQuickFindByShortcut(page: Page) {
  await page.keyboard.press("Control+k");
}

/** Open QuickFind via the sidebar Search button. */
async function openQuickFindByButton(page: Page) {
  await page.locator(".qf-button[aria-label='Open quick find']").click();
}

/** Wait for QuickFind modal to be visible and input to be focused. */
async function waitForQuickFindOpen(page: Page) {
  const modal = page.locator(".qf-modal[role='dialog']");
  await expect(modal).toBeVisible();
  const input = page.locator(".qf-input");
  await expect(input).toBeFocused();
}

/** Type into the QuickFind input and wait for results to settle. */
async function searchInQuickFind(page: Page, query: string) {
  const input = page.locator(".qf-input");
  await input.fill(query);
  // Wait for debounced results (debounce is 200ms + network)
  await page.waitForTimeout(800);
}

/** Assert the QuickFind modal is closed. */
async function waitForQuickFindClosed(page: Page) {
  await expect(page.locator(".qf-modal[role='dialog']")).not.toBeVisible();
}

// ---------------------------------------------------------------------------
// 1. Quick-find by shortcut: Ctrl+K -> modal opens, type "tokyo", pick result
// ---------------------------------------------------------------------------

test.describe("Quick-find by keyboard shortcut", () => {
  test("Ctrl+K opens modal, searching tokyo finds Tokyo Trip, Enter navigates", async ({
    page,
  }) => {
    await page.goto("/");

    // Open QuickFind with Ctrl+K
    await openQuickFindByShortcut(page);
    await waitForQuickFindOpen(page);

    // Type "tokyo" and wait for live results
    await searchInQuickFind(page, "tokyo");

    // Results should appear grouped -- find "Tokyo Trip" under a Pages group
    const resultsContainer = page.locator(".qf-results[role='listbox']");
    await expect(resultsContainer).toBeVisible();

    // Look for a result row containing "Tokyo Trip"
    const tokyoResult = page.locator(".qf-row").filter({ hasText: "Tokyo Trip" });
    await expect(tokyoResult).toBeVisible();

    // Verify it has a "page" tag
    const tag = tokyoResult.locator(".qf-row-tag");
    await expect(tag).toContainText("page");

    // Press Enter to select the first (active) result
    await page.keyboard.press("Enter");

    // Modal should close
    await waitForQuickFindClosed(page);

    // Should navigate to Tokyo Trip -- the page title heading should be visible
    await expect(page.locator("h1.page-title")).toContainText("Tokyo Trip");
  });
});

// ---------------------------------------------------------------------------
// 2. Quick-find by button: click sidebar Search, search for a row, click it
// ---------------------------------------------------------------------------

test.describe("Quick-find by sidebar button", () => {
  test("click sidebar Search button, search pragmatic, click row result, lands on row page", async ({
    page,
  }) => {
    await page.goto("/");

    // Open QuickFind via the sidebar button
    await openQuickFindByButton(page);
    await waitForQuickFindOpen(page);

    // Type "pragmatic"
    await searchInQuickFind(page, "pragmatic");

    // A row result should appear: "The Pragmatic Programmer" with breadcrumb "Reading List"
    const rowResult = page
      .locator(".qf-row")
      .filter({ hasText: "The Pragmatic Programmer" });
    await expect(rowResult).toBeVisible();

    // Verify the breadcrumb shows "Reading List"
    const crumb = rowResult.locator(".qf-row-crumb");
    await expect(crumb).toContainText("Reading List");

    // Verify it's tagged as "row"
    const tag = rowResult.locator(".qf-row-tag");
    await expect(tag).toContainText("row");

    // Click the result
    await rowResult.click();

    // Modal closes
    await waitForQuickFindClosed(page);

    // Should navigate to the row page -- properties panel should be visible
    const propsPanel = page.locator('.row-props[aria-label="Properties"]');
    await expect(propsPanel).toBeVisible();

    // The row title should show
    await expect(page.locator(".db-title")).toContainText("The Pragmatic Programmer");
  });
});

// ---------------------------------------------------------------------------
// 3. Live narrowing: type re -> readi -> narrow; clear -> empty; zzzz -> no results
// ---------------------------------------------------------------------------

test.describe("Live narrowing", () => {
  test("results narrow as query gets more specific, clear shows empty state, nonsense shows no results", async ({
    page,
  }) => {
    await page.goto("/");

    // Open QuickFind
    await openQuickFindByButton(page);
    await waitForQuickFindOpen(page);

    // Type "re" -- should produce multiple results
    await searchInQuickFind(page, "re");
    const resultsRe = page.locator(".qf-row");
    const countRe = await resultsRe.count();
    expect(countRe).toBeGreaterThan(1);

    // Type "readi" -- should narrow to fewer results
    await searchInQuickFind(page, "readi");
    const resultsReadi = page.locator(".qf-row");
    const countReadi = await resultsReadi.count();
    expect(countReadi).toBeLessThanOrEqual(countRe);

    // A database result "Reading List" should appear
    const readingDb = page
      .locator(".qf-row")
      .filter({ hasText: "Reading List" });
    await expect(readingDb).toBeVisible();

    // Clear the input -- should show the empty-query state
    const clearBtn = page.locator(".qf-clear[aria-label='Clear search']");
    await clearBtn.click();

    const emptyState = page.locator(".qf-empty");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("Type to search");

    // Type "zzzz" -- should show no-results state
    await searchInQuickFind(page, "zzzz");
    const noResults = page.locator(".qf-empty");
    await expect(noResults).toBeVisible();
    await expect(noResults).toContainText("No results");

    // Close modal
    await page.keyboard.press("Escape");
    await waitForQuickFindClosed(page);
  });
});

// ---------------------------------------------------------------------------
// 4. Keyboard navigation: ArrowDown/ArrowUp move highlight, Escape closes
// ---------------------------------------------------------------------------

test.describe("Keyboard navigation", () => {
  test("ArrowDown/ArrowUp move active highlight across results, Escape closes without navigating", async ({
    page,
  }) => {
    await page.goto("/");

    // Open QuickFind
    await openQuickFindByButton(page);
    await waitForQuickFindOpen(page);

    // Type a query that returns multiple results
    await searchInQuickFind(page, "pro");

    // Wait for results
    const resultsContainer = page.locator(".qf-results[role='listbox']");
    await expect(resultsContainer).toBeVisible();
    const resultCount = await page.locator(".qf-row").count();
    expect(resultCount).toBeGreaterThanOrEqual(2);

    // The first result should be active by default
    const firstResult = page.locator(".qf-row").first();
    await expect(firstResult).toHaveAttribute("data-active", "true");

    // Press ArrowDown to move to the second result
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);

    const secondResult = page.locator(".qf-row").nth(1);
    await expect(secondResult).toHaveAttribute("data-active", "true");

    // The first result should no longer be active
    await expect(firstResult).toHaveAttribute("data-active", "false");

    // Press ArrowDown again to move to the third result (if exists)
    if (resultCount >= 3) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(200);
      const thirdResult = page.locator(".qf-row").nth(2);
      await expect(thirdResult).toHaveAttribute("data-active", "true");
    }

    // Press ArrowUp to go back
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(200);

    // Second result should be active again
    await expect(secondResult).toHaveAttribute("data-active", "true");

    // Press Escape to close without navigating
    const currentUrl = page.url();
    await page.keyboard.press("Escape");

    // Modal should close
    await waitForQuickFindClosed(page);

    // URL should not have changed (no navigation happened)
    expect(page.url()).toBe(currentUrl);
  });
});

// ---------------------------------------------------------------------------
// 5. Theme toggle: click -> dark, reload -> still dark, toggle back, reload -> light
// ---------------------------------------------------------------------------

test.describe("Theme toggle", () => {
  test("toggle to dark, data-theme set, reload persists, toggle back to light, reload persists", async ({
    page,
  }) => {
    await page.goto("/");

    // Start in light mode -- clear any stored preference
    await page.evaluate(() => localStorage.removeItem("ps-theme"));
    await page.reload();
    await page.waitForTimeout(1000);

    // Verify initial light theme
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Record initial body background (light: #f7f6f3)
    const lightBg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );
    // Verify it's the light theme color
    expect(lightBg).toContain("247"); // #f7 = 247

    // Click the theme toggle to switch to dark
    const toggle = page.locator(".topbar-theme-toggle");
    // In light mode, aria-label is "Switch to dark theme"
    await expect(toggle).toHaveAttribute("aria-label", "Switch to dark theme");
    await toggle.click();

    // Verify data-theme is now "dark"
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Verify body background changed (dark: #16171a)
    const darkBg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );
    expect(darkBg).toContain("22"); // #16 = 22

    // Verify localStorage was persisted
    const stored = await page.evaluate(() => localStorage.getItem("ps-theme"));
    expect(stored).toBe("dark");

    // Reload the page
    await page.reload();
    await page.waitForTimeout(1000);

    // Still dark after reload
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // The toggle label should now be "Switch to light theme"
    await expect(toggle).toHaveAttribute("aria-label", "Switch to light theme");

    // Toggle back to light
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Verify localStorage updated
    const storedLight = await page.evaluate(() =>
      localStorage.getItem("ps-theme"),
    );
    expect(storedLight).toBe("light");

    // Reload again
    await page.reload();
    await page.waitForTimeout(1000);

    // Still light
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

// ---------------------------------------------------------------------------
// 6. Theme survives "server restart" -- localStorage is origin-persistent
//    A full page.goto reload is sufficient evidence since localStorage persists
//    across navigations (it does not clear on server restart). A real server
//    restart would kill this Playwright page, but localStorage on the same
//    origin persists; this test verifies the persistence mechanism.
// ---------------------------------------------------------------------------

test.describe("Theme persistence across page loads", () => {
  test("set dark, full navigation away and back, still dark (localStorage persists)", async ({
    page,
  }) => {
    await page.goto("/");

    // Set dark theme
    await page.evaluate(() => {
      localStorage.setItem("ps-theme", "dark");
    });
    await page.reload();
    await page.waitForTimeout(1000);

    // Verify dark
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Navigate away (to a fresh load)
    await page.goto("/");

    // Still dark
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Background should be dark
    const bg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );
    expect(bg).toContain("22"); // #16 = 22
  });
});

// ---------------------------------------------------------------------------
// 7. Screenshots: Home in light, Home in dark, QuickFind with results
// ---------------------------------------------------------------------------

test.describe("Phase 5 screenshots", () => {
  test("capture Home in light theme", async ({ page }) => {
    await page.goto("/");

    // Ensure light theme
    await page.evaluate(() => {
      localStorage.setItem("ps-theme", "light");
    });
    await page.reload();
    await page.waitForTimeout(1000);

    // Expand tree to show key items
    const tree = page.getByTestId("sidebar-tree");
    const travelRow = tree.locator('[data-row-id="travel"]');
    const tokyoVisible = await tree
      .locator('[data-row-id="tokyo-trip"]')
      .isVisible()
      .catch(() => false);
    if (!tokyoVisible && (await travelRow.isVisible())) {
      const disc = travelRow.locator(".row-disclosure");
      if (await disc.isVisible()) {
        await disc.click();
        await page.waitForTimeout(300);
      }
    }

    await page.waitForTimeout(300);
    await page.screenshot({
      path: "/workspaces/personal-space/screenshots/e2e-phase5-light.png",
      fullPage: false,
    });
  });

  test("capture Home in dark theme", async ({ page }) => {
    await page.goto("/");

    // Set dark theme
    await page.evaluate(() => {
      localStorage.setItem("ps-theme", "dark");
    });
    await page.reload();
    await page.waitForTimeout(1000);

    // Expand tree to show key items
    const tree = page.getByTestId("sidebar-tree");
    const travelRow = tree.locator('[data-row-id="travel"]');
    const tokyoVisible = await tree
      .locator('[data-row-id="tokyo-trip"]')
      .isVisible()
      .catch(() => false);
    if (!tokyoVisible && (await travelRow.isVisible())) {
      const disc = travelRow.locator(".row-disclosure");
      if (await disc.isVisible()) {
        await disc.click();
        await page.waitForTimeout(300);
      }
    }

    await page.waitForTimeout(300);
    await page.screenshot({
      path: "/workspaces/personal-space/screenshots/e2e-phase5-dark.png",
      fullPage: false,
    });
  });

  test("capture QuickFind open with results", async ({ page }) => {
    await page.goto("/");

    // Open QuickFind via the sidebar button
    await openQuickFindByButton(page);
    await waitForQuickFindOpen(page);

    // Type a query that produces grouped results
    await searchInQuickFind(page, "reading");

    // Wait for results to appear
    const resultRows = page.locator(".qf-row");
    await expect(resultRows.first()).toBeVisible();

    // Give the UI a moment to settle
    await page.waitForTimeout(300);

    await page.screenshot({
      path: "/workspaces/personal-space/screenshots/e2e-phase5-quickfind.png",
      fullPage: false,
    });
  });
});
