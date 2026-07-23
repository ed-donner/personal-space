import { describe, it, expect } from "vitest";
import { openDb } from "../src/db.js";
import { PageRepository } from "../src/pages.js";
import { BlockRepository } from "../src/blocks.js";
import { DatabaseRepository, DatabaseError } from "../src/databases.js";
import { ViewRepository } from "../src/views.js";
import { seedIfEmpty } from "../src/seed.js";
import type { ViewSettings } from "../src/views.js";
import type { Property } from "../src/types.js";

/** A fresh set of repos backed by an in-memory database. */
function newRepos() {
  const db = openDb(":memory:");
  const pages = new PageRepository(db);
  const blocks = new BlockRepository(db);
  const dbs = new DatabaseRepository(db, pages);
  const views = new ViewRepository(db, dbs);
  return { db, pages, blocks, dbs, views };
}

/** Create a database and one property of each type, returning handles. */
function setupDatabase() {
  const r = newRepos();
  const database = r.pages.create({ title: "DB", type: "database" });
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
  };
}

const EMPTY_VIEW: ViewSettings = {
  filters: [],
  sort: null,
  groupBy: null,
  listProps: [],
};

describe("ViewRepository.getViews — defaults materialization", () => {
  it("returns table as activeView and empty table/list settings by default", () => {
    const r = newRepos();
    const database = r.pages.create({ title: "DB", type: "database" });
    const views = r.views.getViews(database.id);
    expect(views.activeView).toBe("table");
    expect(views.table).toEqual(EMPTY_VIEW);
    expect(views.list).toEqual(EMPTY_VIEW);
  });

  it("defaults board.groupBy to the first select property", () => {
    const r = setupDatabase();
    const views = r.views.getViews(r.database.id);
    expect(views.board.groupBy).toBe(r.select.id);
    expect(views.board.filters).toEqual([]);
    expect(views.board.sort).toBeNull();
    expect(views.board.listProps).toEqual([]);
  });

  it("defaults board.groupBy to null when there is no select property", () => {
    const r = newRepos();
    const database = r.pages.create({ title: "DB", type: "database" });
    r.dbs.createProperty(database.id, { name: "Text", type: "text" });
    const views = r.views.getViews(database.id);
    expect(views.board.groupBy).toBeNull();
  });

  it("defaults list.listProps to the first two property ids", () => {
    const r = setupDatabase();
    const views = r.views.getViews(r.database.id);
    // Properties are created in order: text, number, select, multi, date, ...
    expect(views.list.listProps).toEqual([r.text.id, r.number.id]);
  });

  it("defaults list.listProps to fewer than two when fewer properties exist", () => {
    const r = newRepos();
    const database = r.pages.create({ title: "DB", type: "database" });
    const only = r.dbs.createProperty(database.id, {
      name: "Only",
      type: "text",
    });
    const views = r.views.getViews(database.id);
    expect(views.list.listProps).toEqual([only.id]);
  });

  it("returns 404 when the id is not a database", () => {
    const r = newRepos();
    const page = r.pages.create({ title: "Page" });
    assert404(() => r.views.getViews(page.id));
  });

  it("returns 404 for an unknown id", () => {
    const r = newRepos();
    assert404(() => r.views.getViews("nope"));
  });

  it("scrubs a deleted property from stored view settings (DEF-012)", () => {
    // Save a filter referencing a select, then delete the select property.
    // The stored settings are scrubbed in the same transaction, so GET no
    // longer surfaces a stale property id. (Defaults materialized on GET
    // derive from the live properties, so only stored rows need scrubbing.)
    const r = setupDatabase();
    const filter = {
      id: "f1",
      propertyId: r.select.id,
      op: "is",
      value: "a",
    };
    r.views.setViews(r.database.id, {
      table: { filters: [filter] },
    });
    r.dbs.removeProperty(r.select.id);
    const views = r.views.getViews(r.database.id);
    // The filter referencing the deleted property is gone; the board default
    // groupBy (previously this select) now materializes to null since the
    // select no longer exists.
    expect(views.table.filters).toEqual([]);
    expect(views.board.groupBy).toBeNull();
  });
});

describe("ViewRepository.setViews — round-trip persistence", () => {
  it("persists and returns table settings", () => {
    const r = setupDatabase();
    const table: ViewSettings = {
      filters: [
        {
          id: "f1",
          propertyId: r.select.id,
          op: "is",
          value: "a",
        },
      ],
      sort: { propertyId: r.number.id, direction: "desc" },
      groupBy: null,
      listProps: [],
    };
    const result = r.views.setViews(r.database.id, { table });
    expect(result.table).toEqual(table);
    // A second repo over the same DB reads the persisted value.
    const r2 = new ViewRepository(r.db, r.dbs);
    expect(r2.getViews(r.database.id).table).toEqual(table);
  });

  it("persists board settings including groupBy", () => {
    const r = setupDatabase();
    const board: ViewSettings = {
      filters: [],
      sort: { propertyId: r.text.id, direction: "asc" },
      groupBy: r.select.id,
      listProps: [],
    };
    const result = r.views.setViews(r.database.id, { board });
    expect(result.board).toEqual(board);
    expect(r.views.getViews(r.database.id).board).toEqual(board);
  });

  it("persists list settings including listProps", () => {
    const r = setupDatabase();
    const list: ViewSettings = {
      filters: [],
      sort: null,
      groupBy: null,
      listProps: [r.text.id, r.select.id],
    };
    const result = r.views.setViews(r.database.id, { list });
    expect(result.list).toEqual(list);
    expect(r.views.getViews(r.database.id).list).toEqual(list);
  });

  it("persists activeView", () => {
    const r = setupDatabase();
    const result = r.views.setViews(r.database.id, { activeView: "board" });
    expect(result.activeView).toBe("board");
    expect(r.views.getViews(r.database.id).activeView).toBe("board");
  });

  it("survives a reopen of the database file", () => {
    const tmp = `/tmp/opencode/views-test-${Date.now()}.db`;
    const db = openDb(tmp);
    const pages = new PageRepository(db);
    const dbs = new DatabaseRepository(db, pages);
    const views = new ViewRepository(db, dbs);
    const database = pages.create({ title: "DB", type: "database" });
    const sel = dbs.createProperty(database.id, {
      name: "Sel",
      type: "select",
    });
    dbs.updateProperty(sel.id, {
      options: [{ id: "a", label: "A", color: "red" }],
    });
    views.setViews(database.id, {
      activeView: "board",
      board: { groupBy: sel.id, sort: null, filters: [], listProps: [] },
    });
    db.close();
    const db2 = openDb(tmp);
    const pages2 = new PageRepository(db2);
    const dbs2 = new DatabaseRepository(db2, pages2);
    const views2 = new ViewRepository(db2, dbs2);
    const restored = views2.getViews(database.id);
    expect(restored.activeView).toBe("board");
    expect(restored.board.groupBy).toBe(sel.id);
  });
});

describe("ViewRepository.setViews — merge semantics", () => {
  it("updating board does not touch table or list", () => {
    const r = setupDatabase();
    // Seed table with a sort, then update only board.
    r.views.setViews(r.database.id, {
      table: { sort: { propertyId: r.number.id, direction: "asc" } },
    });
    const before = r.views.getViews(r.database.id);
    r.views.setViews(r.database.id, {
      board: { groupBy: r.select.id },
    });
    const after = r.views.getViews(r.database.id);
    expect(after.table).toEqual(before.table);
    expect(after.list).toEqual(before.list);
    expect(after.board.groupBy).toBe(r.select.id);
  });

  it("within a view, only provided fields change", () => {
    const r = setupDatabase();
    r.views.setViews(r.database.id, {
      board: {
        groupBy: r.select.id,
        sort: { propertyId: r.number.id, direction: "asc" },
        filters: [],
        listProps: [],
      },
    });
    // Now only change groupBy; sort and filters should be retained.
    r.views.setViews(r.database.id, {
      board: { groupBy: null },
    });
    const board = r.views.getViews(r.database.id).board;
    expect(board.groupBy).toBeNull();
    expect(board.sort).toEqual({
      propertyId: r.number.id,
      direction: "asc",
    });
    expect(board.filters).toEqual([]);
  });

  it("ignores unknown body keys", () => {
    const r = setupDatabase();
    const result = r.views.setViews(r.database.id, {
      // @ts-expect-error intentional unknown key
      garbage: { filters: [] },
      activeView: "list",
    } as unknown as { activeView: unknown });
    expect(result.activeView).toBe("list");
  });
});

describe("ViewRepository.setViews — validation 400s", () => {
  it("rejects an op invalid for the property type", () => {
    const r = setupDatabase();
    assert400(() =>
      r.views.setViews(r.database.id, {
        table: {
          filters: [
            { id: "f1", propertyId: r.number.id, op: "contains", value: 1 },
          ],
        },
      }),
    );
  });

  it("rejects a select filter value that is an option of a different property", () => {
    const r = setupDatabase();
    // 'y' is an option of multi, not of select.
    assert400(() =>
      r.views.setViews(r.database.id, {
        table: {
          filters: [
            { id: "f1", propertyId: r.select.id, op: "is", value: "y" },
          ],
        },
      }),
    );
  });

  it("rejects groupBy pointing at a non-select property", () => {
    const r = setupDatabase();
    assert400(() =>
      r.views.setViews(r.database.id, {
        board: { groupBy: r.number.id },
      }),
    );
  });

  it("rejects an unknown property id in a filter", () => {
    const r = setupDatabase();
    assert400(() =>
      r.views.setViews(r.database.id, {
        table: {
          filters: [
            { id: "f1", propertyId: "unknown", op: "is", value: "a" },
          ],
        },
      }),
    );
  });

  it("rejects an unknown property id in a sort", () => {
    const r = setupDatabase();
    assert400(() =>
      r.views.setViews(r.database.id, {
        table: { sort: { propertyId: "unknown", direction: "asc" } },
      }),
    );
  });

  it("rejects an unknown property id in listProps", () => {
    const r = setupDatabase();
    assert400(() =>
      r.views.setViews(r.database.id, {
        list: { listProps: ["unknown"] },
      }),
    );
  });

  it("rejects a non-finite number filter value", () => {
    const r = setupDatabase();
    assert400(() =>
      r.views.setViews(r.database.id, {
        table: {
          filters: [
            { id: "f1", propertyId: r.number.id, op: "gt", value: Infinity },
          ],
        },
      }),
    );
    assert400(() =>
      r.views.setViews(r.database.id, {
        table: {
          filters: [
            { id: "f1", propertyId: r.number.id, op: "gt", value: "5" },
          ],
        },
      }),
    );
  });

  it("rejects a malformed date filter value", () => {
    const r = setupDatabase();
    assert400(() =>
      r.views.setViews(r.database.id, {
        table: {
          filters: [
            { id: "f1", propertyId: r.date.id, op: "before", value: "2024-13-40" },
          ],
        },
      }),
    );
    assert400(() =>
      r.views.setViews(r.database.id, {
        table: {
          filters: [
            { id: "f1", propertyId: r.date.id, op: "before", value: "2024/01/01" },
          ],
        },
      }),
    );
  });

  it("accepts a valid date filter value", () => {
    const r = setupDatabase();
    const result = r.views.setViews(r.database.id, {
      table: {
        filters: [
          { id: "f1", propertyId: r.date.id, op: "before", value: "2024-01-15" },
        ],
      },
    });
    expect(result.table.filters[0].value).toBe("2024-01-15");
  });

  it("rejects a bad activeView", () => {
    const r = setupDatabase();
    assert400(() =>
      r.views.setViews(r.database.id, { activeView: "gallery" }),
    );
    assert400(() =>
      r.views.setViews(r.database.id, { activeView: 42 } as unknown as { activeView: unknown }),
    );
  });

  it("rejects groupBy on a non-existent property", () => {
    const r = setupDatabase();
    assert400(() =>
      r.views.setViews(r.database.id, { board: { groupBy: "ghost" } }),
    );
  });

  it("rejects a checkbox filter value that is not a boolean", () => {
    const r = setupDatabase();
    assert400(() =>
      r.views.setViews(r.database.id, {
        table: {
          filters: [
            { id: "f1", propertyId: r.checkbox.id, op: "is", value: "yes" },
          ],
        },
      }),
    );
  });

  it("rejects a multiSelect filter with an option id from another property", () => {
    const r = setupDatabase();
    // 'a' is an option of select, not of multi.
    assert400(() =>
      r.views.setViews(r.database.id, {
        table: {
          filters: [
            { id: "f1", propertyId: r.multi.id, op: "contains", value: "a" },
          ],
        },
      }),
    );
  });

  it("validates every field before any write", () => {
    const r = setupDatabase();
    // A bad board.groupBy plus a good table sort: nothing should be written.
    try {
      r.views.setViews(r.database.id, {
        table: { sort: { propertyId: r.number.id, direction: "asc" } },
        board: { groupBy: r.number.id },
      });
    } catch {
      // expected
    }
    const views = r.views.getViews(r.database.id);
    expect(views.table.sort).toBeNull(); // not written
    expect(views.board.groupBy).toBe(r.select.id); // unchanged default
  });
});

describe("ViewRepository — 404 on non-database", () => {
  it("setViews throws 404 for a non-database page", () => {
    const r = newRepos();
    const page = r.pages.create({ title: "Page" });
    assert404(() =>
      r.views.setViews(page.id, { activeView: "table" }),
    );
  });

  it("setViews throws 404 for an unknown id", () => {
    const r = newRepos();
    assert404(() => r.views.setViews("missing", { activeView: "table" }));
  });
});

describe("seeded views", () => {
  function seeded() {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const pages = new PageRepository(db);
    const blocks = new BlockRepository(db);
    const dbs = new DatabaseRepository(db, pages);
    const views = new ViewRepository(db, dbs);
    return { db, pages, blocks, dbs, views };
  }

  it("seeds three configured view_settings rows", () => {
    const r = seeded();
    const rows = r.db
      .prepare(
        "SELECT database_id, view_kind FROM view_settings ORDER BY database_id, view_kind",
      )
      .all() as { database_id: string; view_kind: string }[];
    expect(rows).toEqual([
      { database_id: "packing-list", view_kind: "list" },
      { database_id: "packing-list", view_kind: "table" },
      { database_id: "project-tracker", view_kind: "board" },
      { database_id: "reading-list", view_kind: "list" },
      { database_id: "reading-list", view_kind: "table" },
    ]);
  });

  it("Packing List opens on a list view showing Category and Packed, table sorted by Packed asc", () => {
    const r = seeded();
    const views = r.views.getViews("packing-list");
    expect(views.activeView).toBe("list");
    expect(views.list.listProps).toEqual([
      "packing-prop-category",
      "packing-prop-packed",
    ]);
    expect(views.table.sort).toEqual({
      propertyId: "packing-prop-packed",
      direction: "asc",
    });
  });

  it("Project Tracker opens on a board grouped by Status, sorted by Priority asc", () => {
    const r = seeded();
    const views = r.views.getViews("project-tracker");
    expect(views.activeView).toBe("board");
    expect(views.board.groupBy).toBe("project-prop-status");
    expect(views.board.sort).toEqual({
      propertyId: "project-prop-priority",
      direction: "asc",
    });
    expect(views.board.filters).toEqual([]);
  });

  it("Reading List table is sorted by Rating desc and filtered Status is-not 'Want to read'", () => {
    const r = seeded();
    const views = r.views.getViews("reading-list");
    expect(views.activeView).toBe("table");
    expect(views.table.sort).toEqual({
      propertyId: "reading-prop-rating",
      direction: "desc",
    });
    expect(views.table.filters).toEqual([
      {
        id: "reading-filter-status",
        propertyId: "reading-prop-status",
        op: "is-not",
        value: "reading-opt-want",
      },
    ]);
  });

  it("Reading List list view shows Author and Status", () => {
    const r = seeded();
    const views = r.views.getViews("reading-list");
    expect(views.list.listProps).toEqual([
      "reading-prop-author",
      "reading-prop-status",
    ]);
  });

  it("deleting a database cascades to its view settings and active meta", () => {
    const r = seeded();
    r.pages.remove("project-tracker");
    // view_settings rows gone.
    const rows = r.db
      .prepare("SELECT * FROM view_settings WHERE database_id = ?")
      .all("project-tracker");
    expect(rows).toEqual([]);
    // activeView meta key gone.
    const meta = r.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get("views:active:project-tracker");
    expect(meta).toBeUndefined();
    // GET now 404s.
    assert404(() => r.views.getViews("project-tracker"));
  });
});

// ---- property delete scrubs view settings (DEF-012) ----

describe("removeProperty scrubs view settings (DEF-012)", () => {
  /**
   * Build a database whose three views each reference the to-be-deleted
   * property `victim` in filters (table and board), sort (table), groupBy
   * (board), and listProps (list). A second property `other` is referenced
   * alongside in every collection, so the test can assert only the victim's
   * references are removed and the others survive.
   */
  function setupReferencing(
    victimType: "text" | "select" = "select",
  ): {
    database: ReturnType<PageRepository["create"]>;
    victim: Property;
    otherSelect: Property;
    otherText: Property;
    otherNumber: Property;
    pages: PageRepository;
    dbs: DatabaseRepository;
    views: ViewRepository;
  } {
    const r = newRepos();
    const database = r.pages.create({ title: "DB", type: "database" });
    // A select that will survive, used as the surviving groupBy / filter.
    const otherSelect = r.dbs.updateProperty(
      r.dbs.createProperty(database.id, { name: "OtherSel", type: "select" }).id,
      {
        options: [
          { id: "a", label: "A", color: "red" },
          { id: "b", label: "B", color: "blue" },
        ],
      },
    );
    const otherText = r.dbs.createProperty(database.id, {
      name: "OtherText",
      type: "text",
    });
    const otherNumber = r.dbs.createProperty(database.id, {
      name: "OtherNum",
      type: "number",
    });
    const victim =
      victimType === "select"
        ? r.dbs.updateProperty(
            r.dbs
              .createProperty(database.id, { name: "Victim", type: "select" })
              .id,
            { options: [{ id: "x", label: "X", color: "red" }] },
          )
        : r.dbs.createProperty(database.id, { name: "Victim", type: "text" });

    // Table: two filters (victim + otherSelect), sort on victim.
    const tableFilters =
      victimType === "select"
        ? [
            { id: "fv", propertyId: victim.id, op: "is", value: "x" },
            { id: "fo", propertyId: otherSelect.id, op: "is", value: "a" },
          ]
        : [
            { id: "fv", propertyId: victim.id, op: "contains", value: "zzz" },
            {
              id: "fo",
              propertyId: otherSelect.id,
              op: "is",
              value: "a",
            },
          ];
    r.views.setViews(database.id, {
      table: {
        filters: tableFilters,
        sort: { propertyId: victim.id, direction: "asc" },
      },
    });
    // Board: groupBy victim, a filter on victim + a filter on otherText,
    // and a sort on otherText (to keep something board-specific alive).
    const boardFilters =
      victimType === "select"
        ? [
            { id: "bv", propertyId: victim.id, op: "is", value: "x" },
            {
              id: "bo",
              propertyId: otherText.id,
              op: "contains",
              value: "keep",
            },
          ]
        : [
            {
              id: "bv",
              propertyId: victim.id,
              op: "contains",
              value: "zzz",
            },
            {
              id: "bo",
              propertyId: otherText.id,
              op: "contains",
              value: "keep",
            },
          ];
    r.views.setViews(database.id, {
      board: {
        filters: boardFilters,
        groupBy: victimType === "select" ? victim.id : otherSelect.id,
        sort: { propertyId: otherText.id, direction: "desc" },
      },
    });
    // List: listProps victim + otherNumber + otherText.
    r.views.setViews(database.id, {
      list: {
        listProps: [victim.id, otherNumber.id, otherText.id],
      },
    });
    return {
      pages: r.pages,
      dbs: r.dbs,
      views: r.views,
      database,
      victim,
      otherSelect,
      otherText,
      otherNumber,
    };
  }

  it("removes victim filters/sort/groupBy/listProps and keeps the rest", () => {
    const s = setupReferencing("select");
    const before = s.views.getViews(s.database.id);
    // Sanity: victim is referenced everywhere we expect.
    expect(before.table.filters.map((f) => f.id)).toEqual(["fv", "fo"]);
    expect(before.table.sort!.propertyId).toBe(s.victim.id);
    expect(before.board.groupBy).toBe(s.victim.id);
    expect(before.list.listProps).toEqual([
      s.victim.id,
      s.otherNumber.id,
      s.otherText.id,
    ]);

    s.dbs.removeProperty(s.victim.id);

    const after = s.views.getViews(s.database.id);

    // table: victim filter dropped, other filter kept; sort cleared.
    expect(after.table.filters).toEqual([
      {
        id: "fo",
        propertyId: s.otherSelect.id,
        op: "is",
        value: "a",
      },
    ]);
    expect(after.table.sort).toBeNull();
    expect(after.table.groupBy).toBeNull();
    expect(after.table.listProps).toEqual([]);

    // board: victim filter dropped, other filter kept; groupBy cleared
    // (victim was select and is gone); otherText sort survives.
    expect(after.board.filters).toEqual([
      {
        id: "bo",
        propertyId: s.otherText.id,
        op: "contains",
        value: "keep",
      },
    ]);
    expect(after.board.groupBy).toBeNull();
    expect(after.board.sort).toEqual({
      propertyId: s.otherText.id,
      direction: "desc",
    });

    // list: victim pruned from listProps, the other two stay in order.
    expect(after.list.listProps).toEqual([
      s.otherNumber.id,
      s.otherText.id,
    ]);
    expect(after.list.filters).toEqual([]);
    expect(after.list.sort).toBeNull();
    expect(after.list.groupBy).toBeNull();
  });

  it("also scrubs for a text victim (filters use 'contains')", () => {
    const s = setupReferencing("text");
    // board.groupBy for a text victim defaults to otherSelect (no select
    // victim), so the board has nothing to scrub on groupBy here; the test
    // still exercises filter/sort/listProps scrubbing for a non-select victim.
    s.dbs.removeProperty(s.victim.id);
    const after = s.views.getViews(s.database.id);
    expect(after.table.filters.map((f) => f.id)).toEqual(["fo"]);
    expect(after.table.sort).toBeNull();
    expect(after.list.listProps).toEqual([
      s.otherNumber.id,
      s.otherText.id,
    ]);
  });

  it("deleting an unreferenced property changes no view settings", () => {
    const s = setupReferencing("select");
    // Create an extra property that nothing references, then delete it.
    const lonely = s.dbs.createProperty(s.database.id, {
      name: "Lonely",
      type: "checkbox",
    });
    const before = JSON.stringify(s.views.getViews(s.database.id));

    s.dbs.removeProperty(lonely.id);

    const after = JSON.stringify(s.views.getViews(s.database.id));
    expect(after).toBe(before);
  });

  it("leaves other databases' view settings untouched", () => {
    const s = setupReferencing("select");
    // A second database with its own views referencing its own property.
    const db2 = s.pages.create({ title: "DB2", type: "database" });
    const db2Sel = s.dbs.updateProperty(
      s.dbs.createProperty(db2.id, { name: "S", type: "select" }).id,
      { options: [{ id: "a", label: "A", color: "red" }] },
    );
    s.views.setViews(db2.id, {
      table: {
        filters: [
          { id: "f", propertyId: db2Sel.id, op: "is", value: "a" },
        ],
        sort: { propertyId: db2Sel.id, direction: "asc" },
      },
    });
    const db2Before = JSON.stringify(s.views.getViews(db2.id));

    s.dbs.removeProperty(s.victim.id);

    const db2After = JSON.stringify(s.views.getViews(db2.id));
    expect(db2After).toBe(db2Before);
  });
});

// ---- helpers ----

function assert400(fn: () => unknown): void {
  let status = 0;
  try {
    fn();
  } catch (e) {
    if (e instanceof DatabaseError) status = e.status;
  }
  expect(status).toBe(400);
}

function assert404(fn: () => unknown): void {
  let status = 0;
  try {
    fn();
  } catch (e) {
    if (e instanceof DatabaseError) status = e.status;
  }
  expect(status).toBe(404);
}
