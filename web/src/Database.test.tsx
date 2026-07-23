// Database feature tests.
//
// We mock the fetch layer to match the contract from the task spec, then
// drive the real App through user interactions. The tests cover:
//
//   - Sidebar: new-database button creates a type 'database' page; rows
//     never appear in the tree
//   - DatabaseView (table):
//       * renders properties and rows from a fixture
//       * cell editors per type commit the right PATCH payload
//         (text, number, select create-option, checkbox, date)
//       * add-row POSTs
//       * delete-row confirms first
//       * property add/rename/delete
//   - RowPageView renders the properties panel + the block editor

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import type {
  Page,
  Property,
  PropertyOption,
  Row,
} from "./types";
import type { Block, BlockReplace } from "./blockTypes";
import { useDatabase } from "./databaseStore";
import { useBlocks } from "./blocksStore";

interface BackendState {
  pages: Page[];
  blocks: Record<string, Block[]>;
  nextId: number;
  properties: Property[];
  rows: Row[];
  nextPropId: number;
  nextRowId: number;
  nextOptionId: number;
}

let backend: BackendState;
const calls: { method: string; url: string; body?: unknown }[] = [];

const SEED: Page[] = [
  { id: "home", parentId: null, title: "Home", icon: "🏠", type: "page", position: 0 },
  { id: "p2", parentId: null, title: "Other", icon: "📄", type: "page", position: 1 },
];

const SEED_DB_ID = "db-reading";
const SEED_PROP_TEXT = "prop-author";
const SEED_PROP_STATUS = "prop-status";
const SEED_PROP_RATING = "prop-rating";
const SEED_PROP_DATE = "prop-date";
const SEED_PROP_DONE = "prop-done";
const SEED_PROP_URL = "prop-url";

function makeProperty(
  id: string,
  name: string,
  type: Property["type"],
  position: number,
  options: PropertyOption[] = [],
): Property {
  return {
    id,
    databaseId: SEED_DB_ID,
    name,
    type,
    options,
    position,
  };
}

const SEED_PROPERTIES: Property[] = [
  makeProperty(SEED_PROP_TEXT, "Author", "text", 0),
  makeProperty(SEED_PROP_STATUS, "Status", "select", 1, [
    { id: "opt-todo", label: "To read", color: "gray" },
    { id: "opt-reading", label: "Reading", color: "amber" },
    { id: "opt-done", label: "Done", color: "green" },
  ]),
  makeProperty(SEED_PROP_RATING, "Tags", "multiSelect", 2, [
    { id: "opt-fiction", label: "Fiction", color: "blue" },
    { id: "opt-nonfic", label: "Non-fiction", color: "purple" },
  ]),
  makeProperty(SEED_PROP_DATE, "Started", "date", 3),
  makeProperty(SEED_PROP_DONE, "Finished?", "checkbox", 4),
  makeProperty(SEED_PROP_URL, "Link", "url", 5),
];

const SEED_ROWS: Row[] = [
  {
    id: "row-1",
    databaseId: SEED_DB_ID,
    title: "Atomic Habits",
    values: {
      [SEED_PROP_TEXT]: "James Clear",
      [SEED_PROP_STATUS]: "opt-reading",
      [SEED_PROP_RATING]: ["opt-nonfic"],
      [SEED_PROP_DATE]: "2025-01-15",
      [SEED_PROP_DONE]: false,
      [SEED_PROP_URL]: "https://example.com/atomic-habits",
    },
    position: 0,
  },
  {
    id: "row-2",
    databaseId: SEED_DB_ID,
    title: "Deep Work",
    values: {
      [SEED_PROP_TEXT]: "Cal Newport",
      [SEED_PROP_STATUS]: "opt-done",
      [SEED_PROP_DATE]: "2024-11-02",
      [SEED_PROP_DONE]: true,
    },
    position: 1,
  },
];

const SEED_DATABASE_PAGE: Page = {
  id: SEED_DB_ID,
  parentId: null,
  title: "Reading List",
  icon: "📚",
  type: "database",
  position: 2,
};

function resetBackend() {
  backend = {
    pages: [
      ...SEED.map((p) => ({ ...p })),
      { ...SEED_DATABASE_PAGE },
    ],
    blocks: {},
    nextId: 100,
    properties: SEED_PROPERTIES.map((p) => ({
      ...p,
      options: p.options.map((o) => ({ ...o })),
    })),
    rows: SEED_ROWS.map((r) => ({ ...r, values: { ...r.values } })),
    nextPropId: 100,
    nextRowId: 100,
    nextOptionId: 100,
  };
  calls.length = 0;
}

function ok<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

    // ----- pages -----
    if (url.endsWith("/api/pages") && method === "GET") {
      recordCall();
      return ok({ pages: backend.pages });
    }
    if (url.endsWith("/api/pages") && method === "POST") {
      recordCall();
      const draft = JSON.parse(init!.body as string) as Partial<Page>;
      const id = `p-${backend.nextId++}`;
      const created: Page = {
        id,
        parentId: draft.parentId ?? null,
        title: draft.title ?? "Untitled",
        icon: draft.icon ?? "📄",
        type: (draft.type as Page["type"]) ?? "page",
        position: backend.pages.length,
      };
      backend.pages.push(created);
      return ok(created, 201);
    }
    const pageMatch = url.match(/\/api\/pages\/([^/]+)$/);
    if (pageMatch) {
      recordCall();
      const id = decodeURIComponent(pageMatch[1]);
      if (method === "PATCH") {
        const patch = JSON.parse(init!.body as string) as Partial<Page>;
        const idx = backend.pages.findIndex((p) => p.id === id);
        if (idx === -1) return new Response("not found", { status: 404 });
        backend.pages[idx] = { ...backend.pages[idx], ...patch } as Page;
        return ok(backend.pages[idx]);
      }
      if (method === "DELETE") {
        // Cascade: drop the page and any descendants (and rows/properties of
        // database pages).
        const ids = new Set<string>([id]);
        let added = true;
        while (added) {
          added = false;
          for (const p of backend.pages) {
            if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) {
              ids.add(p.id);
              added = true;
            }
          }
        }
        backend.pages = backend.pages.filter((p) => !ids.has(p.id));
        // Drop their blocks.
        for (const r of ids) delete backend.blocks[r];
        // Drop database-owned state for database pages.
        for (const r of ids) {
          backend.properties = backend.properties.filter(
            (p) => p.databaseId !== r,
          );
          backend.rows = backend.rows.filter((rw) => rw.databaseId !== r);
        }
        return new Response(null, { status: 204 });
      }
    }

    // ----- blocks -----
    const blocksList = url.match(/\/api\/pages\/([^/]+)\/blocks$/);
    if (blocksList) {
      recordCall();
      const pageId = decodeURIComponent(blocksList[1]);
      if (method === "GET") {
        return ok({ blocks: backend.blocks[pageId] ?? [] });
      }
      if (method === "PUT") {
        const body = JSON.parse(init!.body as string) as { blocks: BlockReplace[] };
        const list: Block[] = body.blocks.map((b, i) => ({
          id: b.id ?? `b-${backend.nextId++}`,
          pageId,
          type: b.type,
          content: b.content,
          checked: b.checked ?? false,
          position: i,
        }));
        backend.blocks[pageId] = list;
        return ok({ blocks: list });
      }
    }

    // ----- databases -----
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
    const dbPropsPost = url.match(/\/api\/databases\/([^/]+)\/properties$/);
    if (dbPropsPost && method === "POST") {
      recordCall();
      const id = decodeURIComponent(dbPropsPost[1]);
      const draft = JSON.parse(init!.body as string) as { name: string; type: Property["type"] };
      const created: Property = {
        id: `prop-${backend.nextPropId++}`,
        databaseId: id,
        name: draft.name,
        type: draft.type,
        options: [],
        position: backend.properties.filter((p) => p.databaseId === id).length,
      };
      backend.properties.push(created);
      return ok(created, 201);
    }
    const dbRowsPost = url.match(/\/api\/databases\/([^/]+)\/rows$/);
    if (dbRowsPost && method === "POST") {
      recordCall();
      const id = decodeURIComponent(dbRowsPost[1]);
      const draft = (init?.body
        ? (JSON.parse(init.body as string) as Partial<Row>)
        : {}) ?? {};
      const created: Row = {
        id: `row-${backend.nextRowId++}`,
        databaseId: id,
        title: draft.title ?? "",
        values: draft.values ?? {},
        position: backend.rows.filter((r) => r.databaseId === id).length,
      };
      backend.rows.push(created);
      return ok(created, 201);
    }
    const propMatch = url.match(/\/api\/properties\/([^/]+)$/);
    if (propMatch) {
      recordCall();
      const id = decodeURIComponent(propMatch[1]);
      if (method === "PATCH") {
        const patch = JSON.parse(init!.body as string) as Partial<Property>;
        const idx = backend.properties.findIndex((p) => p.id === id);
        if (idx === -1) return new Response("not found", { status: 404 });
        const next: Property = {
          ...backend.properties[idx],
          ...patch,
        };
        // Server-side option scrub: any value referencing an option id that
        // is no longer in the property is removed from every row.
        if (patch.options) {
          const allowed = new Set(patch.options.map((o) => o.id));
          for (const r of backend.rows) {
            const v = r.values[id];
            if (typeof v === "string" && !allowed.has(v)) {
              delete r.values[id];
            } else if (Array.isArray(v)) {
              const filtered = v.filter((x) => allowed.has(x));
              if (filtered.length === 0) delete r.values[id];
              else r.values[id] = filtered;
            }
          }
        }
        backend.properties[idx] = next;
        return ok(next);
      }
      if (method === "DELETE") {
        backend.properties = backend.properties.filter((p) => p.id !== id);
        // Drop the value from every row.
        for (const r of backend.rows) {
          delete r.values[id];
        }
        return new Response(null, { status: 204 });
      }
    }
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

    return new Response("not implemented in test stub: " + url, { status: 501 });
  }) as unknown as typeof fetch;
  // Reset the stores.
  useDatabase.setState({
    databaseId: null,
    database: null,
    properties: [],
    rows: [],
    status: "idle",
    error: null,
    pending: new Set(),
    lastSavedAt: null,
  });
  useBlocks.setState({
    pageId: null,
    blocks: [],
    loading: false,
    error: null,
    saveStatus: "idle",
    lastSavedAt: null,
  });
});

// (clickByLabel helper intentionally omitted — kept inline at each call site
// for readability.)

describe("Sidebar with databases", () => {
  it("shows the New database button and creates a database page on click", async () => {
    const user = userEvent.setup();
    const before = backend.pages.length;
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    await waitFor(() => within(tree).getByText("Home"));

    const newDbBtn = screen.getByRole("button", { name: /new database/i });
    await user.click(newDbBtn);

    await waitFor(() => {
      expect(backend.pages.length).toBe(before + 1);
    });
    // The newly created page is the one we just added.
    const newPage = backend.pages[backend.pages.length - 1];
    expect(newPage.type).toBe("database");
    expect(newPage.icon).toBe("🗃️");
  });

  it("never shows rows in the sidebar tree", async () => {
    // Add a row directly to backend state and render.
    backend.pages.push({
      id: "row-x",
      parentId: SEED_DB_ID,
      title: "Should not appear",
      icon: "📄",
      type: "row",
      position: 99,
    });
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    await waitFor(() => within(tree).getByText("Home"));
    // The database is in the tree; the row is not.
    expect(within(tree).getByText("Reading List")).toBeInTheDocument();
    expect(within(tree).queryByText("Should not appear")).not.toBeInTheDocument();
    // sanity: we did not click anything.
    void user;
  });
});

describe("Sidebar database '+' (DEF-010)", () => {
  it("' + ' on a database creates a row via POST /databases/:id/rows, not a child page", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    const dbRow = await waitFor(() =>
      within(tree).getByText("Reading List").closest("[data-row-id]")!,
    );
    const rowsBefore = backend.rows.filter(
      (r) => r.databaseId === SEED_DB_ID,
    ).length;
    const pagesBefore = backend.pages.length;

    // Click the per-row "+" on the database's row.
    await user.click(
      within(dbRow as HTMLElement).getByRole("button", {
        name: /add child page to reading list/i,
      }),
    );

    // A new row was created via the rows endpoint...
    await waitFor(() => {
      const after = backend.rows.filter((r) => r.databaseId === SEED_DB_ID);
      expect(after.length).toBe(rowsBefore + 1);
    });
    // ...and no new page (type 'page') was added as a child of the database.
    expect(backend.pages.length).toBe(pagesBefore);

    // The captured POST must have hit /api/databases/:id/rows with title
    // 'Untitled', NOT /api/pages.
    const rowPost = calls.find(
      (c) =>
        c.method === "POST" &&
        typeof c.url === "string" &&
        /\/api\/databases\/[^/]+\/rows$/.test(c.url),
    );
    expect(rowPost).toBeDefined();
    expect(rowPost!.body).toEqual({ title: "Untitled" });

    const pagePost = calls.find(
      (c) =>
        c.method === "POST" &&
        typeof c.url === "string" &&
        c.url.endsWith("/api/pages"),
    );
    expect(pagePost).toBeUndefined();

    // The newly created row must not appear in the sidebar tree.
    await waitFor(() => {
      expect(
        within(tree).queryByText("Untitled"),
      ).not.toBeInTheDocument();
    });
  });

  it("'+' on a regular page still creates a child page via POST /api/pages", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    const homeRow = await waitFor(() =>
      within(tree).getByText("Home").closest("[data-row-id]")!,
    );
    // Home is a type='page', not a database — the per-row "+" must keep
    // creating a child page on POST /api/pages.
    const before = backend.pages.length;
    await user.click(
      within(homeRow as HTMLElement).getByRole("button", {
        name: /add child page to home/i,
      }),
    );
    await waitFor(() => {
      expect(backend.pages.length).toBe(before + 1);
    });
    const pagePost = calls.find(
      (c) =>
        c.method === "POST" &&
        typeof c.url === "string" &&
        c.url.endsWith("/api/pages"),
    );
    expect(pagePost).toBeDefined();
  });
});

describe("DatabaseView (table)", () => {
  async function openDatabase() {
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    await waitFor(() => within(tree).getByText("Reading List"));
    await user.click(within(tree).getByText("Reading List"));
    // Wait for the table to render.
    await screen.findByRole("heading", { level: 1, name: "Reading List" });
    await waitFor(() => {
      expect(screen.getByRole("table")).toBeInTheDocument();
    });
  }

  it("renders properties and rows from a fixture", async () => {
    await openDatabase();
    // Both row titles visible.
    expect(screen.getByDisplayValue("Atomic Habits")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Deep Work")).toBeInTheDocument();
    // Property headers.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Author")).toBeInTheDocument();
    expect(within(table).getByText("Status")).toBeInTheDocument();
    expect(within(table).getByText("Tags")).toBeInTheDocument();
    expect(within(table).getByText("Started")).toBeInTheDocument();
    expect(within(table).getByText("Finished?")).toBeInTheDocument();
    expect(within(table).getByText("Link")).toBeInTheDocument();
    // Cell values.
    expect(screen.getByDisplayValue("James Clear")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Cal Newport")).toBeInTheDocument();
    // Checkbox is checked for Deep Work.
    const checkboxes = screen.getAllByRole("button", { name: /checked|unchecked/i });
    expect(checkboxes.length).toBeGreaterThan(0);
    const checkedOne = checkboxes.find(
      (b) => b.getAttribute("aria-label") === "Checked",
    );
    expect(checkedOne).toBeDefined();
  });

  it("text cell: editing a text cell PATCHes the row with the new value", async () => {
    const user = userEvent.setup();
    await openDatabase();
    const cell = screen.getByDisplayValue("James Clear");
    await user.clear(cell);
    await user.type(cell, "JC{Enter}");
    await waitFor(() => {
      const row = backend.rows.find((r) => r.id === "row-1");
      expect(row?.values[SEED_PROP_TEXT]).toBe("JC");
    });
    const patchCall = [...calls]
      .reverse()
      .find(
        (c) =>
          c.method === "PATCH" &&
          typeof c.url === "string" &&
          c.url.endsWith("/api/rows/row-1"),
      );
    expect(patchCall).toBeDefined();
    const body = patchCall?.body as { values?: Record<string, unknown> };
    expect(body.values?.[SEED_PROP_TEXT]).toBe("JC");
  });

  it("number cell: editing a number cell PATCHes with a number or null", async () => {
    // Add a number property to the fixture.
    const numProp: Property = {
      id: "prop-pages",
      databaseId: SEED_DB_ID,
      name: "Pages",
      type: "number",
      options: [],
      position: 6,
    };
    backend.properties.push(numProp);
    backend.rows[0].values["prop-pages"] = 320;
    backend.rows[1].values["prop-pages"] = 280;
    const user = userEvent.setup();
    await openDatabase();
    const input = screen.getByDisplayValue("320") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "350{Enter}");
    await waitFor(() => {
      const row = backend.rows.find((r) => r.id === "row-1");
      expect(row?.values["prop-pages"]).toBe(350);
    });

    await user.clear(input);
    await user.tab();
    await waitFor(() => {
      const row = backend.rows.find((r) => r.id === "row-1");
      expect(row?.values["prop-pages"]).toBeNull();
    });
    const patchCall = [...calls]
      .reverse()
      .find(
        (c) =>
          c.method === "PATCH" &&
          typeof c.url === "string" &&
          c.url.endsWith("/api/rows/row-1"),
      );
    const body = patchCall?.body as { values?: Record<string, unknown> };
    expect(body.values).toEqual({ "prop-pages": null });
  });

  it("checkbox cell: clicking toggles the value (boolean)", async () => {
    await openDatabase();
    // Atomic Habits is unchecked; click it.
    const allCheckboxes = screen.getAllByRole("button", {
      name: /checked|unchecked/i,
    });
    // The first unchecked one is the first row.
    const target = allCheckboxes.find(
      (b) => b.getAttribute("aria-label") === "Unchecked",
    ) as HTMLElement;
    expect(target).toBeDefined();
    fireEvent.click(target);
    await waitFor(() => {
      const row = backend.rows.find((r) => r.id === "row-1");
      expect(row?.values[SEED_PROP_DONE]).toBe(true);
    });
    const patchCall = [...calls]
      .reverse()
      .find(
        (c) =>
          c.method === "PATCH" &&
          typeof c.url === "string" &&
          c.url.endsWith("/api/rows/row-1"),
      );
    const body = patchCall?.body as { values?: Record<string, unknown> };
    expect(body.values?.[SEED_PROP_DONE]).toBe(true);
  });

  it("date cell: editing a date cell PATCHes with an ISO date string", async () => {
    const user = userEvent.setup();
    await openDatabase();
    // Find the date input for row-1 (the "Started" column on Atomic Habits).
    const dateInputs = document.querySelectorAll<HTMLInputElement>(
      'input[type="date"]',
    );
    // Initially the inputs are not present because the cells render a
    // button until clicked. Click the date display for row-1.
    const dateDisplays = screen.getAllByText("15 Jan 2025");
    await user.click(dateDisplays[0]);
    const input = document.querySelector<HTMLInputElement>(
      'input[type="date"]',
    );
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: "2025-02-01" } });
    fireEvent.blur(input!);
    await waitFor(() => {
      const row = backend.rows.find((r) => r.id === "row-1");
      expect(row?.values[SEED_PROP_DATE]).toBe("2025-02-01");
    });
    void dateInputs; // silence
  });

  it("select cell: creating a new option via the dropdown patches the property and assigns the option", async () => {
    const user = userEvent.setup();
    await openDatabase();
    // Open the Status dropdown for row-1 by clicking the chip in the cell.
    // The chip is rendered by SelectDropdown; we click the trigger button.
    const triggers = screen.getAllByRole("button", { name: /reading/i });
    // The first one with text "Reading" in the Status column.
    const statusTrigger = triggers.find(
      (b) => b.closest("[class*='db-td']") !== null,
    ) as HTMLElement;
    expect(statusTrigger).toBeDefined();
    await user.click(statusTrigger);
    // The dropdown panel is open; type a new option name.
    const search = await screen.findByPlaceholderText(/find or create/i);
    fireEvent.change(search, { target: { value: "Wishlist" } });
    // Click the "Create" row.
    const createBtn = await screen.findByText(/Create/i);
    await user.click(createBtn);
    await waitFor(() => {
      const prop = backend.properties.find((p) => p.id === SEED_PROP_STATUS);
      expect(prop?.options.some((o) => o.label === "Wishlist")).toBe(true);
    });
    // The newly-created option is assigned to the row.
    await waitFor(() => {
      const row = backend.rows.find((r) => r.id === "row-1");
      const ids = row?.values[SEED_PROP_STATUS];
      // Should now equal the new option's id (we don't know the exact id;
      // just check the option exists with the label "Wishlist").
      const wishlist = backend.properties
        .find((p) => p.id === SEED_PROP_STATUS)
        ?.options.find((o) => o.label === "Wishlist");
      expect(wishlist).toBeDefined();
      expect(ids).toBe(wishlist?.id);
    });
  });

  it("add-row: clicking the New row button POSTs a new row", async () => {
    const user = userEvent.setup();
    await openDatabase();
    const before = backend.rows.filter((r) => r.databaseId === SEED_DB_ID).length;
    const newRowBtn = screen.getByRole("button", { name: /new row/i });
    await user.click(newRowBtn);
    await waitFor(() => {
      const after = backend.rows.filter((r) => r.databaseId === SEED_DB_ID).length;
      expect(after).toBe(before + 1);
    });
  });

  it("delete-row: confirms before deleting", async () => {
    const user = userEvent.setup();
    await openDatabase();
    // Hover the row to reveal the actions; userEvent doesn't trigger CSS
    // :hover, but our delete button is rendered with display:none on no hover
    // and shown on hover. We click the open button instead, then use the
    // danger button via JS — actually the hover reveal uses display: none.
    // We bypass hover by directly clicking the delete button after focusing.
    // To make this testable, the implementation also shows the action group
    // on focus. We assert the dialog appears, then cancel, then re-open and
    // confirm.
    const row = screen.getByDisplayValue("Atomic Habits").closest("tr")!;
    const deleteBtn = within(row as HTMLElement).getByRole("button", {
      name: /delete row/i,
    });
    await user.click(deleteBtn);
    // Confirmation appears.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Delete row/i)).toBeInTheDocument();
    // Cancel.
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(backend.rows.find((r) => r.id === "row-1")).toBeDefined();
    // Re-open and confirm.
    await user.click(
      within(row as HTMLElement).getByRole("button", { name: /delete row/i }),
    );
    const dialog2 = await screen.findByRole("alertdialog");
    await user.click(within(dialog2).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => {
      expect(backend.rows.find((r) => r.id === "row-1")).toBeUndefined();
    });
  });

  it("property add: clicking +, naming, and choosing a type POSTs a property", async () => {
    const user = userEvent.setup();
    await openDatabase();
    const before = backend.properties.filter(
      (p) => p.databaseId === SEED_DB_ID,
    ).length;
    // Open the add-property menu: the header + button.
    const addHeaderBtn = screen.getByRole("button", { name: /new property/i });
    await user.click(addHeaderBtn);
    const nameInput = await screen.findByLabelText(/^name$/i);
    fireEvent.change(nameInput, { target: { value: "Genre" } });
    // Click the "Select" type.
    await user.click(screen.getByRole("button", { name: /^select/i }));
    // Submit by clicking the form's submit button (text "Add property").
    const submitBtn = await screen.findByRole("button", {
      name: /^add property$/i,
    });
    await user.click(submitBtn);
    await waitFor(() => {
      const after = backend.properties.filter(
        (p) => p.databaseId === SEED_DB_ID,
      ).length;
      expect(after).toBe(before + 1);
    });
    const created = backend.properties.find((p) => p.name === "Genre");
    expect(created?.type).toBe("select");
  });

  it("property rename: clicking the column name, typing, and blurring PATCHes", async () => {
    const user = userEvent.setup();
    await openDatabase();
    // Find the "Author" header (it has title="Author (Text)") and click.
    const authorHeader = screen.getByTitle(/^Author/);
    await user.click(authorHeader);
    const renameInput = await screen.findByDisplayValue("Author");
    fireEvent.change(renameInput, { target: { value: "Author name" } });
    fireEvent.blur(renameInput);
    await waitFor(() => {
      const p = backend.properties.find((p) => p.id === SEED_PROP_TEXT);
      expect(p?.name).toBe("Author name");
    });
  });

  it("property delete: confirms before deleting and scrubs the value from rows", async () => {
    const user = userEvent.setup();
    await openDatabase();
    // Open the Author column's popover menu and click Delete.
    const authorHeader = screen.getByRole("button", { name: /author options/i });
    await user.click(authorHeader);
    const deleteItem = await screen.findByText(/delete property/i);
    await user.click(deleteItem);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => {
      expect(
        backend.properties.find((p) => p.id === SEED_PROP_TEXT),
      ).toBeUndefined();
    });
    // The value is gone from row-1.
    await waitFor(() => {
      const row = backend.rows.find((r) => r.id === "row-1");
      expect(row?.values[SEED_PROP_TEXT]).toBeUndefined();
    });
  });
});

describe("RowPageView", () => {
  it("renders the properties panel for a row page and an editor", async () => {
    // Add a row page to the seed and add a few blocks to it.
    backend.pages.push({
      id: "row-1",
      parentId: SEED_DB_ID,
      title: "Atomic Habits",
      icon: "📄",
      type: "row",
      position: 0,
    });
    backend.blocks["row-1"] = [
      {
        id: "b-row-1",
        pageId: "row-1",
        type: "paragraph",
        content: "Notes on this book.",
        checked: false,
        position: 0,
      },
    ];
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    await waitFor(() => within(tree).getByText("Reading List"));
    // Click into Reading List database.
    await user.click(within(tree).getByText("Reading List"));
    // Wait for the table.
    await waitFor(() => screen.getByRole("table"));
    // Click the row title to open the row page.
    const titleInput = screen.getByDisplayValue("Atomic Habits");
    const link = titleInput.closest("a")!;
    fireEvent.click(link);
    // The row page header should appear (h1 "Atomic Habits" again, but now
    // from the row page). The breadcrumb is a button with "Reading List" in
    // it, inside .row-breadcrumb.
    await waitFor(() => {
      expect(
        document.querySelector(".row-breadcrumb"),
      ).toBeInTheDocument();
    });
    // Properties panel: every property name should be visible.
    const panel = document.querySelector(".row-props")!;
    expect(panel).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText("Author")).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText("Status")).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText("Tags")).toBeInTheDocument();
    // The block editor renders BlockNote; we just check the host exists.
    const blockHost = document.querySelector(".bn-host");
    expect(blockHost).toBeInTheDocument();
  });
});
