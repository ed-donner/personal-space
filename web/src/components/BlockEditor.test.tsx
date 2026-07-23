// Component tests for the BlockEditor.
//
// We render the editor inside the App shell (so the page tree and selection
// are wired up) and drive it through real interactions. The fetch stub is
// lifted from Sidebar.test.tsx-style helpers so all blocks endpoints work.
//
// BlockNote is heavy: instantiating its prosemirror / tiptap stack in jsdom
// is several hundred milliseconds, so each test gets a generous timeout and
// we keep the number of full-mount tests small.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor as rtlWaitFor } from "@testing-library/react";
import { App } from "../App";
import type { Page } from "../types";
import type { Block, BlockReplace } from "../blockTypes";
import { useBlocks } from "../blocksStore";
import {
  apiToPartialBlocks,
  documentToReplaceBlocks,
} from "../blocks";
import { blockTypeToBnType, bnTypeToBlockType } from "../blocks";
import { BLOCK_TYPES } from "../blockTypes";

// Bumped waitFor for BlockNote's slower render.
const waitFor: typeof rtlWaitFor = ((cb, options) =>
  rtlWaitFor(cb, { timeout: 15_000, ...options })) as typeof rtlWaitFor;
const TIMEOUT = 20_000;

interface BackendState {
  pages: Page[];
  blocks: Record<string, Block[]>;
  nextId: number;
}

let backend: BackendState;
let lastBlocksPut: { pageId: string; blocks: BlockReplace[] } | null = null;

const SEED: Page[] = [
  { id: "home", parentId: null, title: "Home", icon: "🏠", type: "page", position: 0 },
  { id: "p2", parentId: null, title: "Other", icon: "📄", type: "page", position: 1 },
];

function resetBackend() {
  backend = {
    pages: SEED.map((p) => ({ ...p })),
    blocks: {},
    nextId: 100,
  };
  lastBlocksPut = null;
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
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.endsWith("/api/pages") && method === "GET") {
      return ok({ pages: backend.pages });
    }
    const blocksList = url.match(/\/api\/pages\/([^/]+)\/blocks$/);
    if (blocksList) {
      const pageId = decodeURIComponent(blocksList[1]);
      if (method === "GET") {
        return ok({ blocks: backend.blocks[pageId] ?? [] });
      }
      if (method === "PUT") {
        const body = JSON.parse(init!.body as string) as { blocks: BlockReplace[] };
        lastBlocksPut = { pageId, blocks: body.blocks };
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
    return new Response("not implemented in test stub: " + url, { status: 501 });
  }) as unknown as typeof fetch;
  // Reset the blocks store too.
  useBlocks.setState({
    pageId: null,
    blocks: [],
    loading: false,
    error: null,
    saveStatus: "idle",
    lastSavedAt: null,
  });
});

describe("BlockEditor", () => {
  it(
    "loads blocks for the selected page and renders the editor",
    async () => {
      backend.blocks.home = [
        { id: "b1", pageId: "home", type: "heading1", content: "Welcome", checked: false, position: 0 },
        { id: "b2", pageId: "home", type: "paragraph", content: "hello world", checked: false, position: 1 },
        { id: "b3", pageId: "home", type: "todo", content: "buy milk", checked: true, position: 2 },
        { id: "b4", pageId: "home", type: "callout", content: "heads up", checked: false, position: 3 },
        { id: "b5", pageId: "home", type: "code", content: "x = 1", checked: false, position: 4 },
      ];
      render(<App />);
      await screen.findByRole("heading", { level: 1, name: "Home" });
      await waitFor(() => {
        expect(document.querySelector(".bn-editor")).toBeInTheDocument();
      });
      // BlockNote renders every block's text inside .bn-editor.
      await waitFor(() => {
        const editor = document.querySelector(".bn-editor") as HTMLElement | null;
        expect(editor).toBeTruthy();
        const text = editor!.textContent ?? "";
        expect(text).toContain("Welcome");
        expect(text).toContain("hello world");
        expect(text).toContain("buy milk");
        expect(text).toContain("heads up");
        expect(text).toContain("x = 1");
      });
    },
    TIMEOUT,
  );

  it(
    "debounces saves via PUT after the debounce window",
    async () => {
      // Drive an autosave by calling the store directly. The BlockNote
      // typing path runs through contenteditable events that are awkward to
      // fake under jsdom; the store contract is what we want to verify.
      // We use real timers here — the debounce is short (600ms) and we just
      // wait for it. `vi.useFakeTimers` would also freeze BlockNote's own
      // internal timers and prevent the editor from finishing its mount.
      render(<App />);
      await screen.findByRole("heading", { level: 1, name: "Home" });
      await waitFor(() => {
        expect(document.querySelector(".bn-editor")).toBeInTheDocument();
      });
      useBlocks.getState().scheduleSave("home", [
        { type: "heading1", content: "Hello" },
        { type: "paragraph", content: "world" },
      ]);
      // Wait past the debounce window for the PUT to fire.
      await waitFor(() => {
        expect(lastBlocksPut).not.toBeNull();
      }, { timeout: 5_000 });
      const put = lastBlocksPut!;
      expect(put.pageId).toBe("home");
      expect(put.blocks[0]).toMatchObject({ type: "heading1", content: "Hello" });
      expect(put.blocks[1]).toMatchObject({ type: "paragraph", content: "world" });
    },
    TIMEOUT,
  );

  it(
    "shows the saving indicator while a save is in flight",
    async () => {
      render(<App />);
      await screen.findByRole("heading", { level: 1, name: "Home" });
      await waitFor(() => {
        expect(document.querySelector(".bn-editor")).toBeInTheDocument();
      });
      // No indicator while idle.
      expect(document.querySelector(".save-indicator")).toBeNull();
      // Trigger a save and wait for the indicator to appear after the PUT
      // resolves.
      useBlocks.getState().scheduleSave("home", [
        { type: "paragraph", content: "hi" },
      ]);
      await waitFor(() => {
        const el = document.querySelector(".save-indicator");
        expect(el).not.toBeNull();
      }, { timeout: 5_000 });
    },
    TIMEOUT,
  );

  it(
    "covers the slash menu mapping for every BlockType",
    () => {
      // We can't easily drive the slash-menu UI from jsdom (the menu
      // appears on top of contenteditable and is filtered by prosemirror
      // state), but we can prove the mapping between our keys and the
      // BlockNote types is complete.
      for (const t of BLOCK_TYPES) {
        const bn = blockTypeToBnType(t);
        expect(typeof bn).toBe("string");
        expect(bn.length).toBeGreaterThan(0);
        // Every BlockType should round-trip back.
        const back = bnTypeToBlockType(bn, t === "heading1" ? { level: 1 } : t === "heading2" ? { level: 2 } : t === "heading3" ? { level: 3 } : t === "todo" ? { checked: false } : undefined);
        expect(back).toBe(t);
      }
      // And the mapper handles them as initial content without throwing.
      const partials = apiToPartialBlocks(
        BLOCK_TYPES.map((t, i) => ({
          id: `b-${i}`,
          pageId: "home",
          type: t,
          content: t === "divider" ? "" : `content-${t}`,
          checked: t === "todo",
          position: i,
        })),
      );
      expect(partials).toHaveLength(BLOCK_TYPES.length);
      // Round-trip back out.
      const back = documentToReplaceBlocks(partials);
      expect(back.map((b) => b.type)).toEqual(BLOCK_TYPES);
    },
  );
});