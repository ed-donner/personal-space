import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../src/db.js";
import { PageRepository } from "../src/pages.js";
import { BlockRepository } from "../src/blocks.js";
import {
  DatabaseRepository,
  DatabaseError,
  MAX_NAME_LENGTH,
} from "../src/databases.js";
import { seedIfEmpty } from "../src/seed.js";
import type { Property, PropertyType, Row } from "../src/types.js";

/** A fresh set of repos backed by an in-memory database. */
function newRepos() {
  const db = openDb(":memory:");
  const pages = new PageRepository(db);
  const blocks = new BlockRepository(db);
  const dbs = new DatabaseRepository(db, pages);
  return { db, pages, blocks, dbs };
}

/** Create a database page and return it. */
function makeDatabase(pages: PageRepository, title = "DB") {
  return pages.create({ title, type: "database" });
}

/**
 * Create a database with one property of each type, the select/multiSelect
 * given options, and a single row. Returns handles to everything for tests.
 */
function setupAllTypes() {
  const r = newRepos();
  const database = makeDatabase(r.pages);
  const text = r.dbs.createProperty(database.id, {
    name: "Text",
    type: "text",
  });
  const number = r.dbs.createProperty(database.id, {
    name: "Num",
    type: "number",
  });
  const select = r.dbs.createProperty(database.id, {
    name: "Sel",
    type: "select",
  });
  const selectWithOpts = r.dbs.updateProperty(select.id, {
    options: [
      { id: "a", label: "A", color: "red" },
      { id: "b", label: "B", color: "blue" },
    ],
  });
  const multi = r.dbs.createProperty(database.id, {
    name: "Multi",
    type: "multiSelect",
  });
  const multiWithOpts = r.dbs.updateProperty(multi.id, {
    options: [
      { id: "x", label: "X", color: "red" },
      { id: "y", label: "Y", color: "blue" },
    ],
  });
  const date = r.dbs.createProperty(database.id, {
    name: "Date",
    type: "date",
  });
  const checkbox = r.dbs.createProperty(database.id, {
    name: "Check",
    type: "checkbox",
  });
  const url = r.dbs.createProperty(database.id, {
    name: "Url",
    type: "url",
  });
  const row = r.dbs.createRow(database.id, { title: "Row1" });
  return {
    ...r,
    database,
    text,
    number,
    select: selectWithOpts,
    multi: multiWithOpts,
    date,
    checkbox,
    url,
    row,
  };
}

/** Assert that `fn` throws a DatabaseError with the given status. */
function expectStatus(fn: () => unknown, status: number): void {
  try {
    fn();
    throw new Error("expected throw");
  } catch (err) {
    expect(err).toBeInstanceOf(DatabaseError);
    expect((err as DatabaseError).status).toBe(status);
  }
}

// ---- property creation ----

describe("DatabaseRepository.createProperty", () => {
  let pages: PageRepository;
  let dbs: DatabaseRepository;
  beforeEach(() => {
    const r = newRepos();
    pages = r.pages;
    dbs = r.dbs;
  });

  it("creates a property of each of the seven types", () => {
    const database = makeDatabase(pages);
    const types: PropertyType[] = [
      "text",
      "number",
      "select",
      "multiSelect",
      "date",
      "checkbox",
      "url",
    ];
    const created = types.map((t) =>
      dbs.createProperty(database.id, { name: t, type: t }),
    );
    expect(created).toHaveLength(7);
    created.forEach((p, i) => {
      expect(p.type).toBe(types[i]);
      expect(p.name).toBe(types[i]);
      expect(p.databaseId).toBe(database.id);
      expect(p.options).toEqual([]);
      expect(p.position).toBe(i);
      expect(p.id).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });

  it("rejects an invalid type with 400", () => {
    const database = makeDatabase(pages);
    expectStatus(
      () => dbs.createProperty(database.id, { name: "N", type: "bogus" }),
      400,
    );
  });

  it("rejects a missing type with 400", () => {
    const database = makeDatabase(pages);
    expectStatus(
      () => dbs.createProperty(database.id, { name: "N" }),
      400,
    );
  });

  it("rejects a missing or empty name with 400", () => {
    const database = makeDatabase(pages);
    expectStatus(
      () => dbs.createProperty(database.id, { name: undefined, type: "text" }),
      400,
    );
    expectStatus(
      () => dbs.createProperty(database.id, { name: "   ", type: "text" }),
      400,
    );
  });

  it("trims and caps property names like page titles", () => {
    const database = makeDatabase(pages);
    const p = dbs.createProperty(database.id, {
      name: "  Author  ",
      type: "text",
    });
    expect(p.name).toBe("Author");
    expectStatus(
      () =>
        dbs.createProperty(database.id, {
          name: "A".repeat(MAX_NAME_LENGTH + 1),
          type: "text",
        }),
      400,
    );
  });

  it("returns 404 when the database id is unknown or not a database", () => {
    expectStatus(
      () => dbs.createProperty("ghost", { name: "N", type: "text" }),
      404,
    );
    const regular = pages.create({ title: "Page" });
    expectStatus(
      () => dbs.createProperty(regular.id, { name: "N", type: "text" }),
      404,
    );
  });
});

// ---- property update ----

describe("DatabaseRepository.updateProperty", () => {
  let pages: PageRepository;
  let dbs: DatabaseRepository;
  beforeEach(() => {
    const r = newRepos();
    pages = r.pages;
    dbs = r.dbs;
  });

  it("renames a property", () => {
    const database = makeDatabase(pages);
    const p = dbs.createProperty(database.id, {
      name: "Old",
      type: "text",
    });
    const updated = dbs.updateProperty(p.id, { name: "New" });
    expect(updated.name).toBe("New");
    expect(updated.type).toBe("text");
    expect(dbs.findProperty(p.id)!.name).toBe("New");
  });

  it("ignores a type field on patch (type is fixed)", () => {
    const database = makeDatabase(pages);
    const p = dbs.createProperty(database.id, {
      name: "N",
      type: "text",
    });
    // @ts-expect-error: type is not part of the patch contract on purpose.
    const updated = dbs.updateProperty(p.id, { name: "N", type: "number" });
    expect(updated.type).toBe("text");
  });

  it("adds options to an empty select", () => {
    const database = makeDatabase(pages);
    const p = dbs.createProperty(database.id, {
      name: "S",
      type: "select",
    });
    const updated = dbs.updateProperty(p.id, {
      options: [
        { id: "a", label: "A", color: "red" },
        { label: "B", color: "blue" }, // id generated
      ],
    });
    expect(updated.options).toHaveLength(2);
    expect(updated.options[0]).toEqual({ id: "a", label: "A", color: "red" });
    expect(updated.options[1].id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(updated.options[1].label).toBe("B");
  });

  it("replaces options (full replace, honors supplied ids)", () => {
    const database = makeDatabase(pages);
    const p = dbs.createProperty(database.id, {
      name: "S",
      type: "select",
    });
    const withOpts = dbs.updateProperty(p.id, {
      options: [
        { id: "a", label: "A", color: "red" },
        { id: "b", label: "B", color: "blue" },
      ],
    });
    // Replace: keep a (recolor), drop b, add c.
    const replaced = dbs.updateProperty(p.id, {
      options: [
        { id: "a", label: "A!", color: "green" },
        { label: "C", color: "gray" },
      ],
    });
    expect(replaced.options.map((o) => o.id)).toEqual(["a", expect.any(String)]);
    expect(replaced.options[0]).toEqual({ id: "a", label: "A!", color: "green" });
    expect(replaced.options[1].label).toBe("C");
    expect(withOpts).toBeDefined();
  });

  it("recolors an option without changing its id", () => {
    const database = makeDatabase(pages);
    const p = dbs.createProperty(database.id, {
      name: "S",
      type: "select",
    });
    dbs.updateProperty(p.id, {
      options: [{ id: "a", label: "A", color: "red" }],
    });
    const recolored = dbs.updateProperty(p.id, {
      options: [{ id: "a", label: "A", color: "blue" }],
    });
    expect(recolored.options).toEqual([
      { id: "a", label: "A", color: "blue" },
    ]);
  });

  it("returns 404 for an unknown property id", () => {
    expectStatus(() => dbs.updateProperty("ghost", { name: "x" }), 404);
  });

  it("rejects bad option labels and colors with 400", () => {
    const database = makeDatabase(pages);
    const p = dbs.createProperty(database.id, {
      name: "S",
      type: "select",
    });
    expectStatus(
      () => dbs.updateProperty(p.id, { options: [{ label: "", color: "red" }] }),
      400,
    );
    expectStatus(
      () =>
        dbs.updateProperty(p.id, {
          options: [{ label: "ok", color: "" }],
        }),
      400,
    );
    // Bad options shape.
    expectStatus(() => dbs.updateProperty(p.id, { options: "nope" }), 400);
    // A bad option must not change the stored options.
    expect(dbs.findProperty(p.id)!.options).toEqual([]);
  });
});

// ---- option delete scrub ----

describe("option delete scrubs row values", () => {
  it("select -> null when the option is removed", () => {
    const s = setupAllTypes();
    // Set the row's select to "a".
    s.dbs.updateRow(s.row.id, { values: { [s.select.id]: "a" } });
    expect(s.dbs.findRow(s.row.id)!.values[s.select.id]).toBe("a");
    // Replace options dropping "a", keep "b".
    s.dbs.updateProperty(s.select.id, {
      options: [{ id: "b", label: "B", color: "blue" }],
    });
    const row = s.dbs.findRow(s.row.id)!;
    expect(row.values[s.select.id]).toBeNull();
  });

  it("multiSelect -> filtered when an option is removed", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, { values: { [s.multi.id]: ["x", "y"] } });
    expect(s.dbs.findRow(s.row.id)!.values[s.multi.id]).toEqual(["x", "y"]);
    // Drop "x", keep "y".
    s.dbs.updateProperty(s.multi.id, {
      options: [{ id: "y", label: "Y", color: "blue" }],
    });
    expect(s.dbs.findRow(s.row.id)!.values[s.multi.id]).toEqual(["y"]);
  });

  it("leaves other rows and properties untouched during scrub", () => {
    const s = setupAllTypes();
    const row2 = s.dbs.createRow(s.database.id, { title: "Row2" });
    s.dbs.updateRow(s.row.id, { values: { [s.select.id]: "a" } });
    s.dbs.updateRow(row2.id, { values: { [s.select.id]: "b" } });
    s.dbs.updateProperty(s.select.id, {
      options: [{ id: "b", label: "B", color: "blue" }],
    });
    expect(s.dbs.findRow(s.row.id)!.values[s.select.id]).toBeNull();
    expect(s.dbs.findRow(row2.id)!.values[s.select.id]).toBe("b");
  });
});

// ---- property delete ----

describe("DatabaseRepository.removeProperty", () => {
  it("deletes the property and cascades its row values", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, { values: { [s.text.id]: "hi", [s.number.id]: 3 } });
    // row_values now exist for text and number.
    s.dbs.removeProperty(s.text.id);
    expect(s.dbs.findProperty(s.text.id)).toBeUndefined();
    const row = s.dbs.findRow(s.row.id)!;
    expect(row.values[s.text.id]).toBeUndefined();
    expect(row.values[s.number.id]).toBe(3); // untouched
  });

  it("returns 404 for an unknown property id", () => {
    expectStatus(() => newRepos().dbs.removeProperty("ghost"), 404);
  });
});

// ---- rows ----

describe("DatabaseRepository.createRow", () => {
  it("defaults the title to 'Untitled' and type to 'row'", () => {
    const s = setupAllTypes();
    const row = s.dbs.createRow(s.database.id, {});
    expect(row.title).toBe("Untitled");
    expect(row.values).toEqual({});
    expect(row.databaseId).toBe(s.database.id);
    const page = s.pages.findById(row.id)!;
    expect(page.type).toBe("row");
    expect(page.parentId).toBe(s.database.id);
  });

  it("scopes position to the database's rows", () => {
    const s = setupAllTypes();
    const r1 = s.dbs.createRow(s.database.id, { title: "r1" });
    const r2 = s.dbs.createRow(s.database.id, { title: "r2" });
    expect(r1.position).toBe(s.row.position + 1);
    expect(r2.position).toBe(s.row.position + 2);
  });

  it("returns 404 when the database id is unknown or not a database", () => {
    const r = newRepos();
    expectStatus(() => r.dbs.createRow("ghost", {}), 404);
    const page = r.pages.create({ title: "P" });
    expectStatus(() => r.dbs.createRow(page.id, {}), 404);
  });
});

// ---- value validation ----

describe("per-type value validation", () => {
  it("text: accepts a string <= 10000, rejects non-string/over-length", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, { values: { [s.text.id]: "hello" } });
    expect(s.dbs.findRow(s.row.id)!.values[s.text.id]).toBe("hello");
    s.dbs.updateRow(s.row.id, { values: { [s.text.id]: "A".repeat(10000) } });
    expectStatus(
      () =>
        s.dbs.updateRow(s.row.id, {
          values: { [s.text.id]: "A".repeat(10001) },
        }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.text.id]: 5 } }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.text.id]: null } }),
      400,
    );
  });

  it("number: accepts a finite number or null, rejects NaN/Infinity/string", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, { values: { [s.number.id]: 42 } });
    expect(s.dbs.findRow(s.row.id)!.values[s.number.id]).toBe(42);
    s.dbs.updateRow(s.row.id, { values: { [s.number.id]: null } });
    expect(s.dbs.findRow(s.row.id)!.values[s.number.id]).toBeNull();
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.number.id]: NaN } }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.number.id]: Infinity } }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.number.id]: "5" } }),
      400,
    );
    // A boolean is not a number.
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.number.id]: true } }),
      400,
    );
  });

  it("select: accepts an option id or null, rejects unknown/non-string", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, { values: { [s.select.id]: "a" } });
    expect(s.dbs.findRow(s.row.id)!.values[s.select.id]).toBe("a");
    s.dbs.updateRow(s.row.id, { values: { [s.select.id]: null } });
    expect(s.dbs.findRow(s.row.id)!.values[s.select.id]).toBeNull();
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.select.id]: "zzz" } }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.select.id]: 5 } }),
      400,
    );
  });

  it("multiSelect: accepts option ids (dedupes), rejects unknown/non-array", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, { values: { [s.multi.id]: ["x", "y", "x"] } });
    expect(s.dbs.findRow(s.row.id)!.values[s.multi.id]).toEqual(["x", "y"]);
    s.dbs.updateRow(s.row.id, { values: { [s.multi.id]: [] } });
    expect(s.dbs.findRow(s.row.id)!.values[s.multi.id]).toEqual([]);
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.multi.id]: ["x", "zzz"] } }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.multi.id]: "x" } }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.multi.id]: [1] } }),
      400,
    );
  });

  it("date: accepts a valid YYYY-MM-DD or null, rejects bad formats", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, { values: { [s.date.id]: "2024-02-29" } });
    expect(s.dbs.findRow(s.row.id)!.values[s.date.id]).toBe("2024-02-29");
    s.dbs.updateRow(s.row.id, { values: { [s.date.id]: null } });
    expect(s.dbs.findRow(s.row.id)!.values[s.date.id]).toBeNull();
    // 2023 is not a leap year.
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.date.id]: "2023-02-29" } }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.date.id]: "2024-13-01" } }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.date.id]: "2024/01/01" } }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.date.id]: "not-a-date" } }),
      400,
    );
  });

  it("checkbox: accepts a boolean, rejects everything else", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, { values: { [s.checkbox.id]: true } });
    expect(s.dbs.findRow(s.row.id)!.values[s.checkbox.id]).toBe(true);
    s.dbs.updateRow(s.row.id, { values: { [s.checkbox.id]: false } });
    expect(s.dbs.findRow(s.row.id)!.values[s.checkbox.id]).toBe(false);
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.checkbox.id]: 1 } }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.checkbox.id]: "true" } }),
      400,
    );
  });

  it("url: accepts a string <= 10000, rejects non-string", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, {
      values: { [s.url.id]: "https://example.com" },
    });
    expect(s.dbs.findRow(s.row.id)!.values[s.url.id]).toBe("https://example.com");
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.url.id]: 5 } }),
      400,
    );
  });
});

// ---- url value validation (DEF-005) ----

describe("url value validation (DEF-005)", () => {
  it("accepts an absolute https URL and stores it", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, {
      values: { [s.url.id]: "https://example.com/path?q=1" },
    });
    expect(s.dbs.findRow(s.row.id)!.values[s.url.id]).toBe(
      "https://example.com/path?q=1",
    );
  });

  it("accepts an absolute http URL", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, {
      values: { [s.url.id]: "http://localhost:3000/x" },
    });
    expect(s.dbs.findRow(s.row.id)!.values[s.url.id]).toBe(
      "http://localhost:3000/x",
    );
  });

  it("accepts an empty string and null (both = unset)", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, { values: { [s.url.id]: "" } });
    expect(s.dbs.findRow(s.row.id)!.values[s.url.id]).toBe("");
    s.dbs.updateRow(s.row.id, { values: { [s.url.id]: null } });
    expect(s.dbs.findRow(s.row.id)!.values[s.url.id]).toBeNull();
  });

  it("rejects a javascript: URL with 400", () => {
    const s = setupAllTypes();
    expectStatus(
      () =>
        s.dbs.updateRow(s.row.id, {
          values: { [s.url.id]: "javascript:alert(1)" },
        }),
      400,
    );
    // Nothing stored.
    expect(s.dbs.findRow(s.row.id)!.values[s.url.id]).toBeUndefined();
  });

  it("rejects a relative path with 400", () => {
    const s = setupAllTypes();
    expectStatus(
      () =>
        s.dbs.updateRow(s.row.id, { values: { [s.url.id]: "/foo/bar" } }),
      400,
    );
    expectStatus(
      () =>
        s.dbs.updateRow(s.row.id, { values: { [s.url.id]: "foo/bar" } }),
      400,
    );
  });

  it("rejects plain text / garbage with 400", () => {
    const s = setupAllTypes();
    expectStatus(
      () =>
        s.dbs.updateRow(s.row.id, {
          values: { [s.url.id]: "not a valid url at all" },
        }),
      400,
    );
    expectStatus(
      () =>
        s.dbs.updateRow(s.row.id, { values: { [s.url.id]: "example.com" } }),
      400,
    );
  });

  it("rejects a data: URL and other non-http schemes with 400", () => {
    const s = setupAllTypes();
    expectStatus(
      () =>
        s.dbs.updateRow(s.row.id, {
          values: { [s.url.id]: "data:text/html,<script>x</script>" },
        }),
      400,
    );
    expectStatus(
      () =>
        s.dbs.updateRow(s.row.id, { values: { [s.url.id]: "ftp://x/y" } }),
      400,
    );
  });

  it("rejects a non-string (other than null) with 400", () => {
    const s = setupAllTypes();
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.url.id]: 5 } }),
      400,
    );
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { values: { [s.url.id]: true } }),
      400,
    );
  });

  it("does not store a rejected value (no partial write)", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, {
      values: { [s.url.id]: "https://good.example.com" },
    });
    expectStatus(
      () =>
        s.dbs.updateRow(s.row.id, {
          values: { [s.url.id]: "javascript:bad" },
        }),
      400,
    );
    // The good value is still there.
    expect(s.dbs.findRow(s.row.id)!.values[s.url.id]).toBe(
      "https://good.example.com",
    );
  });
});

// ---- merge semantics ----

describe("PATCH /rows merge semantics", () => {
  it("merges values per-key without wiping others", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, {
      values: { [s.text.id]: "first", [s.number.id]: 1 },
    });
    s.dbs.updateRow(s.row.id, { values: { [s.number.id]: 2 } });
    const row = s.dbs.findRow(s.row.id)!;
    expect(row.values[s.text.id]).toBe("first"); // untouched
    expect(row.values[s.number.id]).toBe(2); // updated
  });

  it("renames a row via title patch and keeps values", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, { values: { [s.text.id]: "keep" } });
    const updated = s.dbs.updateRow(s.row.id, { title: "New Title" });
    expect(updated.title).toBe("New Title");
    expect(updated.values[s.text.id]).toBe("keep");
  });

  it("rejects an unknown property key with 400 and writes nothing", () => {
    const s = setupAllTypes();
    s.dbs.updateRow(s.row.id, { values: { [s.text.id]: "good" } });
    expectStatus(
      () =>
        s.dbs.updateRow(s.row.id, {
          values: { [s.text.id]: "changed", "ghost-prop": "x" },
        }),
      400,
    );
    // text unchanged because the bad merge wrote nothing.
    expect(s.dbs.findRow(s.row.id)!.values[s.text.id]).toBe("good");
  });

  it("rejects a non-string title with 400", () => {
    const s = setupAllTypes();
    expectStatus(
      () => s.dbs.updateRow(s.row.id, { title: 5 }),
      400,
    );
  });

  it("returns 404 for an unknown or non-row id", () => {
    const s = setupAllTypes();
    expectStatus(() => s.dbs.updateRow("ghost", { title: "x" }), 404);
    // A regular page is not a row.
    const page = s.pages.create({ title: "P" });
    expectStatus(() => s.dbs.updateRow(page.id, { title: "x" }), 404);
  });
});

// ---- row delete ----

describe("DatabaseRepository.removeRow", () => {
  it("deletes the row and cascades its blocks", () => {
    const s = setupAllTypes();
    const block = s.blocks.create(s.row.id, { content: "note" });
    s.dbs.updateRow(s.row.id, { values: { [s.text.id]: "v" } });
    s.dbs.removeRow(s.row.id);
    expect(s.dbs.findRow(s.row.id)).toBeUndefined();
    expect(s.pages.findById(s.row.id)).toBeUndefined();
    // Block gone.
    expect(s.blocks.list(s.row.id)).toEqual([]);
    expect(s.blocks.list(s.row.id).some((b) => b.id === block.id)).toBe(false);
  });

  it("returns 404 for an unknown or non-row id", () => {
    const s = setupAllTypes();
    expectStatus(() => s.dbs.removeRow("ghost"), 404);
    const page = s.pages.create({ title: "P" });
    expectStatus(() => s.dbs.removeRow(page.id), 404);
  });
});

// ---- aggregate GET ----

describe("DatabaseRepository.getDatabase", () => {
  it("returns the aggregate shape { database, properties, rows }", () => {
    const s = setupAllTypes();
    const agg = s.dbs.getDatabase(s.database.id);
    expect(agg.database.id).toBe(s.database.id);
    expect(agg.database.type).toBe("database");
    expect(agg.properties.map((p) => p.type)).toEqual([
      "text",
      "number",
      "select",
      "multiSelect",
      "date",
      "checkbox",
      "url",
    ]);
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0].title).toBe("Row1");
  });

  it("returns 404 for an unknown id or a regular page", () => {
    const r = newRepos();
    expectStatus(() => r.dbs.getDatabase("ghost"), 404);
    const page = r.pages.create({ title: "P" });
    expectStatus(() => r.dbs.getDatabase(page.id), 404);
  });
});

// ---- database delete cascade ----

describe("database delete cascades properties/rows/values/blocks", () => {
  it("removes everything via DELETE /api/pages/:id (PageRepository.remove)", () => {
    const s = setupAllTypes();
    const row2 = s.dbs.createRow(s.database.id, { title: "Row2" });
    s.dbs.updateRow(s.row.id, { values: { [s.text.id]: "v" } });
    s.dbs.updateRow(row2.id, { values: { [s.number.id]: 9 } });
    s.blocks.create(s.row.id, { content: "note" });
    s.blocks.create(row2.id, { content: "note2" });
    s.blocks.create(s.database.id, { content: "header" });

    const propCount = () =>
      (s.db
        .prepare("SELECT COUNT(*) AS c FROM properties WHERE database_id = ?")
        .get(s.database.id) as { c: number }).c;
    const rowCount = () =>
      (s.db
        .prepare(
          "SELECT COUNT(*) AS c FROM pages WHERE parent_id = ? AND type = 'row'",
        )
        .get(s.database.id) as { c: number }).c;
    const valueCount = () =>
      (s.db.prepare("SELECT COUNT(*) AS c FROM row_values").get() as {
        c: number;
      }).c;
    const blockCount = () =>
      (s.db.prepare("SELECT COUNT(*) AS c FROM blocks").get() as {
        c: number;
      }).c;

    expect(propCount()).toBe(7);
    expect(rowCount()).toBe(2);
    expect(valueCount()).toBe(2);
    expect(blockCount()).toBe(3);

    s.pages.remove(s.database.id);

    expect(s.pages.findById(s.database.id)).toBeUndefined();
    expect(s.pages.findById(s.row.id)).toBeUndefined();
    expect(s.pages.findById(row2.id)).toBeUndefined();
    expect(propCount()).toBe(0);
    expect(rowCount()).toBe(0);
    expect(valueCount()).toBe(0);
    expect(blockCount()).toBe(0);
  });
});

// ---- seed ----

describe("seed exercises all property types", () => {
  it("reading-list database has all 7 property types and rows", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const pages = new PageRepository(db);
    const dbs = new DatabaseRepository(db, pages);

    const reading = pages.findById("reading-list")!;
    expect(reading.type).toBe("database");
    const agg = dbs.getDatabase("reading-list");
    const types = agg.properties.map((p) => p.type);
    for (const t of [
      "text",
      "number",
      "select",
      "multiSelect",
      "date",
      "checkbox",
      "url",
    ] as PropertyType[]) {
      expect(types).toContain(t);
    }
    // 6-8 rows.
    expect(agg.rows.length).toBeGreaterThanOrEqual(6);
    expect(agg.rows.length).toBeLessThanOrEqual(8);
    // Rows have the right databaseId and a title.
    for (const row of agg.rows) {
      expect(row.databaseId).toBe("reading-list");
      expect(row.title.length).toBeGreaterThan(0);
    }
  });

  it("project-tracker database has all 7 property types and 8-10 rows", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const pages = new PageRepository(db);
    const dbs = new DatabaseRepository(db, pages);

    const tracker = pages.findById("project-tracker")!;
    expect(tracker.type).toBe("database");
    expect(tracker.parentId).toBe("projects");
    const agg = dbs.getDatabase("project-tracker");
    expect(agg.properties).toHaveLength(7);
    expect(agg.rows.length).toBeGreaterThanOrEqual(8);
    expect(agg.rows.length).toBeLessThanOrEqual(10);
  });

  it("seeded row values are typed correctly", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const pages = new PageRepository(db);
    const dbs = new DatabaseRepository(db, pages);
    const agg = dbs.getDatabase("reading-list");
    const byType = new Map(agg.properties.map((p) => [p.type, p]));
    // At least one row has a multiSelect array and a checkbox boolean.
    const hasMulti = agg.rows.some(
      (r) => Array.isArray(r.values[byType.get("multiSelect")!.id]),
    );
    const hasCheckbox = agg.rows.some(
      (r) => typeof r.values[byType.get("checkbox")!.id] === "boolean",
    );
    const hasNumber = agg.rows.some(
      (r) => typeof r.values[byType.get("number")!.id] === "number",
    );
    expect(hasMulti).toBe(true);
    expect(hasCheckbox).toBe(true);
    expect(hasNumber).toBe(true);
  });
});

// ---- row title validation (DEF-008) ----

describe("row title validation (DEF-008)", () => {
  it("createRow rejects an empty title with 400 and a clear message", () => {
    const r = newRepos();
    const database = makeDatabase(r.pages);
    try {
      r.dbs.createRow(database.id, { title: "" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseError);
      expect((err as DatabaseError).status).toBe(400);
      expect((err as DatabaseError).message).toBe("title must not be empty");
    }
  });

  it("createRow rejects a whitespace-only title with 400", () => {
    const r = newRepos();
    const database = makeDatabase(r.pages);
    try {
      r.dbs.createRow(database.id, { title: "   " });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseError);
      expect((err as DatabaseError).status).toBe(400);
      expect((err as DatabaseError).message).toBe("title must not be empty");
    }
  });

  it("createRow rejects an over-length title (>200 chars) with 400", () => {
    const r = newRepos();
    const database = makeDatabase(r.pages);
    const long = "A".repeat(201);
    try {
      r.dbs.createRow(database.id, { title: long });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseError);
      expect((err as DatabaseError).status).toBe(400);
      expect((err as DatabaseError).message).toBe(
        "title must be at most 200 characters",
      );
    }
  });

  it("createRow with no title field still defaults to 'Untitled'", () => {
    const r = newRepos();
    const database = makeDatabase(r.pages);
    const row = r.dbs.createRow(database.id, {});
    expect(row.title).toBe("Untitled");
  });

  it("createRow accepts a 200-char title (boundary)", () => {
    const r = newRepos();
    const database = makeDatabase(r.pages);
    const exact = "A".repeat(200);
    const row = r.dbs.createRow(database.id, { title: exact });
    expect(row.title).toBe(exact);
  });

  it("updateRow rejects renaming a row to an empty title with 400", () => {
    const r = newRepos();
    const database = makeDatabase(r.pages);
    const row = r.dbs.createRow(database.id, { title: "Row1" });
    try {
      r.dbs.updateRow(row.id, { title: "" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseError);
      expect((err as DatabaseError).status).toBe(400);
      expect((err as DatabaseError).message).toBe("title must not be empty");
    }
    // Title unchanged.
    expect(r.dbs.findRow(row.id)!.title).toBe("Row1");
  });

  it("updateRow rejects an over-length title with 400", () => {
    const r = newRepos();
    const database = makeDatabase(r.pages);
    const row = r.dbs.createRow(database.id, { title: "Row1" });
    try {
      r.dbs.updateRow(row.id, { title: "B".repeat(201) });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseError);
      expect((err as DatabaseError).status).toBe(400);
      expect((err as DatabaseError).message).toBe(
        "title must be at most 200 characters",
      );
    }
    expect(r.dbs.findRow(row.id)!.title).toBe("Row1");
  });

  it("updateRow renames a row via a valid title", () => {
    const r = newRepos();
    const database = makeDatabase(r.pages);
    const row = r.dbs.createRow(database.id, { title: "Row1" });
    const updated = r.dbs.updateRow(row.id, { title: "New Name" });
    expect(updated.title).toBe("New Name");
  });
});

// ---- rows API still creates rows under a database (DEF-010 boundary) ----

describe("createRow still works after DEF-010 (rows API path)", () => {
  it("creates a row under a database with type 'row'", () => {
    const r = newRepos();
    const database = makeDatabase(r.pages);
    const row = r.dbs.createRow(database.id, { title: "Via rows API" });
    expect(row.databaseId).toBe(database.id);
    const page = r.pages.findById(row.id)!;
    expect(page.type).toBe("row");
    expect(page.parentId).toBe(database.id);
  });
});

