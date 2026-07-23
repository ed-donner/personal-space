// Database store: holds the currently-loaded database (its properties and
// rows) plus the operations that mutate them. We keep one database in memory
// at a time — the table view only renders one, and switching to another
// re-loads via `load()`.
//
// All edits go through this store so the UI can call simple `updateRow`,
// `createOption`, `addRow` etc. without touching the API surface directly,
// and so the PATCH/POST/DELETE round-trips update local state atomically.

import { create } from "zustand";
import { api } from "./api";
import { usePages } from "./store";
import type {
  CellValue,
  DatabasePayload,
  OptionColor,
  Page,
  Property,
  PropertyDraft,
  PropertyOption,
  Row,
  RowPatch,
} from "./types";
import {
  emptyDatabaseViews,
  type DatabaseViews,
  type Filter,
  type Sort,
  type ViewKind,
  type ViewSettings,
} from "./viewLogic";

export type DatabaseStatus = "idle" | "loading" | "saving" | "error";

// The palette order used for new option colors. Kept in sync with the
// CSS swatches in styles.css (see .opt-chip / --chip-*-bg).
export const OPTION_PALETTE: OptionColor[] = [
  "gray",
  "red",
  "amber",
  "green",
  "blue",
  "purple",
  "pink",
];

interface State {
  databaseId: string | null;
  database: Page | null;
  properties: Property[];
  rows: Row[];
  status: DatabaseStatus;
  error: string | null;
  /** Save indicator: which row+property is currently being saved (or null). */
  pending: Set<string>;
  /** Most recent save timestamps for the indicator ("saved" state). */
  lastSavedAt: number | null;
  /** Per-view settings (filters, sort, groupBy, listProps). */
  views: DatabaseViews;
  /** True while a views PUT is in flight. */
  viewsPending: boolean;
  /** Error from the most recent views PUT (cleared on next success). */
  viewsError: string | null;
  /** True once views have been loaded for the current database. */
  viewsLoaded: boolean;

  load: (databaseId: string) => Promise<void>;
  reset: () => void;

  // Properties
  addProperty: (draft: PropertyDraft) => Promise<Property>;
  renameProperty: (id: string, name: string) => Promise<Property>;
  deleteProperty: (id: string) => Promise<void>;
  addOption: (
    propertyId: string,
    label: string,
    color?: OptionColor,
  ) => Promise<Property>;

  // Rows
  addRow: (databaseId: string, title?: string) => Promise<Row>;
  updateRowValue: (
    rowId: string,
    propertyId: string,
    value: CellValue | null,
  ) => Promise<Row>;
  renameRow: (rowId: string, title: string) => Promise<Row>;
  deleteRow: (rowId: string) => Promise<void>;
  /**
   * Register a row as a navigable page in the pages store, so the row
   * page view can render when the user selects it. Rows are pages of
   * type 'row'; the existing tree code excludes them from the sidebar.
   * Accepts either a Row (typical — the row just came back from the API)
   * or a rowId (legacy — looks the row up in the loaded database store).
   */
  ensureRowInPages: (rowOrId: Row | string) => Page | null;
  openRow: (rowId: string) => void;

  // Views (Phase 4)
  /**
   * Load (or re-load) the per-view settings for the current database.
   * Safe to call multiple times; the store marks itself `viewsLoaded`
   * so the UI can wait until the initial fetch resolves.
   */
  loadViews: (databaseId: string) => Promise<void>;
  /**
   * PUT a partial view patch to the server, then merge the response
   * into local state. Optimistic: callers can update `views` locally
   * first, then await this to commit; on failure we restore the
   * pre-call snapshot and surface the error via `viewsError`.
   */
  patchViews: (patch: {
    activeView?: ViewKind;
    table?: Partial<ViewSettings>;
    board?: Partial<ViewSettings>;
    list?: Partial<ViewSettings>;
  }) => Promise<DatabaseViews | null>;
  /** Pure local helper to merge a partial patch into `views`. */
  applyViewPatchLocally: (patch: {
    activeView?: ViewKind;
    table?: Partial<ViewSettings>;
    board?: Partial<ViewSettings>;
    list?: Partial<ViewSettings>;
  }) => void;
  /** Move a row's value for a select property — used by the board drag. */
  moveCardToOption: (
    rowId: string,
    propertyId: string,
    optionId: string | null,
  ) => Promise<Row>;
  /** Convenience helpers per view setting. */
  setActiveView: (kind: ViewKind) => Promise<void>;
  setGroupBy: (propertyId: string | null) => Promise<void>;
  setListProps: (propertyIds: string[]) => Promise<void>;
  addFilter: (view: ViewKind, filter: Filter) => Promise<void>;
  removeFilter: (view: ViewKind, filterId: string) => Promise<void>;
  setSort: (view: ViewKind, sort: Sort | null) => Promise<void>;
}

function nextOptionColor(existing: PropertyOption[]): OptionColor {
  // Rotating palette: pick the swatch least-used so the column spreads
  // visually. Falls back to the head of the list.
  const counts = new Map<OptionColor, number>();
  for (const c of OPTION_PALETTE) counts.set(c, 0);
  for (const o of existing) counts.set(o.color, (counts.get(o.color) ?? 0) + 1);
  let best: OptionColor = "gray";
  let bestCount = Infinity;
  for (const c of OPTION_PALETTE) {
    const n = counts.get(c) ?? 0;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

function pendingKey(rowId: string, propertyId: string): string {
  return `${rowId}:${propertyId}`;
}

export const useDatabase = create<State>((set, get) => ({
  databaseId: null,
  database: null,
  properties: [],
  rows: [],
  status: "idle",
  error: null,
  pending: new Set<string>(),
  lastSavedAt: null,
  views: emptyDatabaseViews(),
  viewsPending: false,
  viewsError: null,
  viewsLoaded: false,

  async load(databaseId) {
    // DEF-013: views state is per-database. Switching to another database
    // must not surface the previous database's filters / sort / groupBy /
    // listProps / activeView. We clear them here so the previous database's
    // settings never bleed into the target database's UI during the load
    // window. The new database's settings are fetched right after by
    // loadViews() in DatabaseView's effect.
    set({
      status: "loading",
      error: null,
      views: emptyDatabaseViews(),
      viewsLoaded: false,
      viewsError: null,
    });
    try {
      const data: DatabasePayload = await api.getDatabase(databaseId);
      set({
        databaseId,
        database: data.database,
        properties: data.properties,
        rows: data.rows,
        status: "idle",
      });
    } catch (err) {
      set({ status: "error", error: (err as Error).message });
    }
  },

  reset() {
    set({
      databaseId: null,
      database: null,
      properties: [],
      rows: [],
      status: "idle",
      error: null,
      pending: new Set<string>(),
      lastSavedAt: null,
      views: emptyDatabaseViews(),
      viewsPending: false,
      viewsError: null,
      viewsLoaded: false,
    });
  },

  async addProperty(draft) {
    const databaseId = get().databaseId;
    if (!databaseId) throw new Error("no database loaded");
    const created = await api.createProperty(databaseId, draft);
    set((s) => ({
      properties: [...s.properties, created].sort(
        (a, b) => a.position - b.position,
      ),
    }));
    return created;
  },

  async renameProperty(id, name) {
    const updated = await api.updateProperty(id, { name });
    set((s) => ({
      properties: s.properties.map((p) => (p.id === id ? updated : p)),
    }));
    return updated;
  },

  async deleteProperty(id) {
    await api.deleteProperty(id);
    set((s) => {
      // Drop the property and scrub its value from every row.
      const nextRows = s.rows.map((r) => {
        if (!(id in r.values)) return r;
        const { [id]: _drop, ...rest } = r.values;
        return { ...r, values: rest };
      });
      return {
        properties: s.properties.filter((p) => p.id !== id),
        rows: nextRows,
      };
    });
  },

  async addOption(propertyId, label, color) {
    const prop = get().properties.find((p) => p.id === propertyId);
    if (!prop) throw new Error(`property not found: ${propertyId}`);
    if (prop.type !== "select" && prop.type !== "multiSelect") {
      throw new Error(`property ${propertyId} is not a select`);
    }
    // Server mints option ids; we send the new option with a client-mint
    // temporary id and let the server replace it on response.
    const clientId = `opt-${Math.random().toString(36).slice(2, 10)}`;
    const useColor: OptionColor = color ?? nextOptionColor(prop.options);
    const newOption: PropertyOption = {
      id: clientId,
      label,
      color: useColor,
    };
    const next = [...prop.options, newOption];
    const updated = await api.updateProperty(propertyId, { options: next });
    set((s) => ({
      properties: s.properties.map((p) =>
        p.id === propertyId ? updated : p,
      ),
    }));
    return updated;
  },

  async addRow(databaseId, title) {
    const created = await api.createRow(databaseId, title ? { title } : {});
    set((s) => {
      // Only append to the loaded rows list if this database is the one
      // currently in view. Otherwise the row belongs to a sibling database
      // and the user will see it when they navigate there.
      if (s.databaseId === databaseId) {
        return { rows: [...s.rows, created] };
      }
      return {};
    });
    return created;
  },

  async updateRowValue(rowId, propertyId, value) {
    const key = pendingKey(rowId, propertyId);
    set((s) => {
      const next = new Set(s.pending);
      next.add(key);
      return { pending: next };
    });
    const row = get().rows.find((r) => r.id === rowId);
    if (!row) {
      set((s) => {
        const next = new Set(s.pending);
        next.delete(key);
        return { pending: next };
      });
      throw new Error(`row not found: ${rowId}`);
    }
    // The API merges values per property. Send only the edited key so parallel
    // cell saves cannot overwrite one another. Null must be explicit: omitting
    // the key means "leave unchanged" on the real API.
    const values: RowPatch["values"] = { [propertyId]: value };
    try {
      const updated = await api.updateRow(rowId, { values });
      set((s) => {
        const next = new Set(s.pending);
        next.delete(key);
        return {
          rows: s.rows.map((r) => (r.id === rowId ? updated : r)),
          pending: next,
          lastSavedAt: Date.now(),
        };
      });
      return updated;
    } catch (err) {
      set((s) => {
        const next = new Set(s.pending);
        next.delete(key);
        return { pending: next, status: "error", error: (err as Error).message };
      });
      throw err;
    }
  },

  async renameRow(rowId, title) {
    const updated = await api.updateRow(rowId, { title });
    set((s) => ({
      rows: s.rows.map((r) => (r.id === rowId ? updated : r)),
      lastSavedAt: Date.now(),
    }));
    return updated;
  },

  async deleteRow(rowId) {
    await api.deleteRow(rowId);
    set((s) => ({ rows: s.rows.filter((r) => r.id !== rowId) }));
  },

  ensureRowInPages(rowOrId) {
    const row: Row | undefined =
      typeof rowOrId === "string"
        ? get().rows.find((r) => r.id === rowOrId)
        : rowOrId;
    if (!row) return null;
    // Use the pages store (zustand) to register this row as a navigable
    // page. The page is type "row" so the sidebar tree (which excludes
    // rows) won't show it, but PageView can find and render it as a row
    // page.
    const pagesState = usePages.getState();
    const existing = pagesState.pages.find((p) => p.id === row.id);
    const page: Page = existing ?? {
      id: row.id,
      parentId: row.databaseId,
      title: row.title,
      icon: "📄",
      type: "row",
      position: row.position,
    };
    if (!existing) {
      usePages.setState((s) => ({ pages: [...s.pages, page] }));
    }
    return page;
  },

  openRow(_rowId) {
    // Navigation is handled in the App; the store doesn't need to track it.
  },

  // ---- Phase 4: views ----

  applyViewPatchLocally(patch) {
    set((s) => {
      const next: DatabaseViews = {
        activeView: patch.activeView ?? s.views.activeView,
        table: { ...s.views.table, ...(patch.table ?? {}) },
        board: { ...s.views.board, ...(patch.board ?? {}) },
        list: { ...s.views.list, ...(patch.list ?? {}) },
      };
      return { views: next };
    });
  },

  async loadViews(databaseId) {
    try {
      const v = await api.getViews(databaseId);
      // DEF-013: guard against a late response. If the user has already
      // switched to a different database while this fetch was in flight,
      // the response belongs to a previous database and must not be
      // merged into the now-current database's UI. We compare against
      // databaseId captured at call time AND the current databaseId.
      if (get().databaseId !== databaseId) return;
      // The server response may include partial defaults; fill in missing
      // pieces locally so consumers can always read the full shape.
      set({
        views: {
          activeView: v.activeView,
          table: { ...emptyDatabaseViews().table, ...v.table },
          board: { ...emptyDatabaseViews().board, ...v.board },
          list: { ...emptyDatabaseViews().list, ...v.list },
        },
        viewsLoaded: true,
        viewsError: null,
      });
    } catch (err) {
      // Same guard for the error path: don't surface a views error from
      // a previous database on the now-current one.
      if (get().databaseId !== databaseId) return;
      // Don't blow up the page if the views endpoint is unavailable — we
      // still want the database to render. The UI can fall back to
      // defaults and show the empty state.
      set({
        viewsLoaded: true,
        viewsError: (err as Error).message,
        views: emptyDatabaseViews(),
      });
    }
  },

  async patchViews(patch) {
    const databaseId = get().databaseId;
    if (!databaseId) return null;
    const before = get().views;
    // Optimistic local merge so the UI is snappy.
    get().applyViewPatchLocally(patch);
    set({ viewsPending: true, viewsError: null });
    try {
      const next = await api.updateViews(databaseId, patch);
      set({
        views: {
          activeView: next.activeView,
          table: { ...before.table, ...next.table },
          board: { ...before.board, ...next.board },
          list: { ...before.list, ...next.list },
        },
        viewsPending: false,
      });
      return next;
    } catch (err) {
      // Rollback to the pre-call snapshot.
      set({
        views: before,
        viewsPending: false,
        viewsError: (err as Error).message,
      });
      return null;
    }
  },

  async moveCardToOption(rowId, propertyId, optionId) {
    // Reuse updateRowValue so the save indicator / pending set behave
    // identically. Drop optimistic update in favor of a single PATCH.
    return get().updateRowValue(rowId, propertyId, optionId);
  },

  async setActiveView(kind) {
    await get().patchViews({ activeView: kind });
  },

  async setGroupBy(propertyId) {
    await get().patchViews({ board: { groupBy: propertyId } });
  },

  async setListProps(propertyIds) {
    await get().patchViews({ list: { listProps: propertyIds } });
  },

  async addFilter(view, filter) {
    const current = get().views[view];
    await get().patchViews({ [view]: { filters: [...current.filters, filter] } });
  },

  async removeFilter(view, filterId) {
    const current = get().views[view];
    await get().patchViews({
      [view]: { filters: current.filters.filter((f) => f.id !== filterId) },
    });
  },

  async setSort(view, sort) {
    await get().patchViews({ [view]: { sort } });
  },
}));

// Selector helpers for components that don't want the whole row/property map.
export function selectRow(id: string) {
  return (s: State): Row | undefined => s.rows.find((r) => r.id === id);
}

export function selectProperty(id: string) {
  return (s: State): Property | undefined =>
    s.properties.find((p) => p.id === id);
}
