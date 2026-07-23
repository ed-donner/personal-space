import { create } from "zustand";
import type { Page, PageDraft, PagePatch } from "./types";
import { api } from "./api";
import {
  buildTree,
  findFirstRoot,
  pickReplacementSelection,
} from "./tree";

interface State {
  pages: Page[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  expanded: Record<string, boolean>;

  load: () => Promise<void>;
  create: (draft: PageDraft) => Promise<Page>;
  update: (id: string, patch: PagePatch) => Promise<Page>;
  remove: (id: string) => Promise<void>;
  select: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
  setExpanded: (id: string, open: boolean) => void;
}

export const usePages = create<State>((set, get) => ({
  pages: [],
  loading: false,
  error: null,
  selectedId: null,
  expanded: {},

  async load() {
    set({ loading: true, error: null });
    try {
      const pages = await api.listPages();
      const tree = buildTree(pages);
      const first = findFirstRoot(tree);
      const currentSelection = get().selectedId;
      const stillExists = currentSelection
        ? pages.some((p) => p.id === currentSelection)
        : false;
      set({
        pages,
        loading: false,
        selectedId: stillExists ? currentSelection : (first?.page.id ?? null),
      });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  async create(draft) {
    const created = await api.createPage(draft);
    set((s) => {
      const pages = [...s.pages, created];
      // Make sure the parent is expanded so the new child is visible.
      const expanded = { ...s.expanded };
      if (created.parentId) expanded[created.parentId] = true;
      return { pages, expanded };
    });
    return created;
  },

  async update(id, patch) {
    const updated = await api.updatePage(id, patch);
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? updated : p)),
    }));
    return updated;
  },

  async remove(id) {
    await api.deletePage(id);
    // The server cascades, so refetch to drop the descendants from local state too.
    try {
      const pages = await api.listPages();
      const tree = buildTree(pages);
      const currentSelection = get().selectedId;
      let selectedId = currentSelection;
      if (selectedId === id || !pages.some((p) => p.id === selectedId)) {
        selectedId = pickReplacementSelection(tree, id);
      }
      set({ pages, selectedId });
    } catch (err) {
      // Fall back to a local filter if the refetch fails: drop the page and
      // anything that has it as an ancestor.
      set((s) => {
        const dropIds = new Set<string>([id]);
        let added = true;
        while (added) {
          added = false;
          for (const p of s.pages) {
            if (p.parentId && dropIds.has(p.parentId) && !dropIds.has(p.id)) {
              dropIds.add(p.id);
              added = true;
            }
          }
        }
        const kept = s.pages.filter((p) => !dropIds.has(p.id));
        let selectedId = s.selectedId;
        if (selectedId === id || !kept.some((p) => p.id === selectedId)) {
          const tree = buildTree(kept);
          selectedId = pickReplacementSelection(tree, id);
        }
        return { pages: kept, selectedId };
      });
    }
  },

  select(id) {
    set({ selectedId: id });
  },

  toggleExpanded(id) {
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } }));
  },

  setExpanded(id, open) {
    set((s) => ({ expanded: { ...s.expanded, [id]: open } }));
  },
}));
