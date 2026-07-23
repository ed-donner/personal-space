import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Page,
  Property,
  PropertyOption,
  PropertyType,
  Row,
} from "./types.js";
import { rowToPage, rowToProperty } from "./types.js";
import type { PageRow, PropertyRow, RowValueRow } from "./types.js";
import { PageError, PageRepository } from "./pages.js";

/** Maximum length of a property name (validated like a page title). */
export const MAX_NAME_LENGTH = 200;
/** Maximum length of a select/multiSelect option label. */
export const MAX_OPTION_LABEL_LENGTH = 100;
/** Maximum length of an option color string. */
export const MAX_COLOR_LENGTH = 30;
/** Maximum length of a text or url cell value. */
export const MAX_TEXT_LENGTH = 10_000;

const PROPERTY_TYPES: ReadonlySet<string> = new Set<PropertyType>([
  "text",
  "number",
  "select",
  "multiSelect",
  "date",
  "checkbox",
  "url",
]);

function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === "string" && PROPERTY_TYPES.has(value);
}

/** An error carrying an HTTP status code, for the routes layer to map. */
export class DatabaseError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "DatabaseError";
  }
}

/**
 * Convert a PageError raised by a delegated PageRepository call into a
 * DatabaseError with the same status and message, so the database routes
 * layer maps it to the right HTTP response. Other errors are rethrown as-is.
 * Used for DEF-008: row title validation errors (empty / over-length) must
 * surface as 400 with the page-title messages, not as 500 "internal error".
 */
function asDatabaseError(err: unknown): DatabaseError {
  if (err instanceof PageError) {
    return new DatabaseError(err.message, err.status);
  }
  throw err;
}

/**
 * Normalize and validate a property name. Names follow the same rule as page
 * titles: trimmed, 1..MAX_NAME_LENGTH characters. A missing or non-string
 * name is rejected as 400 (the create path requires a name).
 */
function normalizeName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new DatabaseError("name must be a non-empty string", 400);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new DatabaseError("name must not be empty", 400);
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new DatabaseError(
      `name must be at most ${MAX_NAME_LENGTH} characters`,
      400,
    );
  }
  return trimmed;
}

/**
 * Validate a single option from a replace payload. The id is honored when
 * supplied (non-empty string); otherwise a fresh id is generated. The label
 * is trimmed and must be 1..MAX_OPTION_LABEL_LENGTH characters; the color must
 * be a non-empty string of at most MAX_COLOR_LENGTH characters.
 */
function normalizeOption(raw: unknown): PropertyOption {
  if (!raw || typeof raw !== "object") {
    throw new DatabaseError("option must be an object", 400);
  }
  const o = raw as { id?: unknown; label?: unknown; color?: unknown };
  const label =
    typeof o.label === "string" ? o.label.trim() : "";
  if (label.length === 0 || label.length > MAX_OPTION_LABEL_LENGTH) {
    throw new DatabaseError(
      "option label must be 1-100 characters",
      400,
    );
  }
  const color = typeof o.color === "string" ? o.color : "";
  if (color.length === 0 || color.length > MAX_COLOR_LENGTH) {
    throw new DatabaseError(
      "option color must be 1-30 characters",
      400,
    );
  }
  const id =
    typeof o.id === "string" && o.id.length > 0 ? o.id : randomUUID();
  return { id, label, color };
}

/**
 * Validate a cell value against the property's type and return the normalized
 * value to store (JSON-encoded by the caller). Throws DatabaseError(400) for a
 * wrong-shaped value.
 *
 *   text/url      -> string <= 10000 chars (null not allowed)
 *   number        -> finite number | null
 *   select        -> optionId of this property | null
 *   multiSelect   -> optionId[] of this property (dupes removed, order kept)
 *   date          -> 'YYYY-MM-DD' valid calendar date | null
 *   checkbox      -> boolean
 */
function validateValue(prop: Property, value: unknown): unknown {
  switch (prop.type) {
    case "text": {
      if (typeof value !== "string") {
        throw new DatabaseError("text value must be a string", 400);
      }
      if (value.length > MAX_TEXT_LENGTH) {
        throw new DatabaseError(
          `text value must be at most ${MAX_TEXT_LENGTH} characters`,
          400,
        );
      }
      return value;
    }
    case "url": {
      // DEF-005: a URL property accepts only an absolute http(s) URL, an empty
      // string, or null (empty/null = unset). Anything else (javascript:,
      // relative paths, plain text) is rejected with 400.
      if (value === null) return null;
      if (typeof value !== "string") {
        throw new DatabaseError(
          "url value must be a string or null",
          400,
        );
      }
      if (value.length === 0) return value;
      if (value.length > MAX_TEXT_LENGTH) {
        throw new DatabaseError(
          `url value must be at most ${MAX_TEXT_LENGTH} characters`,
          400,
        );
      }
      if (!isAbsoluteHttpUrl(value)) {
        throw new DatabaseError(
          "url value must be an absolute http(s) URL",
          400,
        );
      }
      return value;
    }
    case "number": {
      if (value === null) return null;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DatabaseError(
          "number value must be a finite number or null",
          400,
        );
      }
      return value;
    }
    case "select": {
      if (value === null) return null;
      if (typeof value !== "string") {
        throw new DatabaseError(
          "select value must be an option id or null",
          400,
        );
      }
      if (!prop.options.some((o) => o.id === value)) {
        throw new DatabaseError(
          "select value must be an option id of this property",
          400,
        );
      }
      return value;
    }
    case "multiSelect": {
      if (!Array.isArray(value)) {
        throw new DatabaseError(
          "multiSelect value must be an array of option ids",
          400,
        );
      }
      const validIds = new Set(prop.options.map((o) => o.id));
      const out: string[] = [];
      for (const v of value) {
        if (typeof v !== "string" || !validIds.has(v)) {
          throw new DatabaseError(
            "multiSelect value must be option ids of this property",
            400,
          );
        }
        if (!out.includes(v)) out.push(v); // dedupe, preserve order
      }
      return out;
    }
    case "date": {
      if (value === null) return null;
      if (typeof value !== "string" || !isValidDate(value)) {
        throw new DatabaseError(
          "date value must be a YYYY-MM-DD calendar date or null",
          400,
        );
      }
      return value;
    }
    case "checkbox": {
      if (typeof value !== "boolean") {
        throw new DatabaseError("checkbox value must be a boolean", 400);
      }
      return value;
    }
  }
}

/** True if `s` is a real calendar date in YYYY-MM-DD form. */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y &&
    dt.getMonth() === m - 1 &&
    dt.getDate() === d
  );
}

/**
 * True if `s` is an absolute http: or https: URL. Relative paths, plain
 * text and dangerous schemes (javascript:, data:, ...) all return false.
 */
function isAbsoluteHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * DatabaseRepository owns all database storage logic: the aggregate read,
 * property CRUD (with option replace + scrub), and row CRUD (with typed
 * value merge). A row is a page of type 'row' whose parent_id is its
 * database; the page-level create/delete is delegated to PageRepository so
 * title validation, sibling positioning and cascade deletion stay in one
 * place.
 *
 * Constructed against an open better-sqlite3 connection plus a PageRepository
 * so tests can inject an in-memory database while the server uses the on-disk
 * one.
 */
export class DatabaseRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly pages: PageRepository,
  ) {}

  // ---- aggregate ----

  /**
   * Return the database page, its properties (ordered) and its rows (ordered,
   * each with its values map). Throws DatabaseError(404) if `id` is unknown
   * or not a database page.
   */
  getDatabase(id: string): {
    database: Page;
    properties: Property[];
    rows: Row[];
  } {
    const page = this.requireDatabase(id);
    return {
      database: page,
      properties: this.listProperties(id),
      rows: this.listRows(id),
    };
  }

  /**
   * Return the database page, or throw DatabaseError(404) if `id` is unknown
   * or not a database page. Shared by the aggregate read and the views
   * repository so the "not a database" 404 stays in one place.
   */
  requireDatabase(id: string): Page {
    const page = this.pages.findById(id);
    if (!page || page.type !== "database") {
      throw new DatabaseError("database not found", 404);
    }
    return page;
  }

  // ---- properties ----

  /** Return the properties of a database, ordered by position then id. */
  listProperties(databaseId: string): Property[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM properties WHERE database_id = ? ORDER BY position ASC, id ASC",
      )
      .all(databaseId) as PropertyRow[];
    return rows.map(rowToProperty);
  }

  /** Look up a single property by id, or undefined. */
  findProperty(id: string): Property | undefined {
    const row = this.db
      .prepare("SELECT * FROM properties WHERE id = ?")
      .get(id) as PropertyRow | undefined;
    return row ? rowToProperty(row) : undefined;
  }

  /**
   * Create a property on `databaseId`. Options start empty. Position is
   * max+1 among the database's properties.
   *
   * Throws DatabaseError(404) if the database is unknown or not a database.
   * Throws DatabaseError(400) if the type is missing/invalid or the name is
   * missing/empty.
   */
  createProperty(
    databaseId: string,
    draft: { name?: unknown; type?: unknown },
  ): Property {
    const page = this.pages.findById(databaseId);
    if (!page || page.type !== "database") {
      throw new DatabaseError("database not found", 404);
    }
    if (!isPropertyType(draft.type)) {
      throw new DatabaseError("invalid property type", 400);
    }
    const name = normalizeName(draft.name);
    const id = randomUUID();
    const position = this.nextPropertyPosition(databaseId);
    this.db
      .prepare(
        `INSERT INTO properties (id, database_id, name, type, options, position)
         VALUES (?, ?, ?, ?, '[]', ?)`,
      )
      .run(id, databaseId, name, draft.type, position);
    return this.findProperty(id)!;
  }

  /**
   * Patch a property. The `type` field is ignored (a property's type is
   * fixed at creation). `name`, when provided, is validated like a property
   * name. `options`, when provided, is a full replacement: client-supplied
   * ids are honored and others are generated; option ids that were present
   * before but are now missing are scrubbed from every row's stored value
   * (select -> null, multiSelect -> filtered out). Name and option replace
   * happen in one transaction; a bad option produces no write.
   *
   * Throws DatabaseError(404) if the id is unknown.
   */
  updateProperty(
    id: string,
    patch: { name?: unknown; options?: unknown },
  ): Property {
    const existing = this.findProperty(id);
    if (!existing) {
      throw new DatabaseError("property not found", 404);
    }
    const name =
      patch.name === undefined ? existing.name : normalizeName(patch.name);

    if (patch.options === undefined) {
      this.db
        .prepare("UPDATE properties SET name = ? WHERE id = ?")
        .run(name, id);
      return this.findProperty(id)!;
    }

    const newOptions = buildOptions(patch.options);
    const removedIds = existing.options
      .map((o) => o.id)
      .filter((oid) => !newOptions.some((n) => n.id === oid));

    const updateProp = this.db.prepare(
      "UPDATE properties SET name = ?, options = ? WHERE id = ?",
    );
    const tx = this.db.transaction(() => {
      updateProp.run(name, JSON.stringify(newOptions), id);
      for (const oid of removedIds) {
        this.scrubOption(id, existing.type, oid);
      }
    });
    tx();
    return this.findProperty(id)!;
  }

  /**
   * Delete a property, every row value stored against it, and every stale
   * reference to it in this database's stored view_settings rows (DEF-012):
   * filters that name it are dropped, sort/groupBy pointing at it become
   * null, and it is pruned from listProps. All of this happens in one
   * transaction so a partial scrub never lands. Defaults materialized on GET
   * are derived from the live properties, so they need no scrubbing here.
   *
   * Throws DatabaseError(404) if the id is unknown.
   */
  removeProperty(id: string): void {
    const existing = this.findProperty(id);
    if (!existing) {
      throw new DatabaseError("property not found", 404);
    }
    const deleteValues = this.db.prepare(
      "DELETE FROM row_values WHERE property_id = ?",
    );
    const deleteProp = this.db.prepare("DELETE FROM properties WHERE id = ?");
    const getViewSettings = this.db.prepare(
      "SELECT view_kind, settings FROM view_settings WHERE database_id = ?",
    );
    const updateViewSettings = this.db.prepare(
      "UPDATE view_settings SET settings = ? WHERE database_id = ? AND view_kind = ?",
    );
    const tx = this.db.transaction(() => {
      // Explicit so the cascade does not depend on the foreign_keys pragma.
      deleteValues.run(id);
      deleteProp.run(id);
      // Scrub stale references from every stored view_settings row of this
      // database. Only rows whose settings actually change are rewritten.
      const rows = getViewSettings.all(existing.databaseId) as {
        view_kind: string;
        settings: string;
      }[];
      for (const row of rows) {
        const scrubbed = scrubPropertyFromSettings(row.settings, id);
        if (scrubbed !== null) {
          updateViewSettings.run(scrubbed, existing.databaseId, row.view_kind);
        }
      }
    });
    tx();
  }

  // ---- rows ----

  /** Return the rows of a database, ordered by position then id. */
  listRows(databaseId: string): Row[] {
    const pageRows = this.db
      .prepare(
        "SELECT * FROM pages WHERE parent_id = ? AND type = 'row' ORDER BY position ASC, id ASC",
      )
      .all(databaseId) as PageRow[];
    const rows = pageRows.map(rowToPage);
    if (rows.length === 0) return [];
    const values = this.loadValues(rows.map((r) => r.id));
    return rows.map((r) => this.buildRow(r, values.get(r.id) ?? new Map()));
  }

  /** Look up a single row by id, or undefined (also undefined for non-rows). */
  findRow(id: string): Row | undefined {
    const page = this.pages.findById(id);
    if (!page || page.type !== "row") return undefined;
    const values = this.loadValues([id]);
    return this.buildRow(page, values.get(id) ?? new Map());
  }

  /**
   * Create a row under `databaseId`. The backing page has type 'row' and
   * parent_id = databaseId; its title defaults to 'Untitled' when omitted.
   * Throws DatabaseError(404) if the database is unknown or not a database.
   */
  createRow(databaseId: string, draft: { title?: unknown }): Row {
    const page = this.pages.findById(databaseId);
    if (!page || page.type !== "database") {
      throw new DatabaseError("database not found", 404);
    }
    const title =
      typeof draft.title === "string" ? draft.title : undefined;
    let rowPage;
    try {
      rowPage = this.pages.create({
        parentId: databaseId,
        type: "row",
        title,
      });
    } catch (err) {
      throw asDatabaseError(err);
    }
    return this.buildRow(rowPage, new Map());
  }

  /**
   * Patch a row. `title`, when provided and a string, renames the backing
   * page (validated like a page title). `values`, when provided, is merged
   * per-key: each key must name an existing property of the row's database
   * and its value is validated per the property's type; the merged value is
   * stored, leaving other keys untouched. All keys are validated before any
   * write, so a bad value or unknown key produces no partial write.
   *
   * Throws DatabaseError(404) if the id is unknown or not a row.
   * Throws DatabaseError(400) for an unknown property key or a bad value.
   */
  updateRow(
    id: string,
    patch: { title?: unknown; values?: unknown },
  ): Row {
    const page = this.pages.findById(id);
    if (!page || page.type !== "row") {
      throw new DatabaseError("row not found", 404);
    }
    if (patch.title !== undefined) {
      if (typeof patch.title !== "string") {
        throw new DatabaseError("title must be a string", 400);
      }
      try {
        this.pages.update(id, { title: patch.title });
      } catch (err) {
        throw asDatabaseError(err);
      }
    }
    if (patch.values !== undefined) {
      this.mergeValues(page.id, page.parentId, patch.values);
    }
    return this.findRow(id)!;
  }

  /**
   * Delete a row and its blocks (via page delete). Throws DatabaseError(404)
   * if the id is unknown or not a row.
   */
  removeRow(id: string): void {
    const page = this.pages.findById(id);
    if (!page || page.type !== "row") {
      throw new DatabaseError("row not found", 404);
    }
    this.pages.remove(id);
  }

  // ---- internals ----

  private nextPropertyPosition(databaseId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM properties WHERE database_id = ?",
      )
      .get(databaseId) as { p: number };
    return row.p;
  }

  /**
   * Validate and merge `raw` into the row's stored values. Each key must
   * name a property of the row's database; values are validated per type.
   * Validated entries are upserted in one transaction.
   */
  private mergeValues(
    rowId: string,
    databaseId: string | null,
    raw: unknown,
  ): void {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new DatabaseError("values must be an object", 400);
    }
    if (databaseId === null) {
      throw new DatabaseError("row has no database", 400);
    }
    const props = this.listProperties(databaseId);
    const propById = new Map(props.map((p) => [p.id, p]));

    const entries = Object.entries(raw as Record<string, unknown>);
    const validated: Array<{ key: string; value: unknown }> = [];
    for (const [key, value] of entries) {
      const prop = propById.get(key);
      if (!prop) {
        throw new DatabaseError(`unknown property: ${key}`, 400);
      }
      validated.push({ key, value: validateValue(prop, value) });
    }

    const upsert = this.db.prepare(
      `INSERT INTO row_values (row_id, property_id, value) VALUES (?, ?, ?)
       ON CONFLICT(row_id, property_id) DO UPDATE SET value = excluded.value`,
    );
    const tx = this.db.transaction(() => {
      for (const { key, value } of validated) {
        upsert.run(rowId, key, JSON.stringify(value));
      }
    });
    tx();
  }

  /**
   * Scrub a now-removed option id from every stored value of `propertyId`:
   * select values equal to it become null; multiSelect arrays have it
   * filtered out. Other property types have no options and are unaffected.
   */
  private scrubOption(
    propertyId: string,
    type: PropertyType,
    optionId: string,
  ): void {
    if (type !== "select" && type !== "multiSelect") return;
    const rows = this.db
      .prepare("SELECT row_id, value FROM row_values WHERE property_id = ?")
      .all(propertyId) as RowValueRow[];
    const update = this.db.prepare(
      "UPDATE row_values SET value = ? WHERE row_id = ? AND property_id = ?",
    );
    for (const r of rows) {
      let v: unknown;
      try {
        v = JSON.parse(r.value);
      } catch {
        continue;
      }
      if (type === "select") {
        if (v === optionId) {
          update.run("null", r.row_id, propertyId);
        }
      } else {
        if (Array.isArray(v)) {
          const filtered = v.filter((x) => x !== optionId);
          update.run(JSON.stringify(filtered), r.row_id, propertyId);
        }
      }
    }
  }

  /** Load values for the given row ids, grouped by row then property. */
  private loadValues(
    rowIds: string[],
  ): Map<string, Map<string, unknown>> {
    const out = new Map<string, Map<string, unknown>>();
    if (rowIds.length === 0) return out;
    const placeholders = rowIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT row_id, property_id, value FROM row_values
         WHERE row_id IN (${placeholders})`,
      )
      .all(...rowIds) as RowValueRow[];
    for (const r of rows) {
      let v: unknown = null;
      try {
        v = JSON.parse(r.value);
      } catch {
        v = null;
      }
      let m = out.get(r.row_id);
      if (!m) {
        m = new Map();
        out.set(r.row_id, m);
      }
      m.set(r.property_id, v);
    }
    return out;
  }

  /** Build a Row JSON from a page and its parsed values map. */
  private buildRow(page: Page, values: Map<string, unknown>): Row {
    return {
      id: page.id,
      databaseId: page.parentId ?? "",
      title: page.title,
      values: Object.fromEntries(values),
      position: page.position,
    };
  }
}

/** Validate and normalize a full options-replacement payload. */
function buildOptions(raw: unknown): PropertyOption[] {
  if (!Array.isArray(raw)) {
    throw new DatabaseError("options must be an array", 400);
  }
  return raw.map(normalizeOption);
}

/**
 * Return a scrubbed JSON string for a view_settings `settings` blob with every
 * reference to `propertyId` removed, or null when the blob does not change (so
 * the caller can skip a pointless UPDATE). Used by DatabaseRepository.
 * removeProperty to keep stored view settings free of stale property ids
 * (DEF-012). Unparseable or non-object blobs are left untouched (return null);
 * they are already coerced back to defaults on GET by the views layer.
 *
 *   filters    -> entries whose propertyId === propertyId are dropped
 *   sort       -> set to null when it points at propertyId
 *   groupBy    -> set to null when it equals propertyId
 *   listProps  -> entries equal to propertyId are pruned
 */
export function scrubPropertyFromSettings(
  settingsJson: string,
  propertyId: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  let changed = false;

  if (Array.isArray(o.filters)) {
    const kept = o.filters.filter((f) => {
      if (f && typeof f === "object" && !Array.isArray(f)) {
        return (f as Record<string, unknown>).propertyId !== propertyId;
      }
      return true;
    });
    if (kept.length !== o.filters.length) {
      o.filters = kept;
      changed = true;
    }
  }

  if (
    o.sort &&
    typeof o.sort === "object" &&
    !Array.isArray(o.sort) &&
    (o.sort as Record<string, unknown>).propertyId === propertyId
  ) {
    o.sort = null;
    changed = true;
  }

  if (o.groupBy === propertyId) {
    o.groupBy = null;
    changed = true;
  }

  if (Array.isArray(o.listProps)) {
    const kept = o.listProps.filter((p) => p !== propertyId);
    if (kept.length !== o.listProps.length) {
      o.listProps = kept;
      changed = true;
    }
  }

  return changed ? JSON.stringify(o) : null;
}
