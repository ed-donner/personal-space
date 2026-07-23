import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import type { Page, PageDraft, PagePatch } from "./types";
import type { Block } from "./blockTypes";

/**
 * QuickFind tests. We stub fetch — the backend (/api/search) is owned by
 * another agent — so the tests run against the contract the frontend
 * expects: `GET /api/search?q=…` returning `{ results: [...] }`.
 */

interface BackendState {
  pages: Page[];
  blocks: Record<string, Block[]>;
  /** Search index keyed by query. */
  searchResults: Map<string, unknown[]>;
  lastDeleted: string | null;
  nextId: number;
}

let backend: BackendState;

const SEED: Page[] = [
  { id: "home", parentId: null, title: "Home", icon: "\u{1F3E0}", type: "page", position: 0 },
  { id: "projects", parentId: null, title: "Projects", icon: "\u{1F680}", type: "page", position: 1 },
  {
    id: "tokyo-trip",
    parentId: "projects",
    title: "Tokyo Trip",
    icon: "\u{1F5FC}",
    type: "page",
    position: 0,
  },
  { id: "notes", parentId: null, title: "Notes", icon: "\u{1F4DD}", type: "page", position: 2 },
  // A nested grandchild to verify expand-on-pick.
  {
    id: "tokyo-itinerary",
    parentId: "tokyo-trip",
    title: "Tokyo Itinerary",
    icon: "\u{1F5FC}",
    type: "page",
    position: 0,
  },
];

function resetBackend() {
  backend = {
    pages: SEED.map((p) => ({ ...p })),
    blocks: {},
    searchResults: new Map(),
    lastDeleted: null,
    nextId: 100,
  };
}

function ok<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function okJson(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetBackend();
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.endsWith("/api/pages") && method === "GET") {
      return ok({ pages: backend.pages });
    }
    if (url.endsWith("/api/pages") && method === "POST") {
      const draft = JSON.parse(init!.body as string) as PageDraft;
      const id = `new-${backend.nextId++}`;
      const position = backend.pages.filter(
        (p) => (p.parentId ?? null) === (draft.parentId ?? null),
      ).length;
      const created: Page = {
        id,
        parentId: draft.parentId ?? null,
        title: draft.title ?? "Untitled",
        icon: draft.icon ?? "\u{1F4C4}",
        type: draft.type ?? "page",
        position,
      };
      backend.pages.push(created);
      return ok(created, 201);
    }
    const match = url.match(/\/api\/pages\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (method === "PATCH") {
        const patch = JSON.parse(init!.body as string) as PagePatch;
        const idx = backend.pages.findIndex((p) => p.id === id);
        if (idx === -1) return new Response("not found", { status: 404 });
        backend.pages[idx] = { ...backend.pages[idx], ...patch } as Page;
        return ok(backend.pages[idx]);
      }
      if (method === "DELETE") {
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
        backend.lastDeleted = id;
        backend.pages = backend.pages.filter((p) => !ids.has(p.id));
        return new Response(null, { status: 204 });
      }
    }
    // Block endpoints - minimal stub.
    const blocksList = url.match(/\/api\/pages\/([^/]+)\/blocks$/);
    if (blocksList) {
      const pageId = decodeURIComponent(blocksList[1]);
      if (method === "GET") {
        const list = backend.blocks[pageId] ?? [];
        return ok({ blocks: list });
      }
    }
    // Search endpoint - the contract: GET /api/search?q=... -> { results: [...] }
    const searchMatch = url.match(/\/api\/search(\?.*)?$/);
    if (searchMatch && method === "GET") {
      const query = new URL(url, "http://localhost").searchParams.get("q") ?? "";
      // Simulate ranking + limit: look up by trimmed lowercase query. If not
      // preloaded in the test, just return an empty list.
      const results = backend.searchResults.get(query.trim().toLowerCase()) ?? [];
      return okJson(JSON.stringify({ results }));
    }
    return new Response("not implemented in test stub: " + url, { status: 501 });
  }) as unknown as typeof fetch;
});

describe("QuickFind", () => {
  // Helper: wait for the initial pages to load. Use the sidebar subtitle,
  // which exactly reports "5 pages" and is unique to the sidebar header.
  async function waitForLoaded() {
    await screen.findByText(/5 pages/);
  }

  it("opens with Ctrl+K and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitForLoaded();

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: /quick find/i });
    expect(dialog).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /quick find/i })).not.toBeInTheDocument();
    });
  });

  it("opens via the visible search button in the sidebar", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitForLoaded();

    const button = screen.getByRole("button", { name: /open quick find/i });
    expect(button).toBeInTheDocument();
    await user.click(button);
    const dialog = await screen.findByRole("dialog", { name: /quick find/i });
    expect(dialog).toBeInTheDocument();
    // The input is autofocused.
    const input = within(dialog).getByPlaceholderText(/Search pages/i);
    expect(input).toHaveFocus();
  });

  it("autofocuses the search input on open", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitForLoaded();

    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    const input = await screen.findByPlaceholderText(/Search pages/i);
    expect(input).toHaveFocus();
  });

  it("shows the empty-state hint before any query", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitForLoaded();

    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    await screen.findByRole("dialog", { name: /quick find/i });
    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
  });

  it("renders results grouped by type with breadcrumb (parentTitle) and icon", async () => {
    const user = userEvent.setup();
    // Page with parent, database with no parent, row with parent.
    backend.searchResults.set("tokyo", [
      {
        id: "tokyo-trip",
        type: "page",
        title: "Tokyo Trip",
        icon: "\u{1F5FC}",
        parentId: "projects",
        parentTitle: "Projects",
      },
      {
        id: "tokyo-trip-db",
        type: "database",
        title: "Tokyo Trip DB",
        icon: "\u{1F4CA}",
        parentId: null,
        parentTitle: null,
      },
      {
        id: "tokyo-row-1",
        type: "row",
        title: "Tokyo Sushi",
        icon: "\u{1F363}",
        parentId: "tokyo-trip-db",
        parentTitle: "Tokyo Trip DB",
      },
    ]);
    render(<App />);
    await waitForLoaded();

    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    const input = await screen.findByPlaceholderText(/Search pages/i);

    await user.type(input, "tokyo");

    // Wait for the debounced fetch to resolve. The title is split across a
    // <mark> for the highlighted substring, so we use the option role
    // (each row has role="option") to assert presence.
    const dialog = await screen.findByRole("dialog", { name: /quick find/i });
    const options = await within(dialog).findAllByRole("option");
    expect(options.length).toBe(3);
    // The breadcrumb shows the parent's title (within the dialog).
    expect(within(dialog).getByText("Projects")).toBeInTheDocument();
    expect(within(dialog).getByText("Tokyo Trip DB")).toBeInTheDocument();
    // Group labels visible.
    expect(within(dialog).getByText(/Databases/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Pages/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Rows/i)).toBeInTheDocument();
  });

  it("highlights the matched substring in each result title", async () => {
    const user = userEvent.setup();
    backend.searchResults.set("tokyo", [
      {
        id: "tokyo-trip",
        type: "page",
        title: "Tokyo Trip",
        icon: "\u{1F5FC}",
        parentId: null,
        parentTitle: null,
      },
    ]);
    render(<App />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    await user.type(
      await screen.findByPlaceholderText(/Search pages/i),
      "tokyo",
    );
    await waitFor(() => {
      // The "<mark>tokyo</mark>" highlight is wired with class="qf-mark".
      const mark = document.querySelector(".qf-mark");
      expect(mark?.textContent?.toLowerCase()).toBe("tokyo");
    });
  });

  it("debounces the fetch (~200ms)", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    // Reinstall fetch to count hits on /api/search.
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/api/search") && method === "GET") {
        const u = new URL(url, "http://localhost");
        const q = u.searchParams.get("q") ?? "";
        calls.push(q);
        return ok({ results: [] });
      }
      return (realFetch as typeof fetch)(input, init);
    }) as unknown as typeof fetch;

    render(<App />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    const input = await screen.findByPlaceholderText(/Search pages/i);

    await user.type(input, "t");
    await user.type(input, "o");
    await user.type(input, "k");
    await user.type(input, "y");
    await user.type(input, "o");

    // Wait long enough for the debounce window.
    await waitFor(() => expect(calls.length).toBeGreaterThan(0), {
      timeout: 1000,
    });
    // Even with 5 keystrokes, the number of fetches should be small (1-2),
    // proving the debounce is doing something.
    expect(calls.length).toBeLessThanOrEqual(2);
    // The last fetched query should reflect the final input.
    expect(calls[calls.length - 1]).toBe("tokyo");
  });

  it("keyboard navigation: ArrowDown wraps from last to first; ArrowUp from first to last", async () => {
    const user = userEvent.setup();
    backend.searchResults.set("row", [
      { id: "a", type: "page", title: "Apple", icon: "\u{1F34E}", parentId: null, parentTitle: null },
      { id: "b", type: "page", title: "Banana", icon: "\u{1F34C}", parentId: null, parentTitle: null },
      { id: "c", type: "page", title: "Cherry", icon: "\u{1F352}", parentId: null, parentTitle: null },
    ]);
    render(<App />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    await user.type(
      await screen.findByPlaceholderText(/Search pages/i),
      "row",
    );

    // Wait for the options to render. The titles are NOT split by the
    // highlight (the query "row" doesn't match any of the titles), so
    // findByText works.
    const dialog = await screen.findByRole("dialog", { name: /quick find/i });
    const appleRow = await within(dialog).findByText("Apple");
    expect(appleRow).toBeInTheDocument();
    // First result is active by default.
    const rows = within(dialog).getAllByRole("option");
    expect(rows.length).toBe(3);
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[1]).toHaveAttribute("aria-selected", "false");

    // ArrowDown moves to next.
    await user.keyboard("{ArrowDown}");
    expect(rows[1]).toHaveAttribute("aria-selected", "true");

    // ArrowDown on the last row wraps to first.
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    expect(rows[0]).toHaveAttribute("aria-selected", "true");

    // ArrowUp on the first row wraps to last.
    await user.keyboard("{ArrowUp}");
    expect(rows[rows.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("Enter selects the active result and navigates to it (closing the modal)", async () => {
    const user = userEvent.setup();
    backend.searchResults.set("tokyo", [
      {
        id: "tokyo-trip",
        type: "page",
        title: "Tokyo Trip",
        icon: "\u{1F5FC}",
        parentId: null,
        parentTitle: null,
      },
    ]);
    render(<App />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    await user.type(
      await screen.findByPlaceholderText(/Search pages/i),
      "tokyo",
    );

    // Wait for the option to render.
    const dialog = await screen.findByRole("dialog", { name: /quick find/i });
    const options = await within(dialog).findAllByRole("option");
    expect(options.length).toBe(1);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /quick find/i }),
      ).not.toBeInTheDocument();
    });
    // Tokyo Trip is now selected: the page heading should be the search hit.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Tokyo Trip" }),
      ).toBeInTheDocument();
    });
  });

  it("mouse click on a result row navigates and closes the modal", async () => {
    const user = userEvent.setup();
    backend.searchResults.set("hi", [
      {
        id: "home",
        type: "page",
        title: "Home",
        icon: "\u{1F3E0}",
        parentId: null,
        parentTitle: null,
      },
    ]);
    render(<App />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    await user.type(
      await screen.findByPlaceholderText(/Search pages/i),
      "hi",
    );
    // Wait for the option to render.
    const opt = await screen.findByRole("option", { name: /Home/i });
    await user.click(opt);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /quick find/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("clicking the backdrop closes the modal", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    const dialog = await screen.findByRole("dialog", { name: /quick find/i });
    const backdrop = dialog.parentElement!;
    // Click directly on the backdrop element.
    await user.click(backdrop);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /quick find/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows the no-results state for a non-matching query", async () => {
    const user = userEvent.setup();
    // /api/search returns an empty list for "zzz".
    render(<App />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    await user.type(
      await screen.findByPlaceholderText(/Search pages/i),
      "zzz",
    );
    await waitFor(() => {
      expect(screen.getByText(/No results for/i)).toBeInTheDocument();
    });
  });

  it("shows an error state when the search endpoint fails", async () => {
    const user = userEvent.setup();
    // Override the fetch stub: every URL goes through a local handler.
    // We don't reference any external fetch to avoid capturing a stale
    // mock from a previous test.
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.endsWith("/api/pages") && method === "GET") {
        return ok({ pages: backend.pages });
      }
      if (url.includes("/api/search")) {
        return new Response("server down", { status: 500 });
      }
      if (/\/api\/pages\/[^/]+\/blocks$/.test(url)) {
        return ok({ blocks: [] });
      }
      return new Response("not implemented: " + url, { status: 501 });
    }) as unknown as typeof fetch;

    render(<App />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    await user.type(
      await screen.findByPlaceholderText(/Search pages/i),
      "x",
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Couldn.t search/i),
      ).toBeInTheDocument();
    });
  });

  it("navigation on a parent-less page does not crash", async () => {
    const user = userEvent.setup();
    backend.searchResults.set("home", [
      {
        id: "home",
        type: "page",
        title: "Home",
        icon: "\u{1F3E0}",
        parentId: null,
        parentTitle: null,
      },
    ]);
    render(<App />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /open quick find/i }));
    await user.type(
      await screen.findByPlaceholderText(/Search pages/i),
      "home",
    );
    const opt = await screen.findByRole("option", { name: /Home/i });
    await user.click(opt);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /quick find/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("Ctrl+K toggles: open then open=close again", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitForLoaded();
    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog", { name: /quick find/i });
    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /quick find/i }),
      ).not.toBeInTheDocument();
    });
  });
});
