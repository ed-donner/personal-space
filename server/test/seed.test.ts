import { describe, it, expect } from "vitest";
import { openDb } from "../src/db.js";
import { PageRepository } from "../src/pages.js";
import { BlockRepository, BLOCK_TYPES } from "../src/blocks.js";
import { DatabaseRepository } from "../src/databases.js";
import { ViewRepository } from "../src/views.js";
import { seedIfEmpty } from "../src/seed.js";

/**
 * Phase 5 seed showcase assertions: the seeded workspace demonstrably
 * exercises every block type, every property type, several databases, at
 * least one configured filter, one configured sort, a board groupBy, and
 * pages nested at least three levels deep.
 */
describe("seed showcase (Phase 5)", () => {
  function seeded() {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    return {
      db,
      pages: new PageRepository(db),
      blocks: new BlockRepository(db),
      dbs: new DatabaseRepository(db, new PageRepository(db)),
      views: new ViewRepository(db, new DatabaseRepository(db, new PageRepository(db))),
    };
  }

  it("contains all 11 block types across its pages", () => {
    const r = seeded();
    const seen = new Set<string>();
    for (const p of r.pages.list()) {
      for (const b of r.blocks.list(p.id)) seen.add(b.type);
    }
    expect(seen.size).toBe(11);
    for (const t of BLOCK_TYPES) {
      expect(seen.has(t)).toBe(true);
    }
  });

  it("contains all 7 property types across its databases", () => {
    const r = seeded();
    const types = new Set<string>();
    for (const p of r.pages.list()) {
      if (p.type !== "database") continue;
      for (const prop of r.dbs.listProperties(p.id)) {
        types.add(prop.type);
      }
    }
    expect(types.size).toBe(7);
    for (const t of [
      "text",
      "number",
      "select",
      "multiSelect",
      "date",
      "checkbox",
      "url",
    ]) {
      expect(types.has(t)).toBe(true);
    }
  });

  it("contains at least 3 databases", () => {
    const r = seeded();
    const dbs = r.pages.list().filter((p) => p.type === "database");
    expect(dbs.length).toBeGreaterThanOrEqual(3);
    expect(dbs.map((d) => d.title).sort()).toEqual([
      "Packing List",
      "Project Tracker",
      "Reading List",
    ]);
  });

  it("has at least 1 configured filter (Reading List table)", () => {
    const r = seeded();
    const views = r.views.getViews("reading-list");
    expect(views.table.filters.length).toBeGreaterThanOrEqual(1);
  });

  it("has at least 1 configured sort (Reading List table, Rating desc)", () => {
    const r = seeded();
    const views = r.views.getViews("reading-list");
    expect(views.table.sort).not.toBeNull();
  });

  it("has at least 1 board groupBy (Project Tracker board, by Status)", () => {
    const r = seeded();
    const views = r.views.getViews("project-tracker");
    expect(views.board.groupBy).not.toBeNull();
  });

  it("nests pages at least 3 levels deep", () => {
    const r = seeded();
    const pages = r.pages.list();
    const byId = new Map(pages.map((p) => [p.id, p]));

    // notes > journal > journal-2024-03 = depth 3 under root.
    const entry = byId.get("journal-2024-03")!;
    expect(byId.get(entry.parentId!)!.id).toBe("journal");
    expect(byId.get(byId.get(entry.parentId!)!.parentId!)!.id).toBe("notes");
    expect(byId.get(byId.get(byId.get(entry.parentId!)!.parentId!)!.parentId!)).toBeUndefined();

    // projects > website-redesign > launch-checklist = depth 3 under root.
    const lc = byId.get("launch-checklist")!;
    expect(byId.get(lc.parentId!)!.id).toBe("website-redesign");
    expect(byId.get(byId.get(lc.parentId!)!.parentId!)!.id).toBe("projects");

    // travel > tokyo-trip > packing-list (a database!) = depth 3 under root.
    const pl = byId.get("packing-list")!;
    expect(byId.get(pl.parentId!)!.id).toBe("tokyo-trip");
    expect(byId.get(byId.get(pl.parentId!)!.parentId!)!.id).toBe("travel");
    expect(pl.type).toBe("database");
  });
});
