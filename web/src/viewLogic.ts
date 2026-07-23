// Pure view logic for the Phase 4 database views.
//
// All filtering, sorting and grouping is done in this file so the unit
// tests can exercise it without rendering anything. The functions are
// small, total (no throws on bad input — they coerce / skip), and pure.
//
// Conventions:
//   - A "filter" is `{ id, propertyId, op, value? }`. We ignore filters
//     whose `propertyId` is unknown.
//   - "nulls last" means: when sorting, rows whose key is null/undefined
//     are pushed to the bottom in BOTH ascending and descending order.
//   - "option order" for select/multiSelect comes from the property's
//     `options` array, in array order, before falling back to label
//     comparison.

import type {
  CellValue,
  Property,
  PropertyOption,
  Row,
} from "./types";

// ---- Filter and sort shapes (mirrors the backend contract) ----

export type FilterOp =
  | "contains"
  | "not-contains"
  | "eq"
  | "gt"
  | "lt"
  | "is"
  | "is-not"
  | "before"
  | "after";

export interface Filter {
  id: string;
  propertyId: string;
  op: FilterOp;
  value?: CellValue;
}

export type SortDirection = "asc" | "desc";

export interface Sort {
  propertyId: string;
  direction: SortDirection;
}

/**
 * Settings for a single database view. The backend persists three of
 * these per database — `table`, `board`, `list` — and an `activeView`
 * pointing at one of them. See the task contract.
 */
export interface ViewSettings {
  filters: Filter[];
  sort: Sort | null;
  groupBy: string | null;
  listProps: string[];
}

export type ViewKind = "table" | "board" | "list";

export interface DatabaseViews {
  activeView: ViewKind;
  table: ViewSettings;
  board: ViewSettings;
  list: ViewSettings;
}

export function emptyViewSettings(): ViewSettings {
  return {
    filters: [],
    sort: null,
    groupBy: null,
    listProps: [],
  };
}

export function emptyDatabaseViews(): DatabaseViews {
  return {
    activeView: "table",
    table: emptyViewSettings(),
    board: emptyViewSettings(),
    list: emptyViewSettings(),
  };
}

// ---- Filter ops per type ----
//
// Returns the list of ops that make sense for a given property type.
// Used by the filter bar's op picker so we don't offer e.g. "gt" on
// a text property.
export function opsForType(type: Property["type"]): FilterOp[] {
  switch (type) {
    case "text":
    case "url":
      return ["contains", "not-contains"];
    case "number":
      return ["eq", "gt", "lt"];
    case "select":
      return ["is", "is-not"];
    case "multiSelect":
      return ["contains", "not-contains"];
    case "checkbox":
      return ["is"];
    case "date":
      return ["before", "after"];
  }
}

// ---- applyFilters ----
//
// AND-combined: a row is kept only if it matches every active filter.
// Rows whose filter property is missing or has an unknown propertyId are
// dropped. Bad values never throw; missing keys are coerced to null.
export function applyFilters(
  rows: Row[],
  filters: Filter[],
  properties: Property[],
): Row[] {
  if (filters.length === 0) return rows.slice();
  const propMap = new Map(properties.map((p) => [p.id, p]));
  const compiled = filters
    .map((f) => ({ filter: f, prop: propMap.get(f.propertyId) }))
    .filter((c) => c.prop !== undefined) as {
    filter: Filter;
    prop: Property;
  }[];
  if (compiled.length === 0) return rows.slice();
  return rows.filter((r) =>
    compiled.every(({ filter, prop }) => matches(r, prop, filter)),
  );
}

function matches(row: Row, prop: Property, filter: Filter): boolean {
  const cell = row.values[prop.id] ?? null;
  switch (prop.type) {
    case "text":
    case "url": {
      const str = typeof cell === "string" ? cell : "";
      const needle =
        typeof filter.value === "string" ? filter.value.toLowerCase() : "";
      if (filter.op === "contains") return str.toLowerCase().includes(needle);
      if (filter.op === "not-contains")
        return !str.toLowerCase().includes(needle);
      return false;
    }
    case "number": {
      const n = typeof cell === "number" ? cell : NaN;
      const v =
        typeof filter.value === "number"
          ? filter.value
          : Number(filter.value);
      if (filter.op === "eq") return Number.isFinite(n) && n === v;
      if (filter.op === "gt") return Number.isFinite(n) && n > v;
      if (filter.op === "lt") return Number.isFinite(n) && n < v;
      return false;
    }
    case "select": {
      const v = typeof cell === "string" ? cell : null;
      const target =
        typeof filter.value === "string" ? filter.value : null;
      if (filter.op === "is") return v === target;
      if (filter.op === "is-not") return v !== target;
      return false;
    }
    case "multiSelect": {
      const ids = Array.isArray(cell) ? (cell as string[]) : [];
      const target =
        typeof filter.value === "string" ? filter.value : null;
      if (filter.op === "contains") return target !== null && ids.includes(target);
      if (filter.op === "not-contains")
        return target !== null && !ids.includes(target);
      return false;
    }
    case "checkbox": {
      const b = cell === true;
      if (filter.op === "is") {
        // Coerce filter value to boolean.
        const want =
          filter.value === true ||
          filter.value === "true" ||
          filter.value === 1 ||
          filter.value === "1";
        return b === want;
      }
      return false;
    }
    case "date": {
      // Coerce cell to YYYY-MM-DD comparison.
      const cellStr = typeof cell === "string" ? cell : "";
      const valStr = typeof filter.value === "string" ? filter.value : "";
      if (!cellStr || !valStr) return false;
      // Use string compare: ISO date strings sort lexicographically.
      if (filter.op === "before") return cellStr < valStr;
      if (filter.op === "after") return cellStr > valStr;
      return false;
    }
  }
}

// ---- sortRows ----
//
// Type-aware comparator with nulls-last in BOTH directions:
//   - text/url: localeCompare
//   - number: numeric
//   - date: lexicographic on YYYY-MM-DD (which sorts correctly)
//   - select: option order, fallback to label
//   - multiSelect: counts (longer first when ascending, then 0/null last)
//   - checkbox: false < true
//
// The sort is stable (Array#sort is stable in modern engines).
export function sortRows(
  rows: Row[],
  sort: Sort | null,
  properties: Property[],
): Row[] {
  if (!sort) return rows.slice();
  const prop = properties.find((p) => p.id === sort.propertyId);
  if (!prop) return rows.slice();
  const dir = sort.direction === "desc" ? -1 : 1;
  const optionIndex = new Map<string, number>();
  for (let i = 0; i < prop.options.length; i++) {
    optionIndex.set(prop.options[i].id, i);
  }
  const out = rows.slice();
  out.sort((a, b) => compareOne(a, b, prop, optionIndex, dir));
  return out;
}

function isNullish(v: CellValue): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v === "") return true;
  if (typeof v === "number" && Number.isNaN(v)) return true;
  return false;
}

function compareOne(
  a: Row,
  b: Row,
  prop: Property,
  optionIndex: Map<string, number>,
  dir: 1 | -1,
): number {
  const av = a.values[prop.id] ?? null;
  const bv = b.values[prop.id] ?? null;
  // Nulls last in BOTH directions.
  const an = isNullish(av);
  const bn = isNullish(bv);
  if (an && bn) return 0;
  if (an) return 1; // a goes after b
  if (bn) return -1;
  let cmp = 0;
  switch (prop.type) {
    case "text":
    case "url":
      cmp = String(av).localeCompare(String(bv));
      break;
    case "number": {
      const an = typeof av === "number" ? av : NaN;
      const bn = typeof bv === "number" ? bv : NaN;
      if (Number.isFinite(an) && Number.isFinite(bn)) {
        cmp = an < bn ? -1 : an > bn ? 1 : 0;
      } else if (Number.isFinite(an)) {
        cmp = -1;
      } else if (Number.isFinite(bn)) {
        cmp = 1;
      }
      break;
    }
    case "date":
      cmp = String(av).localeCompare(String(bv));
      break;
    case "select": {
      const ai = optionIndex.get(String(av));
      const bi = optionIndex.get(String(bv));
      if (ai !== undefined && bi !== undefined) {
        cmp = ai < bi ? -1 : ai > bi ? 1 : 0;
      } else if (ai !== undefined) {
        cmp = -1;
      } else if (bi !== undefined) {
        cmp = 1;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      break;
    }
    case "multiSelect": {
      const aLen = Array.isArray(av) ? (av as string[]).length : 0;
      const bLen = Array.isArray(bv) ? (bv as string[]).length : 0;
      cmp = aLen < bLen ? -1 : aLen > bLen ? 1 : 0;
      break;
    }
    case "checkbox":
      // false < true
      cmp = av === bv ? 0 : av === true ? 1 : -1;
      break;
  }
  if (cmp === 0) {
    // Stable tiebreaker: preserve row position so users see rows in the
    // order they were authored when values tie.
    return a.position - b.position;
  }
  return cmp * dir;
}

// ---- groupRows ----
//
// Returns columns in option order. The last column is "No value" if and
// only if the input has at least one row whose cell is null. (We always
// show "No value" if any row lacks a value; if none, we omit it.)
export interface BoardColumn {
  /** Stable id used as React key and dnd-kit droppable id. */
  key: string;
  /** Display label for the header chip. */
  label: string;
  /** null when this is the "No value" bucket. */
  option: PropertyOption | null;
  rows: Row[];
}

export function groupRows(
  rows: Row[],
  properties: Property[],
  groupBy: string | null,
): BoardColumn[] {
  if (!groupBy) {
    return [{ key: "__all__", label: "All", option: null, rows: rows.slice() }];
  }
  const prop = properties.find((p) => p.id === groupBy);
  if (!prop || (prop.type !== "select" && prop.type !== "multiSelect")) {
    // Fall back to a single column; the UI surfaces this state separately.
    return [{ key: "__all__", label: "All", option: null, rows: rows.slice() }];
  }
  const optionMap = new Map(prop.options.map((o, i) => [o.id, { o, i }]));
  const buckets = new Map<string, Row[]>();
  const noValue: Row[] = [];
  for (const r of rows) {
    const v = r.values[groupBy];
    if (prop.type === "select") {
      const sid = typeof v === "string" ? v : null;
      if (sid && optionMap.has(sid)) {
        const arr = buckets.get(sid) ?? [];
        arr.push(r);
        buckets.set(sid, arr);
      } else {
        noValue.push(r);
      }
    } else {
      // multiSelect: place the row in each selected option's bucket.
      const ids = Array.isArray(v) ? (v as string[]) : [];
      const placed = new Set<string>();
      for (const id of ids) {
        if (optionMap.has(id) && !placed.has(id)) {
          const arr = buckets.get(id) ?? [];
          arr.push(r);
          buckets.set(id, arr);
          placed.add(id);
        }
      }
      if (placed.size === 0) noValue.push(r);
    }
  }
  const columns: BoardColumn[] = prop.options.map((opt) => ({
    key: opt.id,
    label: opt.label,
    option: opt,
    rows: buckets.get(opt.id) ?? [],
  }));
  if (noValue.length > 0) {
    columns.push({
      key: "__none__",
      label: "No value",
      option: null,
      rows: noValue,
    });
  }
  return columns;
}

// ---- visibleRows ----
//
// Filters, then sorts. The board and list both consume this; the table
// does too (per task spec). Stable, pure.
export function visibleRows(
  rows: Row[],
  settings: ViewSettings,
  properties: Property[],
): Row[] {
  const filtered = applyFilters(rows, settings.filters, properties);
  return sortRows(filtered, settings.sort, properties);
}

// ---- Display helpers used by the board and list views ----

/**
 * Renders a cell value as a short, plain string suitable for list / card
 * subtitles. Returns null when the cell is empty (so the caller can
 * suppress the chip). Multi-select values are joined with " · ".
 */
export function renderCellValue(
  prop: Property,
  value: CellValue,
): { text: string; isEmpty: boolean; kind: "chip" | "date" | "check" | "text" } | null {
  if (value === null || value === undefined) return null;
  switch (prop.type) {
    case "text":
    case "url": {
      const s = typeof value === "string" ? value : String(value);
      if (!s) return null;
      return { text: s, isEmpty: false, kind: "text" };
    }
    case "number": {
      const n = typeof value === "number" ? value : NaN;
      if (!Number.isFinite(n)) return null;
      return { text: String(n), isEmpty: false, kind: "text" };
    }
    case "checkbox":
      return value === true
        ? { text: "Yes", isEmpty: false, kind: "check" }
        : null;
    case "date": {
      if (typeof value !== "string" || !value) return null;
      return { text: formatDate(value), isEmpty: false, kind: "date" };
    }
    case "select": {
      if (typeof value !== "string") return null;
      const opt = prop.options.find((o) => o.id === value);
      if (!opt) return null;
      return { text: opt.label, isEmpty: false, kind: "chip" };
    }
    case "multiSelect": {
      if (!Array.isArray(value) || value.length === 0) return null;
      const labels = value
        .map((id) => prop.options.find((o) => o.id === id)?.label)
        .filter((s): s is string => !!s);
      if (labels.length === 0) return null;
      return { text: labels.join(" · "), isEmpty: false, kind: "chip" };
    }
  }
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

/**
 * Returns the option referenced by a row's value for a given property,
 * or null if the value is unset / the option isn't found. Used by the
 * board's card coloring and the list's chips.
 */
export function optionForCell(
  prop: Property,
  value: CellValue,
): PropertyOption | null {
  if (prop.type !== "select") return null;
  if (typeof value !== "string") return null;
  return prop.options.find((o) => o.id === value) ?? null;
}

/**
 * The select properties of a database — the ones the board can group
 * by. Returns them in property position order.
 */
export function selectProperties(properties: Property[]): Property[] {
  return properties
    .filter((p) => p.type === "select" || p.type === "multiSelect")
    .sort((a, b) => a.position - b.position);
}

/**
 * Pick a sensible default for `listProps` when the user has never set
 * them: prefer non-title select / multiSelect / date properties, falling
 * back to the first two non-title properties. Returns property ids.
 */
export function defaultListProps(properties: Property[]): string[] {
  const sorted = properties.slice().sort((a, b) => a.position - b.position);
  const preferred = sorted.filter(
    (p) =>
      p.type === "select" ||
      p.type === "multiSelect" ||
      p.type === "date" ||
      p.type === "url",
  );
  const pick = preferred.length >= 2 ? preferred.slice(0, 2) : preferred.length === 1 ? preferred : sorted.slice(0, 2);
  return pick.map((p) => p.id);
}
