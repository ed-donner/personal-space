import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Seed data helpers
// ---------------------------------------------------------------------------

const SEED_TOP_LEVEL = [
  { id: "home", title: "Home", icon: "\u{1F3E0}" },
  { id: "projects", title: "Projects", icon: "\u{1F680}" },
  { id: "reading-list", title: "Reading List", icon: "\u{1F4DA}" },
  { id: "travel", title: "Travel", icon: "\u{2708}\u{FE0F}" },
  { id: "notes", title: "Notes", icon: "\u{1F4DD}" },
];

// ---------------------------------------------------------------------------
// Screenshot (runs first — before any mutations destroy seed state)
// ---------------------------------------------------------------------------

test.describe("Screenshots", () => {
  test("capture homepage screenshot", async ({ page }) => {
    await page.goto("/");

    const tree = page.getByTestId("sidebar-tree");
    await expect(tree).toBeVisible();
    await expect(page.locator(".sidebar-subtitle")).toContainText("pages");

    // Expand Projects to show the full tree if not already expanded
    const projectsRow = tree.locator('[data-row-id="projects"]');
    await expect(projectsRow).toBeVisible();

    const websiteVisible = await tree
      .locator('[data-row-id="website-redesign"]')
      .isVisible()
      .catch(() => false);
    if (!websiteVisible) {
      await projectsRow.locator(".row-disclosure").click();
      await expect(tree.locator('[data-row-id="website-redesign"]')).toBeVisible();
    }

    await page.waitForTimeout(300);

    await page.screenshot({
      path: "/workspaces/personal-space/screenshots/e2e-phase1-home.png",
      fullPage: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 1. App opens: sidebar shows seeded tree with emoji icons; a page is selected
// ---------------------------------------------------------------------------

test.describe("App launch and seeded sidebar", () => {
  test("sidebar displays seeded pages with icons and selects one", async ({
    page,
  }) => {
    await page.goto("/");

    const tree = page.getByTestId("sidebar-tree");
    await expect(tree).toBeVisible();

    // All top-level seeded pages are visible
    for (const seed of SEED_TOP_LEVEL) {
      const row = tree.locator(`[data-row-id="${seed.id}"]`);
      await expect(row).toBeVisible();
      await expect(row.locator(".row-icon")).toHaveText(seed.icon);
      await expect(row.locator(".row-title")).toHaveText(seed.title);
    }

    // A page is selected (active row exists)
    const activeRow = tree.locator('[data-active="true"]');
    await expect(activeRow).toHaveCount(1);
  });

  test("nested children are visible when parent is expanded", async ({
    page,
  }) => {
    await page.goto("/");

    const tree = page.getByTestId("sidebar-tree");
    const projectsRow = tree.locator('[data-row-id="projects"]');
    await expect(projectsRow).toBeVisible();

    // Check if Website Redesign is already visible
    const websiteRedesign = tree.locator('[data-row-id="website-redesign"]');
    const isVisible = await websiteRedesign.isVisible().catch(() => false);
    if (!isVisible) {
      await projectsRow.locator(".row-disclosure").click();
      await expect(websiteRedesign).toBeVisible();
    }

    await expect(websiteRedesign.locator(".row-title")).toHaveText(
      "Website Redesign"
    );
    await expect(websiteRedesign.locator(".row-icon")).toHaveText("\u{1F310}");

    // Expand Website Redesign to see Launch Checklist
    await websiteRedesign.locator(".row-disclosure").click();
    const launchChecklist = tree.locator('[data-row-id="launch-checklist"]');
    await expect(launchChecklist).toBeVisible();
    await expect(launchChecklist.locator(".row-title")).toHaveText(
      "Launch Checklist"
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Create a page from the sidebar; it appears in the tree; refresh; persists
// ---------------------------------------------------------------------------

test.describe("Create page", () => {
  test("creating a page adds it to the sidebar and persists after refresh", async ({
    page,
  }) => {
    await page.goto("/");

    const tree = page.getByTestId("sidebar-tree");
    const countBefore = await tree.locator(".row").count();

    // Click the "New page" button in the sidebar header
    await page.getByRole("button", { name: "New page" }).first().click();

    // A new row appears with title "Untitled"
    const untitledRow = tree.locator(".row-title", { hasText: "Untitled" }).first();
    await expect(untitledRow).toBeVisible();

    // Count increased by 1
    const countAfter = await tree.locator(".row").count();
    expect(countAfter).toBe(countBefore + 1);

    // Page counter in sidebar header should update
    const subtitle = page.locator(".sidebar-subtitle");
    const text = await subtitle.textContent();
    const pageCount = parseInt(text!, 10);
    expect(pageCount).toBeGreaterThanOrEqual(countAfter);

    // Refresh and verify persistence
    await page.reload();
    await expect(tree).toBeVisible();
    await expect(tree.locator(".row-title", { hasText: "Untitled" }).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Rename a page inline; refresh; new name persists
// ---------------------------------------------------------------------------

test.describe("Rename page", () => {
  test("renaming a page persists after refresh", async ({ page }) => {
    await page.goto("/");

    const tree = page.getByTestId("sidebar-tree");
    const uniqueName = `Renamed-${Date.now()}`;

    // Create a page to rename
    await page.getByRole("button", { name: "New page" }).first().click();
    await expect(tree.locator(".row-title", { hasText: "Untitled" }).first()).toBeVisible();

    // The newly created page should be the active row
    const activeRow = tree.locator('[data-active="true"]');
    await expect(activeRow).toHaveCount(1);

    // Double-click the active row to start inline rename
    await activeRow.dblclick();

    const input = page.locator(".row-title-input");
    await expect(input).toBeVisible();

    await input.fill(uniqueName);
    await input.press("Enter");

    await expect(tree.locator(".row-title", { hasText: uniqueName }).first()).toBeVisible();

    // Refresh and verify persistence
    await page.reload();
    await expect(tree).toBeVisible();
    await expect(tree.locator(".row-title", { hasText: uniqueName }).first()).toBeVisible();
  });

  test("renaming via the rename action button works", async ({ page }) => {
    await page.goto("/");

    const tree = page.getByTestId("sidebar-tree");
    const uniqueName = `Action-${Date.now()}`;

    // Click Home row to make it active
    const homeRow = tree.locator('[data-row-id="home"]');
    await homeRow.click();

    // The rename button has aria-label "Rename Home"
    const renameBtn = page.getByRole("button", { name: "Rename Home" });
    await renameBtn.click();

    const input = page.locator(".row-title-input");
    await expect(input).toBeVisible();
    await input.fill(uniqueName);
    await input.press("Enter");

    await expect(tree.locator(".row-title", { hasText: uniqueName }).first()).toBeVisible();
  });

  test("pressing Escape during rename cancels the rename", async ({ page }) => {
    await page.goto("/");

    const tree = page.getByTestId("sidebar-tree");

    // Create a fresh page for this test (don't rely on seed state)
    await page.getByRole("button", { name: "New page" }).first().click();
    await expect(tree.locator(".row-title", { hasText: "Untitled" }).first()).toBeVisible();

    // The newly created active row
    const activeRow = tree.locator('[data-active="true"]');
    await expect(activeRow).toHaveCount(1);

    // Double-click to start rename
    await activeRow.dblclick();

    const input = page.locator(".row-title-input");
    await expect(input).toBeVisible();
    await input.fill("Should Not Stick");
    await input.press("Escape");

    // The input should be gone and the original title remains
    await expect(input).not.toBeVisible();
    await expect(activeRow.locator(".row-title")).toHaveText("Untitled");
  });
});

// ---------------------------------------------------------------------------
// 4. Delete a page with nested children: confirm dialog, confirm, cascade
// ---------------------------------------------------------------------------

test.describe("Delete page with children", () => {
  test("confirmation dialog appears, confirming deletes page and children", async ({
    page,
  }) => {
    await page.goto("/");

    const tree = page.getByTestId("sidebar-tree");

    // Build our own fixture via API so we never destroy seeded data that other
    // specs depend on (Project Tracker lives under Projects).
    const parentRes = await page.evaluate(async () => {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "E2E Delete Test" }),
      });
      return res.json() as Promise<{ id: string }>;
    });
    const parentId = parentRes.id;

    // Create 3 child pages under the parent
    for (let i = 1; i <= 3; i++) {
      await page.evaluate(
        async ([pId, name]) => {
          await fetch("/api/pages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: name, parentId: pId }),
          });
        },
        [parentId, `Child-${i}`] as const,
      );
    }

    // Reload so the sidebar picks up the new pages
    await page.reload();
    await tree.waitFor({ state: "visible" });

    // Find the parent in the sidebar
    const parentRowTitle = tree
      .locator(".row-title", { hasText: "E2E Delete Test" })
      .first();
    await expect(parentRowTitle).toBeVisible();

    // Expand parent to confirm children exist.
    // Navigate from .row-title up to the .row element that holds the disclosure.
    const parentRowEl = parentRowTitle.locator("..");
    const disc = parentRowEl.locator(".row-disclosure");
    if (await disc.isVisible().catch(() => false)) {
      await disc.click();
      await page.waitForTimeout(300);
    }

    await expect(
      tree.locator(".row-title", { hasText: "Child-1" }),
    ).toBeVisible();
    await expect(
      tree.locator(".row-title", { hasText: "Child-2" }),
    ).toBeVisible();
    await expect(
      tree.locator(".row-title", { hasText: "Child-3" }),
    ).toBeVisible();

    // Click the parent row to make it active, then click delete
    await parentRowTitle.click();
    const deleteBtn = page.getByRole("button", {
      name: "Delete E2E Delete Test",
    });
    await deleteBtn.click();

    // Confirmation dialog appears
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("E2E Delete Test");

    // Screenshot the confirmation dialog
    await page.screenshot({
      path: "/workspaces/personal-space/screenshots/e2e-phase1-delete-confirm.png",
      fullPage: false,
    });

    // Confirm the delete
    await dialog.getByRole("button", { name: "Delete" }).click();

    // Dialog closes
    await expect(dialog).not.toBeVisible();

    // Parent and children are gone
    await expect(
      tree.locator(".row-title", { hasText: "E2E Delete Test" }),
    ).not.toBeVisible();
    await expect(
      tree.locator(".row-title", { hasText: "Child-1" }),
    ).not.toBeVisible();
    await expect(
      tree.locator(".row-title", { hasText: "Child-2" }),
    ).not.toBeVisible();
    await expect(
      tree.locator(".row-title", { hasText: "Child-3" }),
    ).not.toBeVisible();

    // Refresh to verify persistence
    await page.reload();
    await expect(tree).toBeVisible();
    await expect(
      tree.locator(".row-title", { hasText: "E2E Delete Test" }),
    ).not.toBeVisible();
    await expect(
      tree.locator(".row-title", { hasText: "Child-1" }),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Cancel on confirmation dialog keeps the page
// ---------------------------------------------------------------------------

test.describe("Cancel delete preserves page", () => {
  test("clicking Cancel on the delete dialog keeps the page and children", async ({
    page,
  }) => {
    await page.goto("/");

    const tree = page.getByTestId("sidebar-tree");

    // Expand Notes to verify Ideas is a child
    const notesRow = tree.locator('[data-row-id="notes"]');
    const ideasVisible = await tree
      .locator('[data-row-id="ideas"]')
      .isVisible()
      .catch(() => false);
    if (!ideasVisible) {
      await notesRow.locator(".row-disclosure").click();
    }
    await expect(tree.locator('[data-row-id="ideas"]')).toBeVisible();

    // Click Notes to make it active, then delete
    await notesRow.click();
    const deleteBtn = page.getByRole("button", { name: "Delete Notes" });
    await deleteBtn.click();

    // Dialog appears
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    // Cancel the delete
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Dialog closes
    await expect(dialog).not.toBeVisible();

    // Notes and Ideas are still there
    await expect(tree.locator('[data-row-id="notes"]')).toBeVisible();
    await expect(tree.locator('[data-row-id="ideas"]')).toBeVisible();
  });

  test("pressing Escape on the delete dialog cancels the delete", async ({
    page,
  }) => {
    await page.goto("/");

    const tree = page.getByTestId("sidebar-tree");

    // Click Travel to make it active
    const travelRow = tree.locator('[data-row-id="travel"]');
    await travelRow.click();

    const deleteBtn = page.getByRole("button", { name: "Delete Travel" });
    await deleteBtn.click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    // Press Escape
    await page.keyboard.press("Escape");

    // Dialog closes, Travel still exists
    await expect(dialog).not.toBeVisible();
    await expect(tree.locator('[data-row-id="travel"]')).toBeVisible();
  });
});
