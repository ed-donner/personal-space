import type Database from "better-sqlite3";
import { DatabaseError, DatabaseRepository, isValidDate } from "./databases.js";
import type { Property, PropertyType } from "./types.js";

// Per-view settings contract for Phase 4. Filtering, sorting and grouping run
// client-side; the server persists each view's settings and validates them
// against the live properties of the database on PUT. A GET never validates --
// stored settings are returned as-is even if they reference a now-deleted
// property (stale refs are the client's cleanup problem).

export type ViewKind = "table" | "board" | "list";

const VIEW_KINDS: ReadonlySet<ViewKind> = new Set<ViewKind>([
  "table",
  "board",
  "list",
]);

export interface Filter {
  id: string;
  propertyId: string;
  op: string;
  value?: unknown;
}

export type Sort = { propertyId: string; direction: "asc" | "desc" } | null;

export interface ViewSettings {
  filters: Filter[];
  sort: Sort;
  groupBy: string | null;
  listProps: string[];
}

export interface DatabaseViews {
  activeView: ViewKind;
  table: ViewSettings;
  board: ViewSettings;
  list: ViewSettings;
}

/** Valid filter ops per property type. */
const OPS_BY_TYPE: Record<PropertyType, ReadonlySet<string>> = {
  text: new Set(["contains", "not-contains"]),
  url: new Set(["contains", "not-contains"]),
  number: new Set(["eq", "gt", "lt"]),
  select: new Set(["is", "is-not"]),
  multiSelect: new Set(["contains", "not-contains"]),
  checkbox: new Set(["is"]),
  date: new Set(["before", "after"]),
};

/** Build the default ViewSettings for `kind` from the live properties. */
function defaultSettings(kind: ViewKind, props: Property[]): ViewSettings {
  const base: ViewSettings = {
    filters: [],
    sort: null,
    groupBy: null,
    listProps: [],
  };
  if (kind === "board") {
    const firstSelect = props.find((p) => p.type === "select");
    base.groupBy = firstSelect ? firstSelect.id : null;
  } else if (kind === "list") {
    base.listProps = props.slice(0, 2).map((p) => p.id);
  }
  return base;
}

/** Coerce a parsed JSON value into a well-typed ViewSettings, filling gaps. */
function coerceSettings(
  parsed: unknown,
  def: ViewSettings,
): ViewSettings {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return def;
  }
  const o = parsed as Record<string, unknown>;
  return {
    filters: Array.isArray(o.filters) ? (o.filters as Filter[]) : def.filters,
    sort:
      o.sort === null ||
      (o.sort &&
        typeof o.sort === "object" &&
        !Array.isArray(o.sort) &&
        typeof (o.sort as Record<string, unknown>).propertyId === "string" &&
        ((o.sort as Record<string, unknown>).direction === "asc" ||
          (o.sort as Record<string, unknown>).direction === "desc"))
        ? (o.sort as Sort)
        : def.sort,
    groupBy:
      typeof o.groupBy === "string"
        ? o.groupBy
        : o.groupBy === null
          ? null
          : def.groupBy,
    listProps: Array.isArray(o.listProps)
      ? (o.listProps as string[])
      : def.listProps,
  };
}

function validateFilters(
  raw: unknown,
  propById: Map<string, Property>,
): Filter[] {
  if (!Array.isArray(raw)) {
    throw new DatabaseError("filters must be an array", 400);
  }
  const out: Filter[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object" || Array.isArray(f)) {
      throw new DatabaseError("filter must be an object", 400);
    }
    const filter = f as Record<string, unknown>;
    if (typeof filter.id !== "string" || filter.id.length === 0) {
      throw new DatabaseError("filter.id must be a non-empty string", 400);
    }
    if (typeof filter.propertyId !== "string") {
      throw new DatabaseError("filter.propertyId must be a string", 400);
    }
    const prop = propById.get(filter.propertyId);
    if (!prop) {
      throw new DatabaseError(
        `unknown property: ${filter.propertyId}`,
        400,
      );
    }
    if (typeof filter.op !== "string") {
      throw new DatabaseError("filter.op must be a string", 400);
    }
    const validOps = OPS_BY_TYPE[prop.type];
    if (!validOps.has(filter.op)) {
      throw new DatabaseError(
        `op '${filter.op}' is not valid for a ${prop.type} property`,
        400,
      );
    }
    validateFilterValue(prop, filter.op, filter.value);
    out.push({
      id: filter.id,
      propertyId: filter.propertyId,
      op: filter.op,
      value: filter.value,
    });
  }
  return out;
}

function validateFilterValue(
  prop: Property,
  op: string,
  value: unknown,
): void {
  switch (prop.type) {
    case "text":
    case "url": {
      if (typeof value !== "string") {
        throw new DatabaseError("filter value must be a string", 400);
      }
      return;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DatabaseError(
          "filter value must be a finite number",
          400,
        );
      }
      return;
    }
    case "select": {
      if (typeof value !== "string") {
        throw new DatabaseError("filter value must be an option id", 400);
      }
      if (!prop.options.some((o) => o.id === value)) {
        throw new DatabaseError(
          "filter value must be an option id of this property",
          400,
        );
      }
      return;
    }
    case "multiSelect": {
      if (typeof value !== "string") {
        throw new DatabaseError("filter value must be an option id", 400);
      }
      if (!prop.options.some((o) => o.id === value)) {
        throw new DatabaseError(
          "filter value must be an option id of this property",
          400,
        );
      }
      return;
    }
    case "checkbox": {
      if (typeof value !== "boolean") {
        throw new DatabaseError("filter value must be a boolean", 400);
      }
      return;
    }
    case "date": {
      if (typeof value !== "string" || !isValidDate(value)) {
        throw new DatabaseError(
          "filter value must be a YYYY-MM-DD calendar date",
          400,
        );
      }
      return;
    }
  }
}

function validateSort(raw: unknown, propById: Map<string, Property>): Sort {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DatabaseError("sort must be null or an object", 400);
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.propertyId !== "string") {
    throw new DatabaseError("sort.propertyId must be a string", 400);
  }
  if (!propById.has(s.propertyId)) {
    throw new DatabaseError(`unknown property: ${s.propertyId}`, 400);
  }
  if (s.direction !== "asc" && s.direction !== "desc") {
    throw new DatabaseError(
      "sort.direction must be 'asc' or 'desc'",
      400,
    );
  }
  return { propertyId: s.propertyId, direction: s.direction };
}

function validateGroupBy(
  raw: unknown,
  propById: Map<string, Property>,
): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw new DatabaseError("groupBy must be a string or null", 400);
  }
  const prop = propById.get(raw);
  if (!prop) {
    throw new DatabaseError(`unknown property: ${raw}`, 400);
  }
  if (prop.type !== "select") {
    throw new DatabaseError("groupBy must be a select property", 400);
  }
  return raw;
}

function validateListProps(
  raw: unknown,
  propById: Map<string, Property>,
): string[] {
  if (!Array.isArray(raw)) {
    throw new DatabaseError("listProps must be an array", 400);
  }
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== "string") {
      throw new DatabaseError("listProps entries must be strings", 400);
    }
    if (!propById.has(p)) {
      throw new DatabaseError(`unknown property: ${p}`, 400);
    }
    out.push(p);
  }
  return out;
}

/**
 * ViewRepository owns per-view settings persistence for database pages. GET
 * materializes defaults (board.groupBy -> first select, list.listProps ->
 * first two properties) and returns stored settings as-is, even when they
 * reference deleted properties. PUT validates every provided field against the
 * live properties of the database and merges at the view-key level: providing
 * `board` updates only the board settings, leaving table/list untouched.
 */
export class ViewRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly dbs: DatabaseRepository,
  ) {}

  /**
   * Return the active view and the settings for all three views of `id`.
   * Throws DatabaseError(404) if `id` is unknown or not a database page.
   */
  getViews(id: string): DatabaseViews {
    this.dbs.requireDatabase(id);
    const props = this.dbs.listProperties(id);
    return {
      activeView: this.loadActive(id),
      table: this.loadView(id, "table", props),
      board: this.loadView(id, "board", props),
      list: this.loadView(id, "list", props),
    };
  }

  /**
   * Apply a partial patch to the views of `id`. Only provided view keys
   * (table/board/list) are changed; within a provided view only provided
   * fields (filters/sort/groupBy/listProps) are changed. Unknown body keys
   * are ignored. Returns the full shape after the update.
   *
   * Throws DatabaseError(404) if `id` is unknown or not a database page.
   * Throws DatabaseError(400) for any validation failure (see module doc).
   */
  setViews(
    id: string,
    patch: {
      activeView?: unknown;
      table?: unknown;
      board?: unknown;
      list?: unknown;
    },
  ): DatabaseViews {
    this.dbs.requireDatabase(id);
    const props = this.dbs.listProperties(id);
    const propById = new Map(props.map((p) => [p.id, p]));

    let newActive: ViewKind | undefined;
    if (patch.activeView !== undefined) {
      if (
        typeof patch.activeView !== "string" ||
        !VIEW_KINDS.has(patch.activeView as ViewKind)
      ) {
        throw new DatabaseError(
          "activeView must be 'table', 'board' or 'list'",
          400,
        );
      }
      newActive = patch.activeView as ViewKind;
    }

    // Validate each provided view field-by-field against the current stored
    // settings (so a partial PUT only touches the provided fields). No write
    // happens before every field validates -- a bad field leaves the stored
    // settings untouched.
    const planned: Array<{ kind: ViewKind; merged: ViewSettings }> = [];
    for (const kind of ["table", "board", "list"] as ViewKind[]) {
      const provided = (patch as Record<string, unknown>)[kind];
      if (provided === undefined) continue;
      const existing = this.loadView(id, kind, props);
      const merged = this.validateView(provided, existing, propById);
      planned.push({ kind, merged });
    }

    const upsertView = this.db.prepare(
      `INSERT INTO view_settings (database_id, view_kind, settings)
       VALUES (?, ?, ?)
       ON CONFLICT(database_id, view_kind)
       DO UPDATE SET settings = excluded.settings`,
    );
    const upsertActive = this.db.prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    const tx = this.db.transaction(() => {
      for (const { kind, merged } of planned) {
        upsertView.run(id, kind, JSON.stringify(merged));
      }
      if (newActive !== undefined) {
        upsertActive.run(`views:active:${id}`, newActive);
      }
    });
    tx();
    return this.getViews(id);
  }

  /** Load and validate one provided view object, merging over `existing`. */
  private validateView(
    raw: unknown,
    existing: ViewSettings,
    propById: Map<string, Property>,
  ): ViewSettings {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new DatabaseError("view settings must be an object", 400);
    }
    const o = raw as Record<string, unknown>;
    const result: ViewSettings = {
      filters: existing.filters,
      sort: existing.sort,
      groupBy: existing.groupBy,
      listProps: existing.listProps,
    };
    if (o.filters !== undefined) {
      result.filters = validateFilters(o.filters, propById);
    }
    if (o.sort !== undefined) {
      result.sort = validateSort(o.sort, propById);
    }
    if (o.groupBy !== undefined) {
      result.groupBy = validateGroupBy(o.groupBy, propById);
    }
    if (o.listProps !== undefined) {
      result.listProps = validateListProps(o.listProps, propById);
    }
    return result;
  }

  private loadActive(id: string): ViewKind {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(`views:active:${id}`) as { value: string } | undefined;
    if (!row) return "table";
    return VIEW_KINDS.has(row.value as ViewKind)
      ? (row.value as ViewKind)
      : "table";
  }

  private loadView(
    id: string,
    kind: ViewKind,
    props: Property[],
  ): ViewSettings {
    const def = defaultSettings(kind, props);
    const row = this.db
      .prepare(
        "SELECT settings FROM view_settings WHERE database_id = ? AND view_kind = ?",
      )
      .get(id, kind) as { settings: string } | undefined;
    if (!row) return def;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.settings);
    } catch {
      return def;
    }
    return coerceSettings(parsed, def);
  }
}
