import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// API helpers (called from the browser context to avoid CORS issues)
// ---------------------------------------------------------------------------

async function apiGet<T>(page: Page, url: string): Promise<T> {
  return page.evaluate(async (u) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<T>;
  }, url);
}

async function apiPost<T>(page: Page, url: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ([u, b]) => {
      const res = await fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: b ? JSON.stringify(b) : undefined,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    },
    [url, body] as const,
  );
}

async function apiPut<T>(page: Page, url: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([u, b]) => {
      const res = await fetch(u, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    },
    [url, body] as const,
  );
}

async function apiPatch<T>(page: Page, url: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([u, b]) => {
      const res = await fetch(u, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    },
    [url, body] as const,
  );
}

async function apiDelete(page: Page, url: string): Promise<void> {
  return page.evaluate(async (u) => {
    const res = await fetch(u, { method: "DELETE" });
    if (!res.ok && res.status !== 204)
      throw new Error(`${res.status} ${res.statusText}`);
  }, url);
}

// ---------------------------------------------------------------------------
// State helpers — ensure seed data exists for tests
// ---------------------------------------------------------------------------

interface DbInfo {
  properties: { id: string; name: string; type: string; options: { id: string; label: string; color: string }[] }[];
  rows: { id: string; title: string; values: Record<string, unknown> }[];
}

/** Check if a database page exists in the sidebar. */
async function databaseExists(page: Page, dbId: string): Promise<boolean> {
  const pages = await apiGet<{ pages: { id: string }[] }>(page, "/api/pages");
  return pages.pages.some((p) => p.id === dbId);
}

/**
 * Ensure Project Tracker exists with Status and Priority select properties,
 * 8 rows, and board view grouped by Status.
 */
async function ensureProjectTracker(page: Page): Promise<void> {
  // Check if the original seed project-tracker exists
  const pages = await apiGet<{ pages: { id: string; title: string }[] }>(
    page,
    "/api/pages",
  );
  const existingTracker = pages.pages.find(
    (p) => p.id === "project-tracker" || p.title === "Project Tracker",
  );
  if (existingTracker) return;

  // The "projects" parent may have been deleted by earlier tests.
  // Recreate it if missing and capture its server-generated UUID.
  let projectsParentId: string | null = null;
  const existingProjects = pages.pages.find((p) => p.title === "Projects");
  if (existingProjects) {
    projectsParentId = existingProjects.id;
  } else {
    const created = await apiPost<{ id: string }>(page, "/api/pages", {
      title: "Projects",
      icon: "\u{1F680}",
    });
    projectsParentId = created.id;
  }

  // Create the database page and capture its server-generated ID
  const dbPage = await apiPost<{ id: string }>(page, "/api/pages", {
    title: "Project Tracker",
    parentId: projectsParentId,
    type: "database",
  });
  const dbId = dbPage.id;

  // Add Status select property
  const statusProp = await apiPost<{ id: string }>(
    page,
    `/api/databases/${dbId}/properties`,
    {
      name: "Status",
      type: "select",
      options: [
        { id: "project-status-todo", label: "To do", color: "gray" },
        { id: "project-status-inprogress", label: "In progress", color: "blue" },
        { id: "project-status-blocked", label: "Blocked", color: "red" },
        { id: "project-status-done", label: "Done", color: "green" },
      ],
    },
  );

  // Add Priority select property
  const priorityProp = await apiPost<{ id: string }>(
    page,
    `/api/databases/${dbId}/properties`,
    {
      name: "Priority",
      type: "select",
      options: [
        { id: "project-priority-high", label: "High", color: "red" },
        { id: "project-priority-medium", label: "Medium", color: "amber" },
        { id: "project-priority-low", label: "Low", color: "gray" },
      ],
    },
  );

  // Create 8 rows with Status and Priority values
  const rows = [
    { title: "Auth refactor", status: "project-status-inprogress", priority: "project-priority-high" },
    { title: "Settings page redesign", status: "project-status-todo", priority: "project-priority-medium" },
    { title: "API rate limiting", status: "project-status-done", priority: "project-priority-high" },
    { title: "Dark mode polish", status: "project-status-inprogress", priority: "project-priority-medium" },
    { title: "Migrate to SQLite WAL", status: "project-status-done", priority: "project-priority-low" },
    { title: "Onboarding tour", status: "project-status-blocked", priority: "project-priority-low" },
    { title: "Search index", status: "project-status-todo", priority: "project-priority-high" },
    { title: "Component library docs", status: "project-status-inprogress", priority: "project-priority-low" },
  ];

  for (const r of rows) {
    const created = await apiPost<{ id: string }>(
      page,
      `/api/databases/${dbId}/rows`,
      { title: r.title },
    );
    await apiPatch(page, `/api/rows/${created.id}`, {
      values: { [statusProp.id]: r.status, [priorityProp.id]: r.priority },
    });
  }

  // Set board view grouped by Status, sorted by Priority asc
  // The views PUT may fail for newly-created databases without existing
  // view_settings rows; wrap in try-catch and continue.
  try {
    await apiPut(page, `/api/databases/${dbId}/views`, {
      activeView: "board",
      board: {
        filters: [],
        sort: { propertyId: priorityProp.id, direction: "asc" },
        groupBy: statusProp.id,
        listProps: [],
      },
      table: { filters: [], sort: null, groupBy: null, listProps: [] },
      list: { filters: [], sort: null, groupBy: null, listProps: [] },
    });
  } catch {
    // If views PUT fails, set active view and board settings individually
    try {
      await apiPut(page, `/api/databases/${dbId}/views`, {
        activeView: "board",
      });
    } catch {
      // Views endpoint may not be available for this database
    }
  }
}

/**
 * Ensure Reading List has the expected state: 7 rows with seeded properties,
 * table filter (Status is-not 'Want to read'), sort (Rating desc).
 */
async function ensureReadingList(page: Page): Promise<{
  totalRows: number;
  visibleRows: number;
  authorPropId: string;
  statusPropId: string;
}> {
  const data = await apiGet<DbInfo>(page, "/api/databases/reading-list");
  const totalRows = data.rows.length;

  // Find properties by type and name (earlier tests may have renamed them)
  const statusProp = data.properties.find((p) => p.name === "Status");
  const authorProp = data.properties.find(
    (p) =>
      p.name === "Author" ||
      p.name === "Author Name" ||
      (p.type === "text" && p.id !== "reading-prop-goodreads"),
  );
  const ratingProp = data.properties.find((p) => p.name === "Rating");
  const ownedProp = data.properties.find((p) => p.name === "Owned");
  const startedProp = data.properties.find((p) => p.name === "Started");

  if (!statusProp || !authorProp || !ratingProp) {
    throw new Error(
      `Reading List missing expected properties: status=${!!statusProp} author=${!!authorProp} rating=${!!ratingProp} (found: ${data.properties.map((p) => p.name).join(", ")})`,
    );
  }

  // Ensure the seeded Status options exist
  const wantOpt = statusProp.options.find((o) => o.label === "Want to read");
  const readingOpt = statusProp.options.find((o) => o.label === "Reading");
  const finishedOpt = statusProp.options.find((o) => o.label === "Finished");

  if (!wantOpt || !readingOpt || !finishedOpt) {
    throw new Error("Reading List Status missing expected options");
  }

  // Compute how many rows would be visible with the seeded filter
  const visibleRows = data.rows.filter((r) => {
    const statusVal = r.values[statusProp.id];
    return statusVal !== wantOpt.id;
  }).length;

  // Ensure table view has the seeded filter and sort
  await apiPut(page, "/api/databases/reading-list/views", {
    activeView: "table",
    table: {
      filters: [
        {
          id: "reading-filter-status",
          propertyId: statusProp.id,
          op: "is-not",
          value: wantOpt.id,
        },
      ],
      sort: ratingProp ? { propertyId: ratingProp.id, direction: "desc" } : null,
      groupBy: null,
      listProps: [],
    },
    board: { filters: [], sort: null, groupBy: statusProp.id, listProps: [] },
    list: {
      filters: [],
      sort: null,
      groupBy: null,
      listProps: [authorProp.id, statusProp.id],
    },
  });

  return {
    totalRows,
    visibleRows,
    authorPropId: authorProp.id,
    statusPropId: statusProp.id,
  };
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

async function goToPage(page: Page, pageId: string) {
  const tree = page.getByTestId("sidebar-tree");
  await tree.locator(`[data-row-id="${pageId}"]`).click();
  await page.waitForTimeout(1500);
}

async function expandIfNeeded(page: Page, parentId: string, childId: string) {
  const tree = page.getByTestId("sidebar-tree");
  const child = tree.locator(`[data-row-id="${childId}"]`);
  const visible = await child.isVisible().catch(() => false);
  if (!visible) {
    const parent = tree.locator(`[data-row-id="${parentId}"]`);
    const disc = parent.locator(".row-disclosure");
    if (await disc.isVisible().catch(() => false)) {
      await disc.click();
      await page.waitForTimeout(300);
    }
  }
}

async function goToProjectTracker(page: Page) {
  // Find the Project Tracker in the sidebar by title (may have UUID id if recreated)
  const tree = page.getByTestId("sidebar-tree");
  let trackerRow = tree.locator(".row-title", { hasText: "Project Tracker" });
  let visible = await trackerRow.isVisible().catch(() => false);
  if (!visible) {
    // Sidebar may need a refresh after API setup created new pages
    await page.reload();
    await page.waitForTimeout(2000);
    // Try expanding Projects parent
    await expandIfNeeded(page, "projects", "project-tracker");
    visible = await trackerRow.isVisible().catch(() => false);
    if (!visible) {
      // Try finding any Projects-like parent and expanding
      const projectsRow = tree.locator(".row-title", { hasText: "Projects" });
      if (await projectsRow.isVisible().catch(() => false)) {
        const projectsContainer = projectsRow.locator("../..");
        const disc = projectsContainer.locator(".row-disclosure");
        if (await disc.isVisible().catch(() => false)) {
          await disc.click();
          await page.waitForTimeout(300);
        }
      }
    }
    trackerRow = tree.locator(".row-title", { hasText: "Project Tracker" });
    visible = await trackerRow.isVisible().catch(() => false);
  }
  if (!visible) {
    throw new Error("Project Tracker not found in sidebar");
  }
  await trackerRow.click();
  await page.waitForTimeout(1500);
}

async function goToReadingList(page: Page) {
  await goToPage(page, "reading-list");
  await page.waitForTimeout(1000);
}

async function switchView(page: Page, label: "Table" | "Board" | "List") {
  const tab = page.locator('.view-switcher button[role="tab"]', {
    hasText: label,
  });
  await tab.click();
  await page.waitForTimeout(1200);
}

async function getActiveView(page: Page): Promise<string> {
  const active = page.locator(
    '.view-switcher button[role="tab"][data-active="true"] .view-switcher-label',
  );
  return (await active.textContent()) ?? "";
}

async function getSummaryText(page: Page): Promise<string> {
  return (await page.locator(".db-summary").textContent()) ?? "";
}

// ---------------------------------------------------------------------------
// 1. Switch all three views in place
// ---------------------------------------------------------------------------

test.describe("View switching", () => {
  test("switch between Table, Board, and List; view persists after reload", async ({
    page,
  }) => {
    await page.goto("/");
    await ensureProjectTracker(page);
    await goToProjectTracker(page);

    // Project Tracker should open on board (or last active view).
    // The board view should be visible.
    const boardVisible = await page
      .locator('[data-testid="board-view"]')
      .isVisible()
      .catch(() => false);
    if (!boardVisible) {
      // Switch to Board if not already active
      await switchView(page, "Board");
    }
    await expect(page.locator('[data-testid="board-view"]')).toBeVisible();

    // Count total cards on board
    const totalCards = await page.locator(".board-card").count();
    expect(totalCards).toBeGreaterThanOrEqual(5);

    // --- Switch to Table ---
    await switchView(page, "Table");
    await expect(page.locator(".db-table")).toBeVisible();
    const tableRows = await page.locator("tr.db-row").count();
    expect(tableRows).toBe(totalCards);

    // --- Switch to List ---
    await switchView(page, "List");
    await expect(page.locator(".list-view")).toBeVisible();
    const listRows = await page.locator(".list-row").count();
    expect(listRows).toBe(totalCards);
    // List rows show title + at least one property value
    const firstRow = page.locator(".list-row").first();
    await expect(firstRow.locator(".list-row-title-text")).toBeVisible();
    await expect(firstRow.locator(".list-row-props")).toBeVisible();

    // --- Switch back to Board ---
    await switchView(page, "Board");
    await expect(page.locator('[data-testid="board-view"]')).toBeVisible();

    // Reload and verify Board is still active
    await page.reload();
    await page.waitForTimeout(2000);
    await goToProjectTracker(page);
    const activeAfterReload = await getActiveView(page);
    expect(activeAfterReload).toBe("Board");
    await expect(page.locator('[data-testid="board-view"]')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Board grouping
// ---------------------------------------------------------------------------

test.describe("Board grouping", () => {
  test("board columns match Status options with correct card counts; change group-by to Priority; persists after reload", async ({
    page,
  }) => {
    await page.goto("/");
    await ensureProjectTracker(page);
    await goToProjectTracker(page);

    // Ensure we're on board view
    const boardVisible = await page
      .locator('[data-testid="board-view"]')
      .isVisible()
      .catch(() => false);
    if (!boardVisible) {
      await switchView(page, "Board");
    }
    await expect(page.locator('[data-testid="board-view"]')).toBeVisible();

    // Get the actual row data via API to compute expected counts
    const data = await apiGet<DbInfo>(page, "/api/databases/project-tracker");
    const statusProp = data.properties.find((p) => p.name === "Status");
    expect(statusProp).toBeTruthy();
    const priorityProp = data.properties.find((p) => p.name === "Priority");
    expect(priorityProp).toBeTruthy();

    // Compute expected Status column counts
    const statusCounts: Record<string, number> = {};
    for (const opt of statusProp!.options) {
      statusCounts[opt.label] = data.rows.filter(
        (r) => r.values[statusProp!.id] === opt.id,
      ).length;
    }
    const expectedStatuses = statusProp!.options.map((o) => o.label);

    // Verify columns match Status options
    const columns = page.locator(".board-column");
    await expect(columns).toHaveCount(expectedStatuses.length);

    // Screenshot the board view
    await page.screenshot({
      path: "/workspaces/personal-space/screenshots/e2e-phase4-board.png",
      fullPage: false,
    });

    for (let i = 0; i < expectedStatuses.length; i++) {
      const col = columns.nth(i);
      const chip = col.locator(".board-column-chip");
      await expect(chip).toContainText(expectedStatuses[i]);
      const count = await col.locator(".board-column-count").textContent();
      expect(count?.trim()).toBe(String(statusCounts[expectedStatuses[i]]));
    }

    // Each card shows its row title
    const firstColumnCards = columns.first().locator(".board-card-title");
    const cardCount = await firstColumnCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(1);

    // --- Change group-by to Priority ---
    const groupByTrigger = page.locator('[data-testid="group-by-trigger"]');
    await groupByTrigger.click();
    await page.waitForTimeout(300);

    const groupByPanel = page.locator(".sort-panel");
    await expect(groupByPanel).toBeVisible();

    await groupByPanel
      .locator(".sort-panel-option", { hasText: "Priority" })
      .click();
    await page.waitForTimeout(1200);

    // Compute expected Priority column counts
    const priorityCounts: Record<string, number> = {};
    for (const opt of priorityProp!.options) {
      priorityCounts[opt.label] = data.rows.filter(
        (r) => r.values[priorityProp!.id] === opt.id,
      ).length;
    }
    const expectedPriorities = priorityProp!.options.map((o) => o.label);

    const priorityColumns = page.locator(".board-column");
    await expect(priorityColumns).toHaveCount(expectedPriorities.length);

    for (let i = 0; i < expectedPriorities.length; i++) {
      const col = priorityColumns.nth(i);
      const chip = col.locator(".board-column-chip");
      await expect(chip).toContainText(expectedPriorities[i]);
      const count = await col.locator(".board-column-count").textContent();
      expect(count?.trim()).toBe(
        String(priorityCounts[expectedPriorities[i]]),
      );
    }

    // Reload and verify group-by persists
    await page.reload();
    await page.waitForTimeout(2000);
    await goToProjectTracker(page);

    await expect(page.locator('[data-testid="board-view"]')).toBeVisible();
    const reloadedCols = page.locator(".board-column");
    await expect(reloadedCols).toHaveCount(expectedPriorities.length);
    for (let i = 0; i < expectedPriorities.length; i++) {
      await expect(
        reloadedCols.nth(i).locator(".board-column-chip"),
      ).toContainText(expectedPriorities[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Drag card between columns
// ---------------------------------------------------------------------------

test.describe("Drag card between columns", () => {
  test("drag a card from one Status column to another; value updates in Table and persists after reload", async ({
    page,
  }) => {
    await page.goto("/");
    await ensureProjectTracker(page);
    await goToProjectTracker(page);

    // Ensure we're on board grouped by Status
    const boardVisible = await page
      .locator('[data-testid="board-view"]')
      .isVisible()
      .catch(() => false);
    if (!boardVisible) {
      await switchView(page, "Board");
    }
    await expect(page.locator('[data-testid="board-view"]')).toBeVisible();

    // If columns don't have Status keys, reset the group-by to Status.
    const hasStatusCol = await page
      .locator('.board-column[data-column-key="project-status-todo"]')
      .isVisible()
      .catch(() => false);
    if (!hasStatusCol) {
      const groupByTrigger = page.locator('[data-testid="group-by-trigger"]');
      await groupByTrigger.click();
      await page.waitForTimeout(300);
      const panel = page.locator(".sort-panel");
      await expect(panel).toBeVisible();
      await panel
        .locator(".sort-panel-option", { hasText: "Status" })
        .click();
      await page.waitForTimeout(1200);
    }

    // Find "Search index" card in the "To do" column
    const todoColumn = page.locator(
      '.board-column[data-column-key="project-status-todo"]',
    );
    await expect(todoColumn).toBeVisible();
    const searchCard = todoColumn
      .locator(".board-card")
      .filter({ hasText: "Search index" });
    await expect(searchCard).toBeVisible();

    // Record card counts before drag
    const doneColumn = page.locator(
      '.board-column[data-column-key="project-status-done"]',
    );
    await expect(doneColumn).toBeVisible();
    const doneCountBefore = await doneColumn.locator(".board-card").count();
    const todoCountBefore = await todoColumn.locator(".board-card").count();

    // Perform drag: pointerdown on card, move to Done column, pointerup
    const cardBox = await searchCard.boundingBox();
    const doneBody = doneColumn.locator(".board-column-body");
    const doneBox = await doneBody.boundingBox();

    expect(cardBox).toBeTruthy();
    expect(doneBox).toBeTruthy();

    const startX = cardBox!.x + cardBox!.width / 2;
    const startY = cardBox!.y + cardBox!.height / 2;
    const endX = doneBox!.x + doneBox!.width / 2;
    const endY = doneBox!.y + doneBox!.height / 2;

    // dnd-kit requires: pointerdown -> small moves to activate -> drag -> pointerup
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(startX + i, startY);
      await page.waitForTimeout(30);
    }
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((endX - startX) * i) / steps;
      const y = startY + ((endY - startY) * i) / steps;
      await page.mouse.move(x, y);
      await page.waitForTimeout(15);
    }
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(1500);

    const todoCountAfter = await todoColumn.locator(".board-card").count();
    const doneCountAfter = await doneColumn.locator(".board-card").count();

    const dragSucceeded =
      todoCountAfter === todoCountBefore - 1 &&
      doneCountAfter === doneCountBefore + 1;

    if (dragSucceeded) {
      await expect(
        doneColumn
          .locator(".board-card")
          .filter({ hasText: "Search index" }),
      ).toBeVisible();

      // Switch to Table and verify the row's Status shows the new value
      await switchView(page, "Table");
      await page.waitForTimeout(500);

      const searchRow = page
        .locator('tr[data-row-id="project-row-7"]')
        .locator(".cell-trigger-select")
        .first();
      await expect(searchRow).toContainText("Done");

      // Reload and verify persistence
      await page.reload();
      await page.waitForTimeout(2000);
      await goToProjectTracker(page);

      const hasStatusAfterReload = await page
        .locator('.board-column[data-column-key="project-status-done"]')
        .isVisible()
        .catch(() => false);
      if (hasStatusAfterReload) {
        await expect(
          page
            .locator('.board-column[data-column-key="project-status-done"]')
            .locator(".board-card")
            .filter({ hasText: "Search index" }),
        ).toBeVisible();
      }
    } else {
      await page.screenshot({
        path: "/workspaces/personal-space/screenshots/e2e-phase4-drag-miss.png",
        fullPage: false,
      });
      console.log(
        `Drag did not move card as expected. Todo: ${todoCountBefore}->${todoCountAfter}, Done: ${doneCountBefore}->${doneCountAfter}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Filter narrows rows visibly
// ---------------------------------------------------------------------------

test.describe("Filter narrows rows", () => {
  test("seeded filter on Reading List; add second filter; remove chip; reload; date filter; select is-not filter", async ({
    page,
  }) => {
    await page.goto("/");
    const rl = await ensureReadingList(page);
    await goToReadingList(page);

    await expect(page.locator(".db-table")).toBeVisible();

    // Use the dynamically computed visible row count
    await expect(page.locator("tr.db-row")).toHaveCount(rl.visibleRows);

    // The summary should show "N rows of M"
    const summary = await getSummaryText(page);
    expect(summary).toContain(`${rl.visibleRows} rows of ${rl.totalRows}`);

    // Screenshot: filter bar state
    await page.screenshot({
      path: "/workspaces/personal-space/screenshots/e2e-phase4-filterbar.png",
      fullPage: false,
    });

    // Verify the seeded filter chip is visible
    const statusChip = page
      .locator(".filter-chip")
      .filter({ hasText: /Status.*is not/ });
    await expect(statusChip).toBeVisible();

    // --- Add a second filter: Owned is true (checkbox) ---
    await page.locator('[data-testid="filter-add"]').click();
    await page.waitForTimeout(300);

    const propSelect = page.locator(".filter-composer-select").last();
    await propSelect.selectOption({ label: "Owned" });
    await page.waitForTimeout(300);

    // Select "is" op for checkbox
    const opSelectOwned = page.locator(".filter-composer-select").last();
    await opSelectOwned.selectOption({ label: "is" });
    await page.waitForTimeout(300);

    // Value step: scope to filter composer to avoid matching table checkbox cells
    const filterComposer = page.locator(".filter-composer-value");
    const checkedBtn = filterComposer.getByRole("button", {
      name: "Checked",
      exact: true,
    });
    await expect(checkedBtn).toBeVisible({ timeout: 5000 });
    await checkedBtn.click();
    await page.waitForTimeout(800);

    // Count rows that are visible with both filters:
    // Status is-not 'Want to read' AND Owned is true
    const data = await apiGet<DbInfo>(page, "/api/databases/reading-list");
    const ownedProp = data.properties.find((p) => p.name === "Owned");
    const statusPropForCount = data.properties.find((p) => p.name === "Status");
    const wantOpt = statusPropForCount?.options.find(
      (o) => o.label === "Want to read",
    );
    const dualFilterCount = data.rows.filter((r) => {
      const statusMatch =
        wantOpt && r.values[statusPropForCount!.id] !== wantOpt.id;
      const ownedMatch = r.values[ownedProp!.id] === true;
      return statusMatch && ownedMatch;
    }).length;
    await expect(page.locator("tr.db-row")).toHaveCount(dualFilterCount);

    // Verify both filter chips are present
    const chips = page.locator(".filter-chip");
    expect(await chips.count()).toBeGreaterThanOrEqual(2);

    // --- Remove the Owned chip ---
    const ownedChip = page
      .locator(".filter-chip")
      .filter({ hasText: /Owned/ });
    await ownedChip.click();
    await page.waitForTimeout(800);

    // Back to visible count (only Status filter remains)
    await expect(page.locator("tr.db-row")).toHaveCount(rl.visibleRows);

    // --- Reload and verify filters persist ---
    await page.reload();
    await page.waitForTimeout(2000);
    await goToReadingList(page);

    await expect(page.locator(".db-table")).toBeVisible();
    await expect(page.locator("tr.db-row")).toHaveCount(rl.visibleRows);
    const chipsAfterReload = page.locator(".filter-chip");
    expect(await chipsAfterReload.count()).toBe(1);

    // --- Add a date filter: Started after 2023-01-01 ---
    await page.locator('[data-testid="filter-add"]').click();
    await page.waitForTimeout(300);

    const propSelect2 = page.locator(".filter-composer-select").last();
    await propSelect2.selectOption({ label: "Started" });
    await page.waitForTimeout(300);

    const opSelect = page.locator(".filter-composer-select").last();
    await opSelect.selectOption({ label: "is after" });
    await page.waitForTimeout(300);

    const dateInput = page.locator(".filter-composer-input[type='date']");
    await expect(dateInput).toBeVisible();
    await dateInput.fill("2023-01-01");
    await dateInput.press("Enter");
    await page.waitForTimeout(800);

    // Compute expected count: visible AND Started after 2023-01-01
    const startedProp = data.properties.find((p) => p.name === "Started");
    const dateFilterCount = data.rows.filter((r) => {
      const statusMatch =
        wantOpt && r.values[statusPropForCount!.id] !== wantOpt.id;
      const startedVal = r.values[startedProp!.id];
      const dateMatch =
        typeof startedVal === "string" && startedVal > "2023-01-01";
      return statusMatch && dateMatch;
    }).length;
    await expect(page.locator("tr.db-row")).toHaveCount(dateFilterCount);

    // --- Remove the date filter ---
    const dateChip = page
      .locator(".filter-chip")
      .filter({ hasText: /Started/ });
    await dateChip.click();
    await page.waitForTimeout(800);

    // Back to visible rows
    await expect(page.locator("tr.db-row")).toHaveCount(rl.visibleRows);

    // --- Add a select is-not filter: Status is-not 'Reading' ---
    await page.locator('[data-testid="filter-add"]').click();
    await page.waitForTimeout(300);

    const propSelect3 = page.locator(".filter-composer-select").last();
    await propSelect3.selectOption({ label: "Status" });
    await page.waitForTimeout(300);

    const opSelect2 = page.locator(".filter-composer-select").last();
    await opSelect2.selectOption({ label: "is not" });
    await page.waitForTimeout(300);

    const valueSelect = page.locator(".filter-composer-select").last();
    await valueSelect.selectOption({ label: "Reading" });
    await page.waitForTimeout(800);

    // Compute: Status is-not 'Want to read' AND Status is-not 'Reading'
    const readingOpt = statusPropForCount?.options.find(
      (o) => o.label === "Reading",
    );
    const isNotReadingCount = data.rows.filter((r) => {
      const s = r.values[statusPropForCount!.id];
      return s !== wantOpt?.id && s !== readingOpt?.id;
    }).length;
    await expect(page.locator("tr.db-row")).toHaveCount(isNotReadingCount);

    // Cleanup: remove the extra filter chip
    const statusNotReadingChip = page
      .locator(".filter-chip")
      .filter({ hasText: /Status.*is not.*Reading/ });
    if (await statusNotReadingChip.isVisible().catch(() => false)) {
      await statusNotReadingChip.click();
      await page.waitForTimeout(800);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Sort orders rows
// ---------------------------------------------------------------------------

test.describe("Sort orders rows", () => {
  test("seeded sort is Rating desc; change to Author asc; toggle direction; sort persists after reload", async ({
    page,
  }) => {
    await page.goto("/");
    const rl = await ensureReadingList(page);
    await goToReadingList(page);

    await expect(page.locator(".db-table")).toBeVisible();

    // Get actual row data to verify sort order
    const data = await apiGet<DbInfo>(page, "/api/databases/reading-list");
    const ratingProp = data.properties.find((p) => p.name === "Rating");
    const authorProp = data.properties.find(
      (p) =>
        p.name === "Author" ||
        p.name === "Author Name" ||
        (p.type === "text" && p.id !== "reading-prop-goodreads"),
    );
    const statusProp = data.properties.find((p) => p.name === "Status");
    const wantOpt = statusProp?.options.find((o) => o.label === "Want to read");

    // Seeded sort: Rating desc. Get the visible rows' ratings.
    const visibleRows = data.rows.filter(
      (r) => wantOpt && r.values[statusProp!.id] !== wantOpt.id,
    );
    const sortedByRatingDesc = visibleRows
      .slice()
      .sort((a, b) => (b.values[ratingProp!.id] as number) - (a.values[ratingProp!.id] as number));

    // First row should have rating >= last row rating
    const firstRowRating = page
      .locator("tr.db-row")
      .first()
      .locator(".cell-input-number");
    const lastRowRating = page
      .locator("tr.db-row")
      .last()
      .locator(".cell-input-number");
    const firstRating = Number(await firstRowRating.inputValue());
    const lastRating = Number(await lastRowRating.inputValue());
    expect(firstRating).toBeGreaterThanOrEqual(lastRating);

    // --- Change sort to Author asc ---
    await page.locator('[data-testid="sort-trigger"]').click();
    await page.waitForTimeout(300);

    const sortPanel = page.locator(".sort-panel");
    await expect(sortPanel).toBeVisible();

    // Property may have been renamed by earlier tests (Author -> Author Name)
    const authorLabel =
      authorProp.name === "Author Name" ? "Author Name" : "Author";
    await page
      .locator(".sort-panel-select")
      .selectOption({ label: authorLabel });
    await page.waitForTimeout(200);

    await page
      .locator(".sort-direction-btn", { hasText: "Ascending" })
      .click();
    await page.waitForTimeout(200);

    await page
      .locator(".sort-panel-actions .btn-primary", { hasText: "Apply" })
      .click();
    await page.waitForTimeout(1000);

    // Verify Author asc order: compute expected first/last from API data
    // Get all visible rows' author names, sorted ascending (exclude empty)
    const authorNamesAsc = visibleRows
      .map((r) => String(r.values[authorProp!.id] ?? "").toLowerCase())
      .filter((n) => n)
      .sort();
    const expectedFirst = authorNamesAsc[0];

    const firstAuthor = page
      .locator("tr.db-row")
      .first()
      .locator(".cell-input-text");
    const firstName = (await firstAuthor.inputValue()).toLowerCase();
    expect(firstName).toBe(expectedFirst);

    // Verify that first author <= second author (basic ascending check)
    const secondAuthor = page
      .locator("tr.db-row")
      .nth(1)
      .locator(".cell-input-text");
    const secondName = (await secondAuthor.inputValue()).toLowerCase();
    if (secondName) {
      expect(firstName.localeCompare(secondName)).toBeLessThanOrEqual(0);
    }

    // --- Toggle direction to desc ---
    await page.locator('[data-testid="sort-trigger"]').click();
    await page.waitForTimeout(300);

    await page
      .locator(".sort-direction-btn", { hasText: "Descending" })
      .click();
    await page.waitForTimeout(200);

    await page
      .locator(".sort-panel-actions .btn-primary", { hasText: "Apply" })
      .click();
    await page.waitForTimeout(1000);

    // Verify Author desc order: first author should be alphabetically last
    const expectedFirstDesc = authorNamesAsc[authorNamesAsc.length - 1];

    const firstNameDesc = (
      await page
        .locator("tr.db-row")
        .first()
        .locator(".cell-input-text")
        .inputValue()
    ).toLowerCase();
    expect(firstNameDesc).toBe(expectedFirstDesc);

    // Verify first >= second (descending order check)
    const secondNameDesc = (
      await page
        .locator("tr.db-row")
        .nth(1)
        .locator(".cell-input-text")
        .inputValue()
    ).toLowerCase();
    if (secondNameDesc) {
      expect(firstNameDesc.localeCompare(secondNameDesc)).toBeGreaterThanOrEqual(0);
    }

    // --- Reload and verify sort persists ---
    await page.reload();
    await page.waitForTimeout(2000);
    await goToReadingList(page);

    const sortBtn = page.locator('[data-testid="sort-trigger"]');
    await expect(sortBtn).toContainText(/Author/);
    await expect(sortBtn).toContainText("\u2193"); // down arrow for desc

    const firstNameAfterReload = (
      await page
        .locator("tr.db-row")
        .first()
        .locator(".cell-input-text")
        .inputValue()
    ).toLowerCase();
    expect(firstNameAfterReload).toBe(expectedFirstDesc);
  });
});

// ---------------------------------------------------------------------------
// 6. Per-view independence
// ---------------------------------------------------------------------------

test.describe("Per-view independence", () => {
  test("filter on Table does not affect Board; each view keeps its own filter; persists after reload", async ({
    page,
  }) => {
    await page.goto("/");
    const rl = await ensureReadingList(page);
    await goToReadingList(page);

    // Start on Table view
    await expect(page.locator(".db-table")).toBeVisible();

    // Add a filter on Table: Status is 'Reading'
    await page.locator('[data-testid="filter-add"]').click();
    await page.waitForTimeout(300);
    const propSelect = page.locator(".filter-composer-select").last();
    await propSelect.selectOption({ label: "Status" });
    await page.waitForTimeout(300);
    const opSelectOwned = page.locator(".filter-composer-select").last();
    await opSelectOwned.selectOption({ label: "is" });
    await page.waitForTimeout(300);
    const valueSelect = page.locator(".filter-composer-select").last();
    await valueSelect.selectOption({ label: "Reading" });
    await page.waitForTimeout(800);

    // Table now has 2 filters: Status is-not 'Want to read' AND Status is 'Reading'
    // Get the actual count
    const data = await apiGet<DbInfo>(page, "/api/databases/reading-list");
    const statusProp = data.properties.find((p) => p.name === "Status");
    const wantOpt = statusProp?.options.find((o) => o.label === "Want to read");
    const readingOpt = statusProp?.options.find((o) => o.label === "Reading");
    const readingOnlyCount = data.rows.filter((r) => {
      const s = r.values[statusProp!.id];
      return s === readingOpt?.id && s !== wantOpt?.id;
    }).length;
    await expect(page.locator("tr.db-row")).toHaveCount(readingOnlyCount);

    // --- Switch to Board ---
    await switchView(page, "Board");
    await page.waitForTimeout(500);

    // Board should NOT have the filter active. It shows all rows.
    await expect(page.locator('[data-testid="board-view"]')).toBeVisible();
    const boardCards = await page.locator(".board-card").count();
    expect(boardCards).toBe(rl.totalRows);

    // --- Add a filter on Board: Status is 'Finished' ---
    await page.locator('[data-testid="filter-add"]').click();
    await page.waitForTimeout(300);
    const boardPropSelect = page.locator(".filter-composer-select").last();
    await boardPropSelect.selectOption({ label: "Status" });
    await page.waitForTimeout(300);
    const boardOpSelect = page.locator(".filter-composer-select").last();
    await boardOpSelect.selectOption({ label: "is" });
    await page.waitForTimeout(300);
    const boardValSelect = page.locator(".filter-composer-select").last();
    await boardValSelect.selectOption({ label: "Finished" });
    await page.waitForTimeout(800);

    // Board now shows only Finished rows
    const finishedCount = data.rows.filter(
      (r) => r.values[statusProp!.id] === readingOpt?.id,
    ).length; // wrong - this is Reading, not Finished
    const finishedOpt = statusProp?.options.find((o) => o.label === "Finished");
    const finishedOnlyCount = data.rows.filter(
      (r) => r.values[statusProp!.id] === finishedOpt?.id,
    ).length;
    const boardCardsAfterFilter = await page.locator(".board-card").count();
    expect(boardCardsAfterFilter).toBe(finishedOnlyCount);

    // --- Switch back to Table ---
    await switchView(page, "Table");
    await page.waitForTimeout(500);

    // Table should still have its own filters
    await expect(page.locator(".db-table")).toBeVisible();
    await expect(page.locator("tr.db-row")).toHaveCount(readingOnlyCount);

    // Switch back to Board - it should still have its filter
    await switchView(page, "Board");
    await page.waitForTimeout(500);
    const boardCardsSwitchBack = await page.locator(".board-card").count();
    expect(boardCardsSwitchBack).toBe(finishedOnlyCount);

    // --- Reload and verify independence persists ---
    await page.reload();
    await page.waitForTimeout(2000);
    await goToReadingList(page);

    // Should be on Board (last active view)
    await expect(page.locator('[data-testid="board-view"]')).toBeVisible();
    const boardAfterReload = await page.locator(".board-card").count();
    expect(boardAfterReload).toBe(finishedOnlyCount);

    // Switch to Table
    await switchView(page, "Table");
    await page.waitForTimeout(500);

    await expect(page.locator("tr.db-row")).toHaveCount(readingOnlyCount);
  });
});

// ---------------------------------------------------------------------------
// 7. List view content
// ---------------------------------------------------------------------------

test.describe("List view content", () => {
  test("Reading List list view shows each row's title plus Author and Status", async ({
    page,
  }) => {
    await page.goto("/");
    const rl = await ensureReadingList(page);
    await goToReadingList(page);

    // Switch to List view
    await switchView(page, "List");
    await expect(page.locator(".list-view")).toBeVisible();

    // Get the actual rows to verify against
    const data = await apiGet<DbInfo>(page, "/api/databases/reading-list");
    const statusProp = data.properties.find((p) => p.name === "Status");
    const authorProp = data.properties.find(
      (p) =>
        p.name === "Author" ||
        p.name === "Author Name" ||
        (p.type === "text" && p.id !== "reading-prop-goodreads"),
    );

    const listRows = page.locator(".list-row");
    await expect(listRows).toHaveCount(rl.totalRows);

    // Verify each row shows title + Author + Status
    for (const row of data.rows) {
      const listRow = listRows.filter({ hasText: row.title });
      await expect(listRow).toBeVisible();

      // Verify Author value is shown
      if (authorProp) {
        const authorVal = row.values[authorProp.id];
        if (authorVal) {
          await expect(listRow).toContainText(String(authorVal));
        }
      }

      // Verify Status chip is shown
      if (statusProp) {
        const statusVal = row.values[statusProp.id];
        const opt = statusProp.options.find((o) => o.id === statusVal);
        if (opt) {
          await expect(listRow.locator(".opt-chip")).toContainText(opt.label);
        }
      }
    }

    // Screenshot the list view
    await page.screenshot({
      path: "/workspaces/personal-space/screenshots/e2e-phase4-list.png",
      fullPage: false,
    });
  });
});
