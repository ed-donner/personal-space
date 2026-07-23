// Phase 4 database tests: view switcher, board view, list view, filters,
// sort, groupBy. We mock fetch per the contract from the task spec, drive
// the real App, and assert both UI behavior and PUT/PATCH payloads.
//
// These tests focus on the new Phase 4 surface — the existing Phase 3
// behavior is covered by Database.test.tsx.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import type { Page, Property, PropertyOption, Row } from "./types";
import { useDatabase } from "./databaseStore";
import type {
  DatabaseViews,
  Filter,
  Sort,
  ViewSettings,
} from "./viewLogic";
import { emptyDatabaseViews } from "./viewLogic";

// ----- Test fixtures: a Project Tracker database -----

interface BackendState {
  pages: Page[];
  properties: Property[];
  rows: Row[];
  /** Per-database views. Keyed by database id. */
  views: DatabaseViews;
  /** Per-database views, for testing multiple databases (DEF-013). */
  viewsByDb: Record<string, DatabaseViews>;
  nextPropId: number;
  nextRowId: number;
}

let backend: BackendState;
const calls: { method: string; url: string; body?: unknown }[] = [];

/** Holder for the latest in-flight views GET (for stale-response tests). */
let pendingViewsResolvers: Array<{
  databaseId: string;
  resolve: (v: DatabaseViews) => void;
}> = [];

const DB_ID = "db-tracker";
const DB2_ID = "db-reading";
const PROP_STATUS = "prop-status";
const PROP_OWNER = "prop-owner";
const PROP_PRIO = "prop-prio";
const PROP_DONE = "prop-done";
const PROP_DUE = "prop-due";
const PROP_NOTES = "prop-notes";
const PROP_AUTHOR = "reading-prop-author";
const PROP_BOOK_STATUS = "reading-prop-status";

function opt(
  id: string,
  label: string,
  color: PropertyOption["color"] = "gray",
): PropertyOption {
  return { id, label, color };
}

function makeProperty(
  id: string,
  name: string,
  type: Property["type"],
  position: number,
  options: PropertyOption[] = [],
): Property {
  return { id, databaseId: DB_ID, name, type, options, position };
}

const SEED_PROPERTIES: Property[] = [
  makeProperty(PROP_STATUS, "Status", "select", 0, [
    opt("s-todo", "To do", "gray"),
    opt("s-doing", "In progress", "amber"),
    opt("s-done", "Done", "green"),
  ]),
  makeProperty(PROP_OWNER, "Owner", "select", 1, [
    opt("o-alex", "Alex", "blue"),
    opt("o-blair", "Blair", "purple"),
  ]),
  makeProperty(PROP_PRIO, "Priority", "select", 2, [
    opt("p-low", "Low", "gray"),
    opt("p-high", "High", "red"),
  ]),
  makeProperty(PROP_DONE, "Done", "checkbox", 3),
  makeProperty(PROP_DUE, "Due", "date", 4),
  makeProperty(PROP_NOTES, "Notes", "text", 5),
];

const SEED_ROWS: Row[] = [
  {
    id: "row-1",
    databaseId: DB_ID,
    title: "Wire up views endpoint",
    values: {
      [PROP_STATUS]: "s-doing",
      [PROP_OWNER]: "o-alex",
      [PROP_PRIO]: "p-high",
      [PROP_DONE]: false,
      [PROP_DUE]: "2026-08-01",
    },
    position: 0,
  },
  {
    id: "row-2",
    databaseId: DB_ID,
    title: "Polish dark mode",
    values: {
      [PROP_STATUS]: "s-todo",
      [PROP_OWNER]: "o-blair",
      [PROP_PRIO]: "p-low",
      [PROP_DONE]: false,
    },
    position: 1,
  },
  {
    id: "row-3",
    databaseId: DB_ID,
    title: "Drop the spec doc",
    values: {
      [PROP_STATUS]: "s-done",
      [PROP_OWNER]: "o-alex",
      [PROP_PRIO]: "p-low",
      [PROP_DONE]: true,
      [PROP_DUE]: "2026-07-12",
    },
    position: 2,
  },
];

function emptySettings(): ViewSettings {
  return {
    filters: [],
    sort: { propertyId: PROP_STATUS, direction: "asc" },
    groupBy: PROP_STATUS,
    listProps: [],
  };
}

function resetBackend() {
  const trackerViews: DatabaseViews = {
    activeView: "board",
    table: emptySettings(),
    board: { ...emptySettings(), sort: null },
    list: { ...emptySettings(), sort: null, groupBy: null, listProps: [] },
  };
  const readingViews: DatabaseViews = {
    activeView: "table",
    table: {
      filters: [
        {
          id: "reading-filter-1",
          propertyId: PROP_BOOK_STATUS,
          op: "is-not",
          value: "reading-opt-want",
        },
      ],
      sort: null,
      groupBy: null,
      listProps: [],
    },
    board: {
      filters: [],
      sort: null,
      groupBy: PROP_BOOK_STATUS,
      listProps: [],
    },
    list: {
      filters: [],
      sort: null,
      groupBy: null,
      listProps: [PROP_AUTHOR, PROP_BOOK_STATUS],
    },
  };
  backend = {
    pages: [
      { id: "home", parentId: null, title: "Home", icon: "🏠", type: "page", position: 0 },
      {
        id: DB_ID,
        parentId: null,
        title: "Project Tracker",
        icon: "🗂️",
        type: "database",
        position: 1,
      },
      {
        id: DB2_ID,
        parentId: null,
        title: "Reading List",
        icon: "📚",
        type: "database",
        position: 2,
      },
    ],
    properties: [
      ...SEED_PROPERTIES.map((p) => ({ ...p, options: p.options.map((o) => ({ ...o })) })),
      {
        id: PROP_AUTHOR,
        databaseId: DB2_ID,
        name: "Author",
        type: "text",
        options: [],
        position: 0,
      },
      {
        id: PROP_BOOK_STATUS,
        databaseId: DB2_ID,
        name: "Status",
        type: "select",
        options: [
          { id: "reading-opt-want", label: "Want to read", color: "gray" },
          { id: "reading-opt-reading", label: "Reading", color: "blue" },
          { id: "reading-opt-finished", label: "Finished", color: "green" },
        ],
        position: 1,
      },
    ],
    rows: [
      ...SEED_ROWS.map((r) => ({ ...r, values: { ...r.values } })),
      {
        id: "book-row-1",
        databaseId: DB2_ID,
        title: "The Pragmatic Programmer",
        values: { [PROP_AUTHOR]: "Hunt & Thomas", [PROP_BOOK_STATUS]: "reading-opt-finished" },
        position: 0,
      },
      {
        id: "book-row-2",
        databaseId: DB2_ID,
        title: "Designing Data-Intensive Applications",
        values: { [PROP_AUTHOR]: "Martin Kleppmann", [PROP_BOOK_STATUS]: "reading-opt-reading" },
        position: 1,
      },
    ],
    views: trackerViews,
    viewsByDb: {
      [DB_ID]: trackerViews,
      [DB2_ID]: readingViews,
    },
    nextPropId: 100,
    nextRowId: 100,
  };
  calls.length = 0;
  pendingViewsResolvers = [];
}

function ok<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function putViews(payload: unknown): DatabaseViews {
  const p = payload as Partial<{
    activeView: DatabaseViews["activeView"];
    table: Partial<ViewSettings>;
    board: Partial<ViewSettings>;
    list: Partial<ViewSettings>;
  }>;
  return {
    activeView: p.activeView ?? backend.views.activeView,
    table: { ...backend.views.table, ...(p.table ?? {}) },
    board: { ...backend.views.board, ...(p.board ?? {}) },
    list: { ...backend.views.list, ...(p.list ?? {}) },
  };
}

beforeEach(() => {
  resetBackend();
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const recordCall = () => {
      let body: unknown = undefined;
      if (init?.body) {
        try {
          body = JSON.parse(init.body as string);
        } catch {
          body = init.body;
        }
      }
      calls.push({ method, url, body });
    };

    if (url.endsWith("/api/pages") && method === "GET") {
      recordCall();
      return ok({ pages: backend.pages });
    }

    const dbGet = url.match(/\/api\/databases\/([^/]+)$/);
    if (dbGet) {
      recordCall();
      const id = decodeURIComponent(dbGet[1]);
      const database = backend.pages.find((p) => p.id === id);
      if (!database) return new Response("not found", { status: 404 });
      const properties = backend.properties
        .filter((p) => p.databaseId === id)
        .sort((a, b) => a.position - b.position);
      const rows = backend.rows
        .filter((r) => r.databaseId === id)
        .sort((a, b) => a.position - b.position);
      return ok({ database, properties, rows });
    }

    // views endpoints
    const viewsGet = url.match(/\/api\/databases\/([^/]+)\/views$/);
    if (viewsGet && method === "GET") {
      recordCall();
      const id = decodeURIComponent(viewsGet[1]);
      const v = backend.viewsByDb[id] ?? emptyDatabaseViews();
      // The test can register a pending resolver to keep this response in
      // flight (used by the stale-response test in DEF-013).
      const pending = pendingViewsResolvers.find((p) => p.databaseId === id);
      if (pending) {
        return new Promise<Response>((resolve) => {
          pending.resolve = (v2) => resolve(ok(v2));
        });
      }
      return ok(v);
    }
    const viewsPut = url.match(/\/api\/databases\/([^/]+)\/views$/);
    if (viewsPut && method === "PUT") {
      recordCall();
      const id = decodeURIComponent(viewsPut[1]);
      const body = JSON.parse(init!.body as string);
      const next = putViews(body);
      backend.viewsByDb[id] = next;
      if (id === DB_ID) backend.views = next;
      return ok(next);
    }

    // rows / properties / page etc. — only what's needed by these tests
    const rowMatch = url.match(/\/api\/rows\/([^/]+)$/);
    if (rowMatch) {
      recordCall();
      const id = decodeURIComponent(rowMatch[1]);
      if (method === "PATCH") {
        const patch = JSON.parse(init!.body as string) as Partial<Row>;
        const idx = backend.rows.findIndex((r) => r.id === id);
        if (idx === -1) return new Response("not found", { status: 404 });
        const next: Row = {
          ...backend.rows[idx],
          ...patch,
          values: { ...backend.rows[idx].values, ...(patch.values ?? {}) },
        };
        backend.rows[idx] = next;
        return ok(next);
      }
      if (method === "DELETE") {
        backend.rows = backend.rows.filter((r) => r.id !== id);
        return new Response(null, { status: 204 });
      }
    }
    const propMatch = url.match(/\/api\/properties\/([^/]+)$/);
    if (propMatch) {
      recordCall();
      const id = decodeURIComponent(propMatch[1]);
      if (method === "PATCH") {
        const patch = JSON.parse(init!.body as string) as Partial<Property>;
        const idx = backend.properties.findIndex((p) => p.id === id);
        if (idx === -1) return new Response("not found", { status: 404 });
        backend.properties[idx] = { ...backend.properties[idx], ...patch };
        return ok(backend.properties[idx]);
      }
      if (method === "DELETE") {
        backend.properties = backend.properties.filter((p) => p.id !== id);
        for (const r of backend.rows) delete r.values[id];
        return new Response(null, { status: 204 });
      }
    }
    const propsPost = url.match(/\/api\/databases\/([^/]+)\/properties$/);
    if (propsPost && method === "POST") {
      recordCall();
      const draft = JSON.parse(init!.body as string) as {
        name: string;
        type: Property["type"];
      };
      const created: Property = {
        id: `prop-${backend.nextPropId++}`,
        databaseId: DB_ID,
        name: draft.name,
        type: draft.type,
        options: [],
        position: backend.properties.length,
      };
      backend.properties.push(created);
      return ok(created, 201);
    }
    return new Response("not implemented in test stub: " + url, { status: 501 });
  }) as unknown as typeof fetch;
  useDatabase.setState({
    databaseId: null,
    database: null,
    properties: [],
    rows: [],
    status: "idle",
    error: null,
    pending: new Set(),
    lastSavedAt: null,
    views: {
      activeView: "table",
      table: { filters: [], sort: null, groupBy: null, listProps: [] },
      board: { filters: [], sort: null, groupBy: null, listProps: [] },
      list: { filters: [], sort: null, groupBy: null, listProps: [] },
    },
    viewsPending: false,
    viewsError: null,
    viewsLoaded: false,
  });
});

afterEach(() => {
  // Note: do NOT call vi.restoreAllMocks() here — @testing-library/user-event
  // v14 installs some internal mocks whose teardown races with the next
  // test's document preparation, which then fails with
  // "Cannot read properties of undefined (reading 'Symbol(Node prepared
  // with document state workarounds)')". The beforeEach below re-installs
  // the fetch mock cleanly each test.
});

// Helper: open the database by clicking the sidebar tree.
async function openDatabase(
  user: ReturnType<typeof userEvent.setup>,
  name: "Project Tracker" | "Reading List" = "Project Tracker",
) {
  const id = name === "Reading List" ? DB2_ID : DB_ID;
  render(<App />);
  const tree = await screen.findByTestId("sidebar-tree");
  const link = await waitFor(() =>
    within(tree).getByText(name).closest("[data-row-id]")!,
  );
  await user.click(link);
  // Wait for both the database and the views fetch to land.
  await waitFor(() => {
    expect(useDatabase.getState().databaseId).toBe(id);
  });
  await waitFor(() => {
    expect(useDatabase.getState().viewsLoaded).toBe(true);
  });
}

// ---- View switcher ----

describe("View switcher", () => {
  it("renders the segmented control and switches activeView on click", async () => {
    const user = userEvent.setup();
    await openDatabase(user);
    // Default active is 'board' (per backend seed).
    const switcher = await screen.findByRole("tablist", { name: /database view/i });
    const boardTab = within(switcher).getByRole("tab", { name: /board/i });
    const tableTab = within(switcher).getByRole("tab", { name: /table/i });
    const listTab = within(switcher).getByRole("tab", { name: /list/i });
    expect(boardTab).toHaveAttribute("aria-selected", "true");

    await user.click(tableTab);
    await waitFor(() => {
      const put = lastViewsPut();
      expect(put?.body).toMatchObject({ activeView: "table" });
    });
    expect(within(switcher).getByRole("tab", { name: /table/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(listTab);
    await waitFor(() => {
      const put = lastViewsPut();
      expect(put?.body).toMatchObject({ activeView: "list" });
    });
  });
});

// ---- Board view ----

describe("Board view", () => {
  it("renders one column per option, no 'No value' when all rows are set", async () => {
    const user = userEvent.setup();
    await openDatabase(user);
    // The seeded active view is 'board', grouped by Status.
    await waitFor(() => {
      expect(screen.getByTestId("board-view")).toBeInTheDocument();
    });
    const board = document.querySelector(".board-view")!;
    const headers = Array.from(board.querySelectorAll(".board-column")).map(
      (el) => el.querySelector(".board-column-chip")?.textContent?.trim(),
    );
    // Status options order: To do, In progress, Done. All rows have a
    // status so no "No value" column appears.
    expect(headers).toEqual(["To do", "In progress", "Done"]);
    expect(board.querySelectorAll(".board-column").length).toBe(3);
  });

  it("renders a 'No value' column when at least one row lacks a value", async () => {
    // Drop row-3's status to trigger the No value column.
    backend.rows.find((r) => r.id === "row-3")!.values[PROP_STATUS] = null;
    const user = userEvent.setup();
    await openDatabase(user);
    await waitFor(() => {
      expect(screen.getByTestId("board-view")).toBeInTheDocument();
    });
    const headers = Array.from(
      document.querySelectorAll(".board-column-chip"),
    ).map((e) => e.textContent?.trim());
    expect(headers).toEqual(["To do", "In progress", "Done", "No value"]);
  });

  it("moves a card between columns and PUTs the new value", async () => {
    const user = userEvent.setup();
    await openDatabase(user);
    await waitFor(() => {
      expect(document.querySelector(".board-column")).toBeTruthy();
    });
    const board = document.querySelector(".board-view")!;
    // Find the "Wire up views endpoint" card and dispatch a drag end onto
    // the "Done" column. We avoid full dnd-kit pointer math in tests and
    // call the store's updateRowValue directly via simulating drag end by
    // mutating store. To actually exercise the drag path we use
    // PointerSensor's onDragEnd by faking the DOM events.
    //
    // For this test we simulate the drag by directly calling the store's
    // moveCardToOption-equivalent: updateRowValue. This verifies the
    // PATCH payload shape, which is the contract we care about.
    await act(async () => {
      await useDatabase
        .getState()
        .updateRowValue("row-1", PROP_STATUS, "s-done");
    });
    // The PATCH should have hit /api/rows/row-1 with values[status]=s-done.
    const patch = calls
      .filter((c) => c.method === "PATCH" && /\/api\/rows\/row-1$/.test(c.url))
      .pop();
    expect(patch?.body).toEqual({ values: { [PROP_STATUS]: "s-done" } });
    // And the store reflects the move.
    const row = useDatabase.getState().rows.find((r) => r.id === "row-1");
    expect(row?.values[PROP_STATUS]).toBe("s-done");
    // The 'Done' column should now have 2 cards.
    const doneColumn = Array.from(board.querySelectorAll(".board-column")).find(
      (c) =>
        c.querySelector(".board-column-chip")?.textContent?.trim() === "Done",
    );
    expect(doneColumn?.querySelectorAll(".board-card").length).toBe(2);
  });

  it("rolls back the card move when the PATCH fails", async () => {
    const user = userEvent.setup();
    await openDatabase(user);
    await waitFor(() => {
      expect(document.querySelector(".board-column")).toBeTruthy();
    });
    // Capture the original status.
    const before = useDatabase
      .getState()
      .rows.find((r) => r.id === "row-1")!.values[PROP_STATUS];
    // Replace the row PATCH handler to fail this once.
    const original = global.fetch;
    let patched = false;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : (input as Request).url;
      const method = (init?.method ?? "GET").toUpperCase();
      if (
        method === "PATCH" &&
        typeof url === "string" &&
        url.includes("/api/rows/row-1")
      ) {
        if (!patched) {
          patched = true;
          return new Response("server down", { status: 500 });
        }
      }
      return original(input as RequestInfo, init);
    }) as unknown as typeof fetch;

    // Trigger the move.
    await act(async () => {
      try {
        await useDatabase.getState().updateRowValue("row-1", PROP_STATUS, "s-done");
      } catch {
        // expected: the store rejects the promise.
      }
    });
    // The store value should be rolled back to the original.
    const after = useDatabase.getState().rows.find((r) => r.id === "row-1")!.values[PROP_STATUS];
    expect(after).toBe(before);
  });
});

// ---- Filter bar ----

describe("Filter bar", () => {
  it("adds a Status-is filter and narrows the visible rows", async () => {
    const user = userEvent.setup();
    await openDatabase(user);
    // Switch to table to see row count clearly.
    const switcher = await screen.findByRole("tablist", { name: /database view/i });
    await user.click(within(switcher).getByRole("tab", { name: /table/i }));
    await waitFor(() => {
      expect(useDatabase.getState().views.activeView).toBe("table");
    });
    // The summary starts at 3 rows.
    const summary = document.querySelector(".db-summary");
    expect(summary?.textContent).toMatch(/3 rows/);

    // Open the composer and pick Status.
    await user.click(screen.getByTestId("filter-add"));
    // Property picker: select the property, then wait for the op picker
    // to appear before interacting with it.
    const propertySelect = (await waitFor(
      () => document.querySelector(".filter-composer-select") as HTMLSelectElement | null,
    ))!;
    await user.selectOptions(propertySelect, PROP_STATUS);
    // Wait for the op step to render.
    await waitFor(() => {
      const sel = document.querySelector(
        ".filter-composer-select",
      ) as HTMLSelectElement | null;
      expect(sel).toBeTruthy();
      // The op select should have "Choose..." placeholder, not the
      // property list.
      expect(sel?.options[0]?.text).toMatch(/Choose/i);
    });
    const opSelect = document.querySelector(
      ".filter-composer-select",
    ) as HTMLSelectElement;
    await user.selectOptions(opSelect, "is");
    // Wait for the value step to render.
    await waitFor(() => {
      const sel = document.querySelector(
        ".filter-composer-select",
      ) as HTMLSelectElement | null;
      expect(sel).toBeTruthy();
    });
    const valueSelect = document.querySelector(
      ".filter-composer-select",
    ) as HTMLSelectElement;
    await user.selectOptions(valueSelect, "s-done");

    await waitFor(() => {
      const last = lastViewsPut();
      const body = last?.body as
        | { table: { filters: Array<Record<string, unknown>> } }
        | undefined;
      // The filter object always has { id, propertyId, op, value }.
      const f = body?.table.filters[0];
      expect(f).toBeDefined();
      expect(f?.propertyId).toBe(PROP_STATUS);
      expect(f?.op).toBe("is");
      expect(f?.value).toBe("s-done");
    });
    // The store reflects the filter.
    await waitFor(() => {
      expect(useDatabase.getState().views.table.filters.length).toBe(1);
    });
    expect(summary?.textContent).toMatch(/1 row/);
  });
});

// ---- Sort control ----

describe("Sort control", () => {
  it("PUTs the sort to the active view's settings", async () => {
    const user = userEvent.setup();
    await openDatabase(user);
    await user.click(screen.getByRole("tab", { name: /table/i }));
    await waitFor(() => {
      expect(useDatabase.getState().views.activeView).toBe("table");
    });
    await user.click(screen.getByTestId("sort-trigger"));
    const sortSelect = document.querySelector(
      ".sort-panel-select",
    ) as HTMLSelectElement;
    await user.selectOptions(sortSelect, PROP_DUE);
    await user.click(screen.getByText(/^Descending$/));
    await user.click(screen.getByRole("button", { name: /^Apply$/i }));
    await waitFor(() => {
      const last = lastViewsPut();
      expect(last?.body).toMatchObject({
        table: { sort: { propertyId: PROP_DUE, direction: "desc" } },
      });
    });
  });
});

// ---- List view ----

describe("List view", () => {
  it("renders the title and properties for every row", async () => {
    const user = userEvent.setup();
    await openDatabase(user);
    await user.click(screen.getByRole("tab", { name: /list/i }));
    await waitFor(() => {
      expect(document.querySelector(".list-view")).toBeTruthy();
    });
    const list = document.querySelector(".list-view")!;
    const titles = Array.from(list.querySelectorAll(".list-row-title-text")).map(
      (e) => e.textContent,
    );
    expect(titles).toEqual([
      "Wire up views endpoint",
      "Polish dark mode",
      "Drop the spec doc",
    ]);
    // Each row has a property section.
    const rows = list.querySelectorAll(".list-row");
    expect(rows.length).toBe(3);
    rows.forEach((r) => {
      expect(r.querySelector(".list-row-props")).toBeTruthy();
    });
  });

  it("persists listProps via PUT /views", async () => {
    const user = userEvent.setup();
    await openDatabase(user);
    await user.click(screen.getByRole("tab", { name: /list/i }));
    await waitFor(() => {
      expect(document.querySelector(".list-view")).toBeTruthy();
    });
    await user.click(screen.getByTestId("props-picker-trigger"));
    // Wait for the popover panel to render with rows.
    await waitFor(() => {
      const rows = document.querySelectorAll(".props-picker-row");
      expect(rows.length).toBeGreaterThan(0);
    });
    // Toggle the first property checkbox.
    const rows = document.querySelectorAll(".props-picker-row");
    const checkbox = rows[0].querySelector(
      "input[type=checkbox]",
    ) as HTMLInputElement;
    await user.click(checkbox);
    // Done.
    await user.click(screen.getByRole("button", { name: /^Done$/i }));
    await waitFor(() => {
      const last = lastViewsPut();
      const body = last?.body as { list?: { listProps?: string[] } } | undefined;
      expect(body?.list).toBeDefined();
      expect(body?.list?.listProps).toBeDefined();
      expect(Array.isArray(body?.list?.listProps)).toBe(true);
    });
  });
});

// ---- GroupBy ----

describe("Board groupBy", () => {
  it("saves groupBy via PUT /views", async () => {
    const user = userEvent.setup();
    await openDatabase(user);
    // Switch to board (default already).
    await waitFor(() => {
      expect(document.querySelector(".board-view")).toBeTruthy();
    });
    await user.click(screen.getByTestId("group-by-trigger"));
    const ownerBtn = screen.getByRole("button", { name: "Owner" });
    await user.click(ownerBtn);
    await waitFor(() => {
      const last = lastViewsPut();
      expect(last?.body).toMatchObject({ board: { groupBy: PROP_OWNER } });
    });
  });
});

// ---- helpers ----

function lastViewsPut(): { method: string; url: string; body?: unknown } | undefined {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].method === "PUT" && calls[i].url.endsWith("/views")) {
      return calls[i];
    }
  }
  return undefined;
}

// Use a vitest "fireEvent" import so we can rely on it in act() blocks
// elsewhere if needed.
void fireEvent;
// Re-export types for downstream tests if needed.
export type { Filter, Sort };

// =====================================================================
// DEF-013: per-database views state and stale-response guard
// =====================================================================

describe("DEF-013: views state is scoped per database", () => {
  it("clears the previous database's filter bar when switching to another database", async () => {
    const user = userEvent.setup();
    // Open Reading List first (which has a seeded filter on Status).
    await openDatabase(user, "Reading List");
    // Sanity: the seeded filter is present and references Reading List's
    // Status property.
    const seededFilters = useDatabase.getState().views.table.filters;
    expect(seededFilters.length).toBe(1);
    expect(seededFilters[0].propertyId).toBe(PROP_BOOK_STATUS);

    // Switch to Project Tracker (no full reload).
    const tree = screen.getByTestId("sidebar-tree");
    const link = within(tree as HTMLElement).getByText("Project Tracker").closest("[data-row-id]")!;
    await user.click(link);
    // Wait for the database to actually swap.
    await waitFor(() => {
      expect(useDatabase.getState().databaseId).toBe(DB_ID);
    });
    await waitFor(() => {
      expect(useDatabase.getState().viewsLoaded).toBe(true);
    });

    // The new database's filter bar must not show Reading List's chip.
    // Project Tracker's seeded board/table settings have NO filters, so
    // the bar should be empty (no chips).
    const chips = Array.from(
      document.querySelectorAll(".filter-bar .filter-chip"),
    );
    expect(chips).toHaveLength(0);
    // And the store reflects the new database's empty filter list.
    expect(useDatabase.getState().views.table.filters).toEqual([]);
  });

  it("loads the target database's own filter when navigating between two databases that both have filters", async () => {
    const user = userEvent.setup();
    // Project Tracker starts with no filters. Add one on Status, then
    // switch to Reading List and back. Each direction should see its own
    // chips, never the other database's.
    await openDatabase(user, "Project Tracker");
    await user.click(screen.getByRole("tab", { name: /table/i }));
    await waitFor(() => {
      expect(useDatabase.getState().views.activeView).toBe("table");
    });
    // Add a filter on Status="To do".
    await user.click(screen.getByTestId("filter-add"));
    const propertySelect = (await waitFor(
      () => document.querySelector(".filter-composer-select") as HTMLSelectElement | null,
    ))!;
    await user.selectOptions(propertySelect, PROP_STATUS);
    await waitFor(() => {
      const sel = document.querySelector(
        ".filter-composer-select",
      ) as HTMLSelectElement | null;
      expect(sel?.options[0]?.text).toMatch(/Choose/i);
    });
    await user.selectOptions(
      document.querySelector(".filter-composer-select") as HTMLSelectElement,
      "is",
    );
    await waitFor(() => {
      expect(
        document.querySelector(".filter-composer-select"),
      ).toBeTruthy();
    });
    await user.selectOptions(
      document.querySelector(".filter-composer-select") as HTMLSelectElement,
      "s-todo",
    );
    await waitFor(() => {
      expect(useDatabase.getState().views.table.filters.length).toBe(1);
    });
    expect(
      useDatabase.getState().views.table.filters[0].propertyId,
    ).toBe(PROP_STATUS);

    // Switch to Reading List.
    const tree = screen.getByTestId("sidebar-tree");
    await user.click(
      within(tree as HTMLElement)
        .getByText("Reading List")
        .closest("[data-row-id]")!,
    );
    await waitFor(() => {
      expect(useDatabase.getState().databaseId).toBe(DB2_ID);
    });
    // Reading List's table filter is on PROP_BOOK_STATUS, not PROP_STATUS.
    const readingFilters = useDatabase.getState().views.table.filters;
    expect(readingFilters.length).toBe(1);
    expect(readingFilters[0].propertyId).toBe(PROP_BOOK_STATUS);
    // Switch back to Project Tracker.
    await user.click(
      within(tree as HTMLElement)
        .getByText("Project Tracker")
        .closest("[data-row-id]")!,
    );
    await waitFor(() => {
      expect(useDatabase.getState().databaseId).toBe(DB_ID);
    });
    await waitFor(() => {
      expect(useDatabase.getState().viewsLoaded).toBe(true);
    });
    // Tracker chip is back, Reading List chip is gone.
    const trackerFilters = useDatabase.getState().views.table.filters;
    expect(trackerFilters.length).toBe(1);
    expect(trackerFilters[0].propertyId).toBe(PROP_STATUS);
  });

  it("ignores a stale views GET response that arrives after switching databases", async () => {
    // Set up: register a pending resolver for the Project Tracker views
    // GET so its response can be held back while we navigate to
    // Reading List. Then release the stale response — it must not be
    // applied to Reading List's state.
    pendingViewsResolvers.push({
      databaseId: DB_ID,
      resolve: () => {},
    });
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    // Open Project Tracker first. The views GET will hit the pending
    // resolver and stay in flight.
    const trackerLink = within(tree as HTMLElement)
      .getByText("Project Tracker")
      .closest("[data-row-id]")!;
    await user.click(trackerLink);
    // Wait for the database load to start.
    await waitFor(() => {
      expect(useDatabase.getState().databaseId).toBe(DB_ID);
    });
    // viewsLoaded should remain false while the views response is held
    // back.
    expect(useDatabase.getState().viewsLoaded).toBe(false);

    // Now switch to Reading List while Tracker's views response is still
    // pending. Reading List's views load normally.
    await user.click(
      within(tree as HTMLElement)
        .getByText("Reading List")
        .closest("[data-row-id]")!,
    );
    await waitFor(() => {
      expect(useDatabase.getState().databaseId).toBe(DB2_ID);
    });
    await waitFor(() => {
      expect(useDatabase.getState().viewsLoaded).toBe(true);
    });
    // Reading List's settings have the seeded table filter.
    expect(useDatabase.getState().views.table.filters.length).toBe(1);

    // Snapshot Reading List's views state so we can detect overwrite.
    const before = JSON.parse(JSON.stringify(useDatabase.getState().views));

    // Now release the stale Tracker views response. Tracker's seeded
    // views (activeView=board, table.filters=[]) MUST NOT replace
    // Reading List's state.
    const pending = pendingViewsResolvers.find((p) => p.databaseId === DB_ID)!;
    pending.resolve({
      activeView: "board",
      table: { filters: [], sort: null, groupBy: null, listProps: [] },
      board: { filters: [], sort: null, groupBy: PROP_STATUS, listProps: [] },
      list: { filters: [], sort: null, groupBy: null, listProps: [] },
    });
    // Give the microtask queue a tick to apply.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const after = useDatabase.getState().views;
    expect(after).toEqual(before);
    // And Reading List's filter is unchanged.
    expect(after.table.filters.length).toBe(1);
    expect(after.table.filters[0].propertyId).toBe(PROP_BOOK_STATUS);
  });

  it("drops a filter chip whose property does not exist on the current database", async () => {
    // Hand-craft a views state with a filter referencing a property
    // that does not exist on the current database, then mount the
    // FilterBar and assert the chip is never rendered (no raw UUID).
    const orphan: Filter = {
      id: "orphan-1",
      propertyId: "does-not-exist-uuid",
      op: "contains",
      value: "whatever",
    };
    const { render: r, screen: s, waitFor: w } = await import(
      "@testing-library/react"
    );
    const { FilterBar } = await import("./components/FilterBar");
    const onChange = vi.fn();
    const realProps: Property[] = [
      {
        id: "real-prop",
        databaseId: "db",
        name: "Real",
        type: "text",
        options: [],
        position: 0,
      },
    ];
    r(
      <FilterBar
        properties={realProps}
        settings={{
          filters: [orphan],
          sort: null,
          groupBy: null,
          listProps: [],
        }}
        onChange={onChange}
      />,
    );
    // No chip with a UUID should ever render.
    const chips = s.queryAllByTestId(/^filter-chip-/);
    expect(chips).toHaveLength(0);
    // The orphan filter should be reported back as removed.
    await w(() => {
      expect(onChange).toHaveBeenCalled();
      const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Filter[];
      expect(last).toEqual([]);
    });
  });
});

// =====================================================================
// DEF-014: "No value" board column for null-valued rows
// =====================================================================

describe("DEF-014: 'No value' column on the board", () => {
  it("renders a labeled 'No value' column with its header and a card when a row's group-by value is null", async () => {
    // Force row-1 to have a null status (simulates a server-side scrub
    // of a deleted select option).
    backend.rows.find((r) => r.id === "row-1")!.values[PROP_STATUS] = null;
    const user = userEvent.setup();
    await openDatabase(user);
    await waitFor(() => {
      expect(screen.getByTestId("board-view")).toBeInTheDocument();
    });
    // The seeded active view is 'board' and groupBy is PROP_STATUS. The
    // board should render one column per Status option plus a labeled
    // "No value" column for the null-valued row.
    const board = document.querySelector(".board-view")!;
    const columns = Array.from(board.querySelectorAll(".board-column"));
    const noneColumn = columns.find(
      (c) => c.getAttribute("data-column-key") === "__none__",
    );
    expect(noneColumn).toBeTruthy();
    // The header chip in that column reads "No value".
    const headerChip = noneColumn!.querySelector(".board-column-chip");
    expect(headerChip?.textContent?.trim()).toBe("No value");
    // And the column actually holds the affected card.
    const card = noneColumn!.querySelector(".board-card");
    expect(card).toBeTruthy();
    expect(card?.textContent).toMatch(/Wire up views endpoint/);
  });

  it("keeps the 'No value' column hidden when every row has a value for the group-by property", async () => {
    // Sanity: with the original fixture, no row has a null status, so
    // the "No value" column must NOT appear.
    const user = userEvent.setup();
    await openDatabase(user);
    await waitFor(() => {
      expect(screen.getByTestId("board-view")).toBeInTheDocument();
    });
    const noneColumn = document.querySelector(
      '.board-column[data-column-key="__none__"]',
    );
    expect(noneColumn).toBeNull();
  });
});
