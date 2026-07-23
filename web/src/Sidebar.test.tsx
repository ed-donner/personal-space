import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import type { Page, PageDraft, PagePatch } from "./types";
import type { Block, BlockReplace } from "./blockTypes";

interface BackendState {
  pages: Page[];
  blocks: Record<string, Block[]>;
  nextId: number;
}

let backend: BackendState;
let lastDeleted: string | null = null;
let lastPatched: { id: string; patch: PagePatch } | null = null;

const SEED: Page[] = [
  { id: "p1", parentId: null, title: "Projects", icon: "📁", type: "page", position: 0 },
  {
    id: "p1-1",
    parentId: "p1",
    title: "Personal Space",
    icon: "✨",
    type: "page",
    position: 0,
  },
  {
    id: "p1-2",
    parentId: "p1",
    title: "Garden",
    icon: "🌱",
    type: "page",
    position: 1,
  },
  {
    id: "p1-1-1",
    parentId: "p1-1",
    title: "Notes",
    icon: "🗒️",
    type: "page",
    position: 0,
  },
  { id: "p2", parentId: null, title: "Reading", icon: "📚", type: "page", position: 1 },
];

function resetBackend() {
  backend = {
    pages: SEED.map((p) => ({ ...p })),
    blocks: {},
    nextId: 100,
  };
  lastDeleted = null;
  lastPatched = null;
}

function ok<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetBackend();
  // Provide a global fetch stub matching the API contract.
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
        icon: draft.icon ?? "📄",
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
        lastPatched = { id, patch };
        const idx = backend.pages.findIndex((p) => p.id === id);
        if (idx === -1) return new Response("not found", { status: 404 });
        backend.pages[idx] = { ...backend.pages[idx], ...patch } as Page;
        return ok(backend.pages[idx]);
      }
      if (method === "DELETE") {
        // Cascade: drop the page and anything that descends from it.
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
        lastDeleted = id;
        backend.pages = backend.pages.filter((p) => !ids.has(p.id));
        // Also drop blocks for removed pages.
        for (const removed of ids) {
          delete backend.blocks[removed];
        }
        return new Response(null, { status: 204 });
      }
    }
    // Blocks endpoints.
    const blocksList = url.match(/\/api\/pages\/([^/]+)\/blocks$/);
    if (blocksList) {
      const pageId = decodeURIComponent(blocksList[1]);
      if (method === "GET") {
        const blocks = backend.blocks[pageId] ?? [];
        return ok({ blocks });
      }
      if (method === "POST") {
        const draft = JSON.parse(init!.body as string) as Partial<Block>;
        const id = `b-${backend.nextId++}`;
        const list = backend.blocks[pageId] ?? [];
        const created: Block = {
          id,
          pageId,
          type: draft.type ?? "paragraph",
          content: draft.content ?? "",
          checked: draft.checked ?? false,
          position: draft.position ?? list.length,
        };
        list.push(created);
        backend.blocks[pageId] = list;
        return ok(created, 201);
      }
      if (method === "PUT") {
        const body = JSON.parse(init!.body as string) as { blocks: BlockReplace[] };
        const list = body.blocks.map((b, i) => ({
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
    const blockMatch = url.match(/\/api\/blocks\/([^/]+)$/);
    if (blockMatch) {
      const id = decodeURIComponent(blockMatch[1]);
      if (method === "PATCH") {
        // Find and update; not exercised by Sidebar tests but kept for completeness.
        for (const [, list] of Object.entries(backend.blocks)) {
          const idx = list.findIndex((b) => b.id === id);
          if (idx >= 0) {
            const patch = JSON.parse(init!.body as string) as Partial<Block>;
            list[idx] = { ...list[idx], ...patch } as Block;
            return ok(list[idx]);
          }
        }
        return new Response("not found", { status: 404 });
      }
      if (method === "DELETE") {
        for (const [pageId, list] of Object.entries(backend.blocks)) {
          backend.blocks[pageId] = list.filter((b) => b.id !== id);
        }
        return new Response(null, { status: 204 });
      }
    }
    return new Response("not implemented in test stub: " + url, { status: 501 });
  }) as unknown as typeof fetch;
});

describe("Sidebar", () => {
  it("renders the tree from the API", async () => {
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    await waitFor(() => {
      expect(within(tree).getByText("Projects")).toBeInTheDocument();
    });
    // Children of Projects are visible because the first root is auto-selected
    // and we open parents on selection only for the selected page; the test
    // does not assume expanded state, only that titles are queryable.
    expect(within(tree).getByText("Reading")).toBeInTheDocument();
  });

  it("auto-selects the first root page and shows it in the page view", async () => {
    render(<App />);
    const view = await screen.findByRole("heading", { level: 1, name: "Projects" });
    expect(view).toBeInTheDocument();
  });

  it("expands and collapses a parent on disclosure click", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    await waitFor(() => within(tree).getByText("Projects"));

    // Personal Space is a child of Projects; should not be visible initially
    // (parents are not auto-expanded unless we chose to).
    const personalBefore = within(tree).queryByText("Personal Space");
    expect(personalBefore).not.toBeInTheDocument();

    // Click the disclosure on the Projects row.
    const projectsRow = within(tree).getByText("Projects").closest("[data-row-id]")!;
    const disclosure = within(projectsRow as HTMLElement).getByRole("button", {
      name: /expand/i,
    });
    await user.click(disclosure);

    expect(within(tree).getByText("Personal Space")).toBeInTheDocument();

    // Click again to collapse.
    const disclosureNow = within(projectsRow as HTMLElement).getByRole("button", {
      name: /collapse/i,
    });
    await user.click(disclosureNow);
    await waitFor(() => {
      expect(within(tree).queryByText("Personal Space")).not.toBeInTheDocument();
    });
  });

  it("renames a page on commit (double-click + Enter) and PATCHes the API", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    const projectsRow = await waitFor(() =>
      within(tree).getByText("Projects").closest("[data-row-id]")!,
    );
    const title = within(projectsRow as HTMLElement).getByText("Projects");

    await user.dblClick(title);
    const input = within(projectsRow as HTMLElement).getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Works{Enter}");

    await waitFor(() => {
      expect(within(projectsRow as HTMLElement).getByText("Works")).toBeInTheDocument();
    });
    expect(lastPatched).toEqual({ id: "p1", patch: { title: "Works" } });
  });

  it("cancels rename on Escape without PATCHing", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    const projectsRow = await waitFor(() =>
      within(tree).getByText("Projects").closest("[data-row-id]")!,
    );
    const title = within(projectsRow as HTMLElement).getByText("Projects");
    await user.dblClick(title);
    const input = within(projectsRow as HTMLElement).getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Should not stick");
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(within(projectsRow as HTMLElement).getByText("Projects")).toBeInTheDocument();
    });
    expect(lastPatched).toBeNull();
  });

  it("shows a confirmation dialog on delete, only DELETEs on confirm", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    // Expand Projects so its child is visible.
    const projectsRow = await waitFor(() =>
      within(tree).getByText("Projects").closest("[data-row-id]")!,
    );
    await user.click(
      within(projectsRow as HTMLElement).getByRole("button", { name: /expand/i }),
    );
    await waitFor(() => within(tree).getByText("Personal Space"));

    const personalRow = within(tree).getByText("Personal Space").closest("[data-row-id]")!;
    const deleteBtn = within(personalRow as HTMLElement).getByRole("button", {
      name: /delete personal space/i,
    });
    await user.click(deleteBtn);

    // Confirmation appears, with the destructive wording.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Delete page/i)).toBeInTheDocument();
    expect(dialog.textContent).toMatch(/Personal Space/);
    expect(dialog.textContent).toMatch(/cannot be undone/i);

    // Cancelling keeps the page and does not call DELETE.
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(lastDeleted).toBeNull();
    expect(within(tree).getByText("Personal Space")).toBeInTheDocument();

    // Re-open and this time confirm.
    await user.click(within(personalRow as HTMLElement).getByRole("button", { name: /delete personal space/i }));
    const dialog2 = await screen.findByRole("alertdialog");
    await user.click(within(dialog2).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(lastDeleted).toBe("p1-1");
    });
    await waitFor(() => {
      expect(within(tree).queryByText("Personal Space")).not.toBeInTheDocument();
    });
  });

  it("cascades delete: removing a parent removes its children", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    const projectsRow = await waitFor(() =>
      within(tree).getByText("Projects").closest("[data-row-id]")!,
    );
    await user.click(
      within(projectsRow as HTMLElement).getByRole("button", { name: /expand/i }),
    );
    await waitFor(() => within(tree).getByText("Personal Space"));

    const deleteBtn = within(projectsRow as HTMLElement).getByRole("button", {
      name: /delete projects/i,
    });
    await user.click(deleteBtn);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(lastDeleted).toBe("p1"));
    // All descendants of p1 are gone from the tree.
    await waitFor(() => {
      expect(within(tree).queryByText("Personal Space")).not.toBeInTheDocument();
      expect(within(tree).queryByText("Garden")).not.toBeInTheDocument();
      expect(within(tree).queryByText("Notes")).not.toBeInTheDocument();
    });
    // Reading (the other root) remains.
    expect(within(tree).getByText("Reading")).toBeInTheDocument();
  });

  it("creates a root page from the sidebar New page button", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("sidebar-tree");
    const before = backend.pages.length;

    await user.click(screen.getAllByRole("button", { name: /new page/i })[0]);
    await waitFor(() => {
      expect(backend.pages.length).toBe(before + 1);
    });
    expect(backend.pages.at(-1)?.title).toBe("Untitled");
    // The new page becomes selected and is shown as the heading.
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Untitled" })).toBeInTheDocument();
    });
  });

  it("creates a child page from a row's per-row + button", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tree = await screen.findByTestId("sidebar-tree");
    const projectsRow = await waitFor(() =>
      within(tree).getByText("Projects").closest("[data-row-id]")!,
    );
    // Expand Projects so we can verify the new child appears.
    await user.click(
      within(projectsRow as HTMLElement).getByRole("button", { name: /expand/i }),
    );
    const before = backend.pages.filter((p) => p.parentId === "p1").length;

    await user.click(
      within(projectsRow as HTMLElement).getByRole("button", {
        name: /add child page to projects/i,
      }),
    );

    await waitFor(() => {
      const after = backend.pages.filter((p) => p.parentId === "p1").length;
      expect(after).toBe(before + 1);
    });
  });

  it("counter excludes rows: shows pages+databases only, never row count (DEF-006)", async () => {
    // Push a row directly into the backend fixture so the API returns it
    // alongside the seeded pages. The sidebar subtitle should keep showing
    // the page+database count (5) and ignore the row.
    backend.pages.push({
      id: "row-x",
      parentId: "p2",
      title: "A row that must not inflate the count",
      icon: "📄",
      type: "row",
      position: 99,
    });
    render(<App />);
    await screen.findByTestId("sidebar-tree");
    // Wait for the load to settle.
    await waitFor(() => {
      expect(screen.getByText("Reading")).toBeInTheDocument();
    });
    const subtitle = document.querySelector(".sidebar-subtitle")!;
    expect(subtitle.textContent).toBe("5 pages");
  });
});
