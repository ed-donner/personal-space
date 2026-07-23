// Unit tests for viewLogic. These cover every filter op per type, sort
// nulls-last + direction, group option order, and the few display
// helpers used by the board and list views.

import { describe, expect, it } from "vitest";
import {
  applyFilters,
  defaultListProps,
  emptyDatabaseViews,
  emptyViewSettings,
  groupRows,
  optionForCell,
  opsForType,
  renderCellValue,
  selectProperties,
  sortRows,
  visibleRows,
  type Filter,
} from "./viewLogic";
import type { Property, PropertyOption, Row } from "./types";

function opt(
  id: string,
  label: string,
  color: PropertyOption["color"] = "gray",
): PropertyOption {
  return { id, label, color };
}

function prop(
  id: string,
  type: Property["type"],
  options: PropertyOption[] = [],
  position = 0,
): Property {
  return { id, databaseId: "db", name: id, type, options, position };
}

function row(
  id: string,
  values: Record<string, unknown>,
  position = 0,
): Row {
  return { id, databaseId: "db", title: id, values: values as Row["values"], position };
}

// Properties reused across many tests.
const statusProp = prop("status", "select", [
  opt("todo", "To read"),
  opt("reading", "Reading", "amber"),
  opt("done", "Done", "green"),
]);
const tagsProp = prop("tags", "multiSelect", [
  opt("fiction", "Fiction", "blue"),
  opt("nonfic", "Non-fiction", "purple"),
]);
const authorProp = prop("author", "text");
const pagesProp = prop("pages", "number");
const startedProp = prop("started", "date");
const finishedProp = prop("finished", "checkbox");
const linkProp = prop("link", "url");

const props: Property[] = [
  statusProp,
  tagsProp,
  authorProp,
  pagesProp,
  startedProp,
  finishedProp,
  linkProp,
];

const rows: Row[] = [
  row("a", { status: "reading", tags: ["fiction"], author: "Adams", pages: 320, started: "2025-01-10", finished: false, link: "https://a.example" }, 0),
  row("b", { status: "done", tags: ["nonfic"], author: "Brown", pages: 240, started: "2024-12-01", finished: true, link: "https://b.example" }, 1),
  row("c", { status: "todo", tags: [], author: "", pages: NaN as unknown as number, started: "", finished: false, link: "" }, 2),
  row("d", { status: null, tags: ["fiction", "nonfic"], author: null, pages: 100, started: "2025-02-15", finished: true, link: "not-a-url" }, 3),
];

describe("opsForType", () => {
  it("returns the expected ops per property type", () => {
    expect(opsForType("text")).toEqual(["contains", "not-contains"]);
    expect(opsForType("url")).toEqual(["contains", "not-contains"]);
    expect(opsForType("number")).toEqual(["eq", "gt", "lt"]);
    expect(opsForType("select")).toEqual(["is", "is-not"]);
    expect(opsForType("multiSelect")).toEqual(["contains", "not-contains"]);
    expect(opsForType("checkbox")).toEqual(["is"]);
    expect(opsForType("date")).toEqual(["before", "after"]);
  });
});

describe("applyFilters", () => {
  it("returns all rows when there are no filters", () => {
    expect(applyFilters(rows, [], props)).toEqual(rows);
  });

  it("ignores filters that reference an unknown property", () => {
    const f: Filter = { id: "x", propertyId: "missing", op: "contains", value: "anything" };
    expect(applyFilters(rows, [f], props)).toEqual(rows);
  });

  it("AND-combines multiple filters", () => {
    const f: Filter[] = [
      { id: "1", propertyId: "status", op: "is", value: "done" },
      { id: "2", propertyId: "finished", op: "is", value: true },
    ];
    const out = applyFilters(rows, f, props);
    expect(out.map((r) => r.id)).toEqual(["b"]);
  });

  // ---- text ----
  it("text contains is case-insensitive", () => {
    const f: Filter = { id: "t", propertyId: "author", op: "contains", value: "ADAMS" };
    expect(applyFilters(rows, [f], props).map((r) => r.id)).toEqual(["a"]);
  });
  it("text not-contains", () => {
    const f: Filter = { id: "t", propertyId: "author", op: "not-contains", value: "brown" };
    expect(applyFilters(rows, [f], props).map((r) => r.id)).toEqual(["a", "c", "d"]);
  });

  // ---- url ----
  it("url contains matches against the URL string", () => {
    const f: Filter = { id: "u", propertyId: "link", op: "contains", value: "b.example" };
    expect(applyFilters(rows, [f], props).map((r) => r.id)).toEqual(["b"]);
  });

  // ---- number ----
  it("number eq, gt, lt", () => {
    const fEq: Filter = { id: "n", propertyId: "pages", op: "eq", value: 100 };
    expect(applyFilters(rows, [fEq], props).map((r) => r.id)).toEqual(["d"]);
    const fGt: Filter = { id: "n", propertyId: "pages", op: "gt", value: 200 };
    expect(applyFilters(rows, [fGt], props).map((r) => r.id)).toEqual(["a", "b"]);
    const fLt: Filter = { id: "n", propertyId: "pages", op: "lt", value: 200 };
    expect(applyFilters(rows, [fLt], props).map((r) => r.id)).toEqual(["d"]);
  });
  it("number filter tolerates NaN-ish junk without throwing", () => {
    const f: Filter = { id: "n", propertyId: "pages", op: "eq", value: NaN };
    // No row has a NaN pages value; should not throw, returns the row whose
    // pages equals itself when parsed, or none.
    expect(() => applyFilters(rows, [f], props)).not.toThrow();
  });

  // ---- select ----
  it("select is / is-not", () => {
    const fIs: Filter = { id: "s", propertyId: "status", op: "is", value: "reading" };
    expect(applyFilters(rows, [fIs], props).map((r) => r.id)).toEqual(["a"]);
    const fIsNot: Filter = { id: "s", propertyId: "status", op: "is-not", value: "done" };
    expect(applyFilters(rows, [fIsNot], props).map((r) => r.id)).toEqual(["a", "c", "d"]);
  });

  // ---- multiSelect ----
  it("multiSelect contains / not-contains", () => {
    const fC: Filter = { id: "m", propertyId: "tags", op: "contains", value: "fiction" };
    expect(applyFilters(rows, [fC], props).map((r) => r.id)).toEqual(["a", "d"]);
    const fN: Filter = { id: "m", propertyId: "tags", op: "not-contains", value: "fiction" };
    expect(applyFilters(rows, [fN], props).map((r) => r.id)).toEqual(["b", "c"]);
  });

  // ---- checkbox ----
  it("checkbox is true / false", () => {
    const fT: Filter = { id: "c", propertyId: "finished", op: "is", value: true };
    expect(applyFilters(rows, [fT], props).map((r) => r.id)).toEqual(["b", "d"]);
    const fF: Filter = { id: "c", propertyId: "finished", op: "is", value: false };
    expect(applyFilters(rows, [fF], props).map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("checkbox coerces string 'true' to true", () => {
    const fT: Filter = { id: "c", propertyId: "finished", op: "is", value: "true" };
    expect(applyFilters(rows, [fT], props).map((r) => r.id)).toEqual(["b", "d"]);
  });

  // ---- date ----
  it("date before / after boundary days", () => {
    const fBefore: Filter = { id: "d", propertyId: "started", op: "before", value: "2025-01-10" };
    expect(applyFilters(rows, [fBefore], props).map((r) => r.id)).toEqual(["b"]);
    const fAfter: Filter = { id: "d", propertyId: "started", op: "after", value: "2025-01-10" };
    expect(applyFilters(rows, [fAfter], props).map((r) => r.id)).toEqual(["d"]);
    // The boundary day itself is excluded by both "before" and "after".
    const fAt: Filter = { id: "d", propertyId: "started", op: "after", value: "2025-01-10" };
    expect(applyFilters(rows, [fAt], props).map((r) => r.id)).not.toContain("a");
  });
  it("date filter ignores empty strings", () => {
    const f: Filter = { id: "d", propertyId: "started", op: "before", value: "2025-12-31" };
    // Row c has empty string; should not be included.
    expect(applyFilters(rows, [f], props).map((r) => r.id)).not.toContain("c");
  });
});

describe("sortRows", () => {
  it("returns the input when sort is null", () => {
    expect(sortRows(rows, null, props)).toEqual(rows);
  });
  it("ignores unknown property ids", () => {
    expect(sortRows(rows, { propertyId: "missing", direction: "asc" }, props)).toEqual(rows);
  });

  it("text sorts with localeCompare ascending", () => {
    const out = sortRows(rows, { propertyId: "author", direction: "asc" }, props);
    // nulls/empty last regardless of direction
    expect(out.map((r) => r.id).slice(0, 2)).toEqual(["a", "b"]);
    expect(out[out.length - 1].id).toMatch(/c|d/);
  });
  it("text sorts descending", () => {
    const out = sortRows(rows, { propertyId: "author", direction: "desc" }, props);
    expect(out[0].id).toMatch(/a|b/);
    expect(out[out.length - 1].id).toMatch(/c|d/); // nulls last
  });

  it("number sorts numerically", () => {
    const out = sortRows(rows, { propertyId: "pages", direction: "asc" }, props);
    // First non-null: d (100), b (240), a (320), then NaN last.
    expect(out.map((r) => r.id)).toEqual(["d", "b", "a", "c"]);
  });
  it("number sorts numerically descending with NaN last", () => {
    const out = sortRows(rows, { propertyId: "pages", direction: "desc" }, props);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("date sorts lexicographically on YYYY-MM-DD", () => {
    const out = sortRows(rows, { propertyId: "started", direction: "asc" }, props);
    expect(out.map((r) => r.id)).toEqual(["b", "a", "d", "c"]);
  });

  it("select sorts by option order, not label", () => {
    // options order: todo, reading, done
    const out = sortRows(rows, { propertyId: "status", direction: "asc" }, props);
    // d (null) last. The rest by option index.
    expect(out.map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });
  it("select descending still has nulls last", () => {
    const out = sortRows(rows, { propertyId: "status", direction: "desc" }, props);
    expect(out[out.length - 1].id).toBe("d");
    // Among the others, by reversed option order: done, reading, todo.
    expect(out.slice(0, 3).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("multiSelect sorts by array length", () => {
    const out = sortRows(rows, { propertyId: "tags", direction: "asc" }, props);
    // c (0), a (1), b (1), d (2). Within length ties, by position.
    expect(out.map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("checkbox sorts false < true", () => {
    const out = sortRows(rows, { propertyId: "finished", direction: "asc" }, props);
    // false rows first by position (a, c), then true rows (b, d).
    expect(out.map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("nulls are last in BOTH directions (defensive)", () => {
    const up = sortRows(rows, { propertyId: "author", direction: "asc" }, props);
    const down = sortRows(rows, { propertyId: "author", direction: "desc" }, props);
    const isNullish = (r: Row) => r.values.author === null || r.values.author === "";
    expect(up.filter(isNullish).map((r) => r.id).sort()).toEqual(
      down.filter(isNullish).map((r) => r.id).sort(),
    );
    expect(up[up.length - 1] === down[down.length - 1]).toBe(true);
  });
});

describe("groupRows", () => {
  it("returns a single 'All' column when groupBy is null", () => {
    const cols = groupRows(rows, props, null);
    expect(cols).toHaveLength(1);
    expect(cols[0].key).toBe("__all__");
    expect(cols[0].rows.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it("returns columns in option order for a select property", () => {
    const cols = groupRows(rows, props, "status");
    expect(cols.map((c) => c.key)).toEqual(["todo", "reading", "done", "__none__"]);
    expect(cols[0].rows.map((r) => r.id)).toEqual(["c"]);
    expect(cols[1].rows.map((r) => r.id)).toEqual(["a"]);
    expect(cols[2].rows.map((r) => r.id)).toEqual(["b"]);
    expect(cols[3].rows.map((r) => r.id)).toEqual(["d"]);
  });

  it("places a multiSelect row in each selected option's column", () => {
    const cols = groupRows(rows, props, "tags");
    expect(cols.map((c) => c.key)).toEqual(["fiction", "nonfic", "__none__"]);
    expect(cols[0].rows.map((r) => r.id)).toEqual(["a", "d"]);
    expect(cols[1].rows.map((r) => r.id)).toEqual(["b", "d"]);
    // c has [] which falls to noValue.
    expect(cols[2].key).toBe("__none__");
    expect(cols[2].rows.map((r) => r.id)).toEqual(["c"]);
  });

  it("omits the 'No value' column when every row has a value", () => {
    const noNulls: Row[] = rows.filter((r) => r.values.status != null);
    const cols = groupRows(noNulls, props, "status");
    expect(cols.find((c) => c.key === "__none__")).toBeUndefined();
  });

  it("falls back to a single column when groupBy is not a select property", () => {
    const cols = groupRows(rows, props, "author");
    expect(cols).toHaveLength(1);
    expect(cols[0].key).toBe("__all__");
  });

  it("falls back when the property is missing", () => {
    const cols = groupRows(rows, props, "no-such-prop");
    expect(cols).toHaveLength(1);
  });
});

describe("visibleRows", () => {
  it("filters then sorts", () => {
    const settings = {
      filters: [{ id: "1", propertyId: "finished", op: "is" as const, value: true }],
      sort: { propertyId: "pages", direction: "asc" as const },
      groupBy: null,
      listProps: [],
    };
    const out = visibleRows(rows, settings, props);
    expect(out.map((r) => r.id)).toEqual(["d", "b"]);
  });
});

describe("renderCellValue", () => {
  it("returns null for empty values", () => {
    expect(renderCellValue(authorProp, null)).toBeNull();
    expect(renderCellValue(authorProp, "")).toBeNull();
    expect(renderCellValue(pagesProp, null)).toBeNull();
    expect(renderCellValue(pagesProp, NaN)).toBeNull();
  });

  it("renders text / url / number / date / checkbox / select / multiSelect", () => {
    expect(renderCellValue(authorProp, "Adams")).toEqual({
      text: "Adams",
      isEmpty: false,
      kind: "text",
    });
    expect(renderCellValue(linkProp, "https://x")?.kind).toBe("text");
    expect(renderCellValue(pagesProp, 42)).toEqual({
      text: "42",
      isEmpty: false,
      kind: "text",
    });
    expect(renderCellValue(startedProp, "2025-01-15")).toEqual({
      text: "15 Jan 2025",
      isEmpty: false,
      kind: "date",
    });
    expect(renderCellValue(finishedProp, true)).toEqual({
      text: "Yes",
      isEmpty: false,
      kind: "check",
    });
    expect(renderCellValue(statusProp, "reading")).toEqual({
      text: "Reading",
      isEmpty: false,
      kind: "chip",
    });
    const ms = renderCellValue(tagsProp, ["fiction", "nonfic"]);
    expect(ms?.text).toBe("Fiction · Non-fiction");
    expect(ms?.kind).toBe("chip");
  });
});

describe("optionForCell", () => {
  it("returns the option object for a valid select id", () => {
    expect(optionForCell(statusProp, "reading")?.label).toBe("Reading");
  });
  it("returns null for non-select or unknown ids", () => {
    expect(optionForCell(authorProp, "anything")).toBeNull();
    expect(optionForCell(statusProp, "missing")).toBeNull();
    expect(optionForCell(statusProp, null)).toBeNull();
  });
});

describe("selectProperties", () => {
  it("returns only select / multiSelect properties in position order", () => {
    const list = selectProperties(props);
    expect(list.map((p) => p.id)).toEqual(["status", "tags"]);
  });
});

describe("defaultListProps", () => {
  it("picks the first two 'interesting' properties when available", () => {
    expect(defaultListProps(props)).toEqual(["status", "tags"]);
  });
  it("falls back to the first two properties by position", () => {
    const onlyText: Property[] = [
      prop("a", "text", [], 0),
      prop("b", "number", [], 1),
    ];
    expect(defaultListProps(onlyText)).toEqual(["a", "b"]);
  });
});

describe("emptyViewSettings / emptyDatabaseViews", () => {
  it("emptyViewSettings has no filters, no sort, no groupBy, no listProps", () => {
    expect(emptyViewSettings()).toEqual({
      filters: [],
      sort: null,
      groupBy: null,
      listProps: [],
    });
  });
  it("emptyDatabaseViews starts on the table view with all three empty", () => {
    const v = emptyDatabaseViews();
    expect(v.activeView).toBe("table");
    expect(v.table).toEqual(emptyViewSettings());
    expect(v.board).toEqual(emptyViewSettings());
    expect(v.list).toEqual(emptyViewSettings());
  });
});
