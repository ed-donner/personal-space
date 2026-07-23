// Block store: per-page blocks plus autosave (debounced PUT replace).
//
// The page tree is owned by `store.ts`; this store only knows about the
// blocks of one page at a time (the page currently shown in the editor).
// It loads via GET, autosaves via PUT on a debounce, and exposes a
// `flush()` so we can force a save before navigating away.

import { create } from "zustand";
import { api } from "./api";
import type { Block, BlockReplace } from "./blockTypes";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface State {
  pageId: string | null;
  blocks: Block[];
  loading: boolean;
  error: string | null;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;

  load: (pageId: string) => Promise<void>;
  reset: () => void;
  scheduleSave: (pageId: string, blocks: BlockReplace[]) => void;
  flush: () => Promise<void>;
}

const DEBOUNCE_MS = 600;

interface Pending {
  pageId: string;
  blocks: BlockReplace[];
  timer: ReturnType<typeof setTimeout> | null;
  revision: number;
}

const pending: Pending = {
  pageId: "",
  blocks: [],
  timer: null,
  revision: 0,
};

let revision = 0;
let unloadListenersActive = false;

function onBeforeUnload(): void {
  void useBlocks.getState().flush();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    void useBlocks.getState().flush();
  }
}

function addUnloadListeners(): void {
  if (unloadListenersActive || typeof window === "undefined") return;
  window.addEventListener("beforeunload", onBeforeUnload);
  document.addEventListener("visibilitychange", onVisibilityChange);
  unloadListenersActive = true;
}

function removeUnloadListeners(): void {
  if (!unloadListenersActive || typeof window === "undefined") return;
  window.removeEventListener("beforeunload", onBeforeUnload);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  unloadListenersActive = false;
}

function clearPending(): void {
  if (pending.timer) clearTimeout(pending.timer);
  pending.pageId = "";
  pending.blocks = [];
  pending.timer = null;
  removeUnloadListeners();
}

async function sendPending(keepalive = false): Promise<void> {
  const pageId = pending.pageId;
  if (!pageId) return;

  const blocks = pending.blocks;
  const sentRevision = pending.revision;
  // Snapshot and clear before starting the request. A second flush is now a
  // no-op, while edits made during the request create a distinct newer save.
  clearPending();
  useBlocks.setState(
    keepalive
      ? { saveStatus: "saved", lastSavedAt: Date.now(), error: null }
      : { saveStatus: "saving", error: null },
  );

  try {
    const saved = await api.replaceBlocks(pageId, blocks, { keepalive });
    useBlocks.setState((state) => {
      // A response from an older request must not replace or mark saved a
      // document that has since been edited again.
      if (state.pageId !== pageId || revision !== sentRevision) return {};
      return {
        blocks: saved,
        saveStatus: "saved",
        lastSavedAt: Date.now(),
      };
    });
  } catch (err) {
    if (revision !== sentRevision) return;
    useBlocks.setState({
      saveStatus: "error",
      error: (err as Error).message,
    });
  }
}

function armTimer(): void {
  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    pending.timer = null;
    void sendPending();
  }, DEBOUNCE_MS);
}

export const useBlocks = create<State>((set, get) => ({
  pageId: null,
  blocks: [],
  loading: false,
  error: null,
  saveStatus: "idle",
  lastSavedAt: null,

  async load(pageId) {
    // The editor's unmount cleanup flushes before an SPA page switch. Clear
    // only leftovers here so they cannot be attributed to the new page.
    if (pending.pageId && pending.pageId !== pageId) clearPending();
    set({ pageId, loading: true, error: null, saveStatus: "idle" });
    try {
      const blocks = await api.listBlocks(pageId);
      set({ blocks, loading: false });
    } catch (err) {
      // The page might be new (no blocks yet) and the backend returns 404.
      // Treat that as "no blocks" rather than a user-visible error.
      const message = (err as Error).message;
      const isMissing =
        message.startsWith("404") || /not found/i.test(message);
      set({
        loading: false,
        blocks: [],
        error: isMissing ? null : message,
      });
    }
  },

  reset() {
    clearPending();
    revision = 0;
    pending.revision = 0;
    set({
      pageId: null,
      blocks: [],
      loading: false,
      error: null,
      saveStatus: "idle",
      lastSavedAt: null,
    });
  },

  scheduleSave(pageId, blocks) {
    // If the store already moved on to a different page, ignore.
    if (get().pageId !== pageId) return;
    revision += 1;
    pending.pageId = pageId;
    pending.blocks = blocks;
    pending.revision = revision;
    set({ saveStatus: "idle" });
    addUnloadListeners();
    armTimer();
  },

  async flush() {
    await sendPending(true);
  },
}));
