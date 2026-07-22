// Pure helpers for view logic (filters, sort, board grouping).
// Kept side-effect-free so they are easy to unit-test in isolation
// and so the view components stay focused on layout.

import type {
  DatabaseFilter,
  DatabaseSort,
  Property,
  PropertyOption,
  RowPage,
} from '../lib/api';

/** The special propertyId that means "row title" in sort. */
export const TITLE_PROPERTY_ID = 'title';

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** Read a row's value for the named property. Returns null for missing
 *  or unset values. */
export function getRowValue(
  row: RowPage,
  propertyId: string
): unknown {
  const v = (row.values ?? {})[propertyId];
  return v === undefined ? null : v;
}

/** Case-insensitive trim of a string for matching. */
function norm(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

/** Resolves the option label for a stored value of a select/multi_select
 *  property. Returns null for missing options. */
function labelFor(
  property: Property,
  id: string | null | undefined
): string | null {
  if (!id || !property.options) return null;
  const opt = property.options.find((o: PropertyOption) => o.id === id);
  return opt ? opt.label : null;
}

/** Resolves a target string (from a filter's value) into a comparable
 *  label. Accepts either a label (e.g. "Reading") or an option id
 *  (e.g. "opt-abc"); returns the lowercased label when an id matches,
 *  or the lowercased input otherwise. */
function resolveFilterTarget(property: Property, targetRaw: string): string {
  const opt = (property.options ?? []).find(
    (o: PropertyOption) => o.id === targetRaw
  );
  return norm(opt ? opt.label : targetRaw);
}

/** True when a stored label matches a filter target. The target may
 *  be either a label or an option id. */
function labelMatches(
  storedLabel: string,
  filterTargetRaw: string,
  property: Property
): boolean {
  const normStored = norm(storedLabel);
  if (norm(storedLabel) === norm(filterTargetRaw)) return true;
  return normStored === resolveFilterTarget(property, filterTargetRaw);
}

/** Resolves a multi_select value to its labels (one per option id). */
function multiSelectLabels(property: Property, value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string') continue;
    const lbl = labelFor(property, id);
    if (lbl) out.push(lbl);
  }
  return out;
}

/** Resolves a single value for a property to a comparable string used by
 *  filter matching. Returns null for unset values. */
function valueToMatchString(
  property: Property,
  value: unknown
): string | null {
  if (value === null || value === undefined) return null;
  switch (property.type) {
    case 'text':
    case 'url':
    case 'date':
      return typeof value === 'string' ? value : null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : null;
    case 'select':
      return typeof value === 'string'
        ? labelFor(property, value) ?? value
        : null;
    case 'multi_select': {
      if (!Array.isArray(value)) return null;
      const labels = value
        .map((id) =>
          typeof id === 'string' ? labelFor(property, id) ?? id : null
        )
        .filter((s): s is string => typeof s === 'string');
      return labels.join('|');
    }
    case 'checkbox':
      return value === true ? 'true' : 'false';
    default:
      return null;
  }
}

/** Evaluates one filter against a row. Unmatched / unknown filters do NOT
 *  drop the row (so a stale filter does not silently hide everything). */
export function matchesFilter(
  row: RowPage,
  filter: DatabaseFilter,
  properties: Property[]
): boolean {
  const property = properties.find((p) => p.id === filter.propertyId);
  if (!property) {
    // Unknown property: treat as no-op (don't drop the row).
    return true;
  }
  const value = getRowValue(row, property.id);
  const target = norm(
    filter.value == null ? null : String(filter.value)
  );
  const filterTargetRaw =
    filter.value == null ? '' : String(filter.value);
  switch (filter.op) {
    case 'contains': {
      if (property.type !== 'text' && property.type !== 'url') return true;
      const haystack = norm(valueToMatchString(property, value));
      if (target === '') return !isEmptyValue(value);
      return haystack.includes(target);
    }
    case 'is': {
      if (property.type === 'select') {
        const stored = valueToMatchString(property, value);
        if (stored == null) return target === '';
        return labelMatches(stored, filterTargetRaw, property);
      }
      if (property.type === 'multi_select') {
        // multi_select "is" means the option is among the row's selections.
        if (target === '') {
          return value === null || (Array.isArray(value) && value.length === 0);
        }
        const labels = multiSelectLabels(property, value);
        return labels.some((l) => labelMatches(l, filterTargetRaw, property));
      }
      return true;
    }
    case 'is_not': {
      if (property.type === 'select') {
        const stored = valueToMatchString(property, value);
        if (stored == null) return target !== '';
        return !labelMatches(stored, filterTargetRaw, property);
      }
      if (property.type === 'multi_select') {
        if (target === '') {
          return !(value === null || (Array.isArray(value) && value.length === 0));
        }
        const labels = multiSelectLabels(property, value);
        return !labels.some((l) => labelMatches(l, filterTargetRaw, property));
      }
      return true;
    }
    case 'is_checked':
      return property.type === 'checkbox' ? value === true : true;
    case 'is_not_checked':
      return property.type === 'checkbox' ? value !== true : true;
    case 'before': {
      if (property.type !== 'date') return true;
      const stored = valueToMatchString(property, value);
      if (stored == null) return false;
      if (target === '') return false;
      return stored < target;
    }
    case 'after': {
      if (property.type !== 'date') return true;
      const stored = valueToMatchString(property, value);
      if (stored == null) return false;
      if (target === '') return false;
      return stored > target;
    }
    default:
      return true;
  }
}

/** Apply a list of filters with AND semantics. An empty filter list is a
 *  no-op. Unknown property ids inside a filter are ignored (do not drop
 *  rows). */
export function applyFilters(
  rows: RowPage[],
  filters: DatabaseFilter[] | undefined,
  properties: Property[]
): RowPage[] {
  if (!filters || filters.length === 0) return rows;
  return rows.filter((row) =>
    filters.every((f) => matchesFilter(row, f, properties))
  );
}

/** Compares two strings as nulls-last in both directions. */
function compareNullsLast(
  a: string | null,
  b: string | null,
  direction: 'asc' | 'desc'
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls last
  if (b === null) return -1;
  const cmp = a.localeCompare(b);
  return direction === 'asc' ? cmp : -cmp;
}

/** Compares two booleans as nulls-last in both directions.
 *  false < true in ascending order. */
function compareBooleansNullsLast(
  a: boolean | null,
  b: boolean | null,
  direction: 'asc' | 'desc'
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const av = a ? 1 : 0;
  const bv = b ? 1 : 0;
  if (av === bv) return 0;
  const cmp = av < bv ? -1 : 1;
  return direction === 'asc' ? cmp : -cmp;
}

/** Compares two numbers as nulls-last in both directions. */
function compareNumbersNullsLast(
  a: number | null,
  b: number | null,
  direction: 'asc' | 'desc'
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = a < b ? -1 : a > b ? 1 : 0;
  return direction === 'asc' ? cmp : -cmp;
}

/** Builds a comparator for a single property. Returns null when the
 *  property is unknown so the caller can fall back to title. */
function comparatorFor(
  property: Property | undefined,
  direction: 'asc' | 'desc'
): (a: RowPage, b: RowPage) => number {
  return (a: RowPage, b: RowPage) => {
    if (!property) {
      return compareNullsLast(a.title ?? null, b.title ?? null, direction);
    }
    const av = getRowValue(a, property.id);
    const bv = getRowValue(b, property.id);
    switch (property.type) {
      case 'text':
      case 'url':
        return compareNullsLast(
          typeof av === 'string' ? av : null,
          typeof bv === 'string' ? bv : null,
          direction
        );
      case 'date':
        return compareNullsLast(
          typeof av === 'string' ? av : null,
          typeof bv === 'string' ? bv : null,
          direction
        );
      case 'number':
        return compareNumbersNullsLast(
          typeof av === 'number' && Number.isFinite(av) ? av : null,
          typeof bv === 'number' && Number.isFinite(bv) ? bv : null,
          direction
        );
      case 'checkbox':
        return compareBooleansNullsLast(
          typeof av === 'boolean' ? av : null,
          typeof bv === 'boolean' ? bv : null,
          direction
        );
      case 'select': {
        const aLabel = av == null ? null : labelFor(property, String(av));
        const bLabel = bv == null ? null : labelFor(property, String(bv));
        return compareNullsLast(aLabel, bLabel, direction);
      }
      case 'multi_select': {
        // Sort by the first label (or empty string) for stability.
        const aFirst = Array.isArray(av)
          ? labelFor(property, String(av[0] ?? '')) ?? ''
          : '';
        const bFirst = Array.isArray(bv)
          ? labelFor(property, String(bv[0] ?? '')) ?? ''
          : '';
        return compareNullsLast(aFirst || null, bFirst || null, direction);
      }
      default:
        return 0;
    }
  };
}

/** Applies a sort to a copy of the rows. Null sort is a no-op. The
 *  special propertyId 'title' sorts by row title. Unknown property ids
 *  fall back to row title so the view still has a stable order. */
export function applySort(
  rows: RowPage[],
  sort: DatabaseSort | null | undefined,
  properties: Property[]
): RowPage[] {
  if (!sort) return rows;
  const direction = sort.direction;
  if (sort.propertyId === TITLE_PROPERTY_ID) {
    return [...rows].sort((a, b) =>
      compareNullsLast(a.title ?? null, b.title ?? null, direction)
    );
  }
  const property = properties.find((p) => p.id === sort.propertyId);
  return [...rows].sort(comparatorFor(property, direction));
}

export interface BoardColumn {
  /** The option id, or null for the "No value" bucket. */
  optionId: string | null;
  /** Display label. */
  label: string;
  /** The option's color, or null for the No value bucket. */
  color: string | null;
  /** The rows that belong in this column, in the same order they came in. */
  rows: RowPage[];
}

/** Builds board columns from the option list of a property. The "No value"
 *  bucket (optionId = null) is always present and listed first. Columns
 *  are returned in option order. Empty option lists produce a single
 *  "No value" column. */
export function groupRowsByProperty(
  rows: RowPage[],
  property: Property | null
): BoardColumn[] {
  const noValue: RowPage[] = [];
  if (!property) {
    return [{ optionId: null, label: 'No value', color: null, rows: [...rows] }];
  }
  const byOption = new Map<string, RowPage[]>();
  for (const opt of property.options ?? []) {
    byOption.set(opt.id, []);
  }
  for (const row of rows) {
    const v = getRowValue(row, property.id);
    if (v == null) {
      noValue.push(row);
      continue;
    }
    if (property.type === 'select' && typeof v === 'string') {
      const bucket = byOption.get(v);
      if (bucket) bucket.push(row);
      else noValue.push(row);
    } else if (property.type === 'multi_select' && Array.isArray(v)) {
      // Multi-select rows are not assigned to one column. They land in
      // "No value" so the board view stays simple and unambiguous.
      noValue.push(row);
    } else {
      noValue.push(row);
    }
  }
  const cols: BoardColumn[] = [];
  for (const opt of property.options ?? []) {
    cols.push({
      optionId: opt.id,
      label: opt.label,
      color: opt.color,
      rows: byOption.get(opt.id) ?? [],
    });
  }
  // No-value bucket comes first.
  cols.unshift({ optionId: null, label: 'No value', color: null, rows: noValue });
  return cols;
}

/** Returns the list of filter ops that are valid for a given property
 *  type. Used by the filter builder. */
export function opsForType(
  type: Property['type']
): DatabaseFilter['op'][] {
  switch (type) {
    case 'text':
    case 'url':
      return ['contains'];
    case 'select':
    case 'multi_select':
      return ['is', 'is_not'];
    case 'date':
      return ['before', 'after'];
    case 'checkbox':
      return ['is_checked', 'is_not_checked'];
    case 'number':
      return []; // number is not filterable per spec
    default:
      return [];
  }
}

/** Returns the default empty filter for a given property type. */
export function emptyFilterFor(property: Property): DatabaseFilter {
  const ops = opsForType(property.type);
  const op = ops[0] ?? 'contains';
  return {
    propertyId: property.id,
    op,
    value: op === 'is_checked' || op === 'is_not_checked' ? null : '',
  };
}
