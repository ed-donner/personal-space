import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../src/db.js";
import {
  PageRepository,
  PageError,
  MAX_TITLE_LENGTH,
} from "../src/pages.js";
import { seedIfEmpty } from "../src/seed.js";
import type { Page } from "../src/types.js";

function newRepo(): PageRepository {
  const db = openDb(":memory:");
  return new PageRepository(db);
}

function find(pages: Page[], id: string): Page | undefined {
  return pages.find((p) => p.id === id);
}

describe("PageRepository.list", () => {
  it("returns the seeded tree flat, ordered by position then id", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const repo = new PageRepository(db);

    const pages = repo.list();
    // 44 seeded pages: 19 base pages/databases + 25 rows across the 3 seeded
    // databases (Reading List 8, Project Tracker 8, Packing List 9).
    expect(pages).toHaveLength(44);
    // Roots come in their declared order (positions 0..4).
    const rootTitles = pages
      .filter((p) => p.parentId === null)
      .map((p) => p.title);
    expect(rootTitles).toEqual([
      "Home",
      "Projects",
      "Reading List",
      "Travel",
      "Notes",
    ]);
    // Every page has a non-empty icon from the seed.
    expect(pages.every((p) => p.icon.length > 0)).toBe(true);
    // Every position is non-negative and per-sibling ordered.
    const byParent = new Map<string | null, Page[]>();
    for (const p of pages) {
      const arr = byParent.get(p.parentId) ?? [];
      arr.push(p);
      byParent.set(p.parentId, arr);
    }
    for (const siblings of byParent.values()) {
      const positions = siblings.map((s) => s.position);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});

describe("PageRepository.create", () => {
  let repo: PageRepository;
  beforeEach(() => {
    repo = newRepo();
  });

  it("applies defaults: title 'Untitled', icon '', type 'page'", () => {
    const page = repo.create({});
    expect(page.title).toBe("Untitled");
    expect(page.icon).toBe("");
    expect(page.type).toBe("page");
    expect(page.parentId).toBeNull();
    expect(page.position).toBe(0);
    expect(page.id).toMatch(/^[0-9a-f-]{36}$/i); // uuid
  });

  it("places a new page at the end of its sibling list", () => {
    const a = repo.create({ title: "A" });
    const b = repo.create({ title: "B" });
    const c = repo.create({ title: "C" });
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
    expect(c.position).toBe(2);
  });

  it("scopes position per-sibling (root vs child lists are independent)", () => {
    const parent = repo.create({ title: "Parent" });
    const childA = repo.create({ parentId: parent.id, title: "ChildA" });
    const childB = repo.create({ parentId: parent.id, title: "ChildB" });
    const otherRoot = repo.create({ title: "Other" });
    expect(childA.position).toBe(0);
    expect(childB.position).toBe(1);
    expect(otherRoot.position).toBe(1); // root list: Parent(0), Other(1)
  });

  it("accepts an optional type 'database'", () => {
    const db = repo.create({ title: "Tasks DB", type: "database" });
    expect(db.type).toBe("database");
  });

  it("rejects an unknown parentId with a 400 PageError", () => {
    try {
      repo.create({ parentId: "does-not-exist" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
  });

  it("treats parentId: null the same as omitting it", () => {
    const page = repo.create({ parentId: null, title: "Root" });
    expect(page.parentId).toBeNull();
    expect(page.position).toBe(0);
  });
});

describe("PageRepository.update", () => {
  let repo: PageRepository;
  beforeEach(() => {
    repo = newRepo();
  });

  it("renames a page via title patch", () => {
    const page = repo.create({ title: "Old" });
    const updated = repo.update(page.id, { title: "New" });
    expect(updated.title).toBe("New");
    expect(updated.id).toBe(page.id);
    // Persisted.
    expect(find(repo.list(), page.id)!.title).toBe("New");
  });

  it("updates the icon", () => {
    const page = repo.create({ title: "P", icon: "" });
    const updated = repo.update(page.id, { icon: "\u{1F3E0}" });
    expect(updated.icon).toBe("\u{1F3E0}");
  });

  it("patches only the provided fields, leaving the rest intact", () => {
    const page = repo.create({ title: "P", icon: "\u{1F310}", type: "page" });
    const updated = repo.update(page.id, { title: "Renamed" });
    expect(updated.icon).toBe("\u{1F310}");
    expect(updated.type).toBe("page");
    expect(updated.parentId).toBeNull();
  });

  it("returns 404 for an unknown id", () => {
    try {
      repo.update("nope", { title: "x" });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PageError).status).toBe(404);
    }
  });

  it("reparents a page to an existing parent", () => {
    const a = repo.create({ title: "A" });
    const b = repo.create({ title: "B" });
    const updated = repo.update(a.id, { parentId: b.id });
    expect(updated.parentId).toBe(b.id);
    expect(find(repo.list(), a.id)!.parentId).toBe(b.id);
  });

  it("reparents back to the root with parentId: null", () => {
    const root = repo.create({ title: "Root" });
    const child = repo.create({ parentId: root.id, title: "Child" });
    const updated = repo.update(child.id, { parentId: null });
    expect(updated.parentId).toBeNull();
  });

  it("rejects reparenting a page under itself (cycle)", () => {
    const a = repo.create({ title: "A" });
    try {
      repo.update(a.id, { parentId: a.id });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PageError).status).toBe(400);
    }
  });

  it("rejects reparenting a page under a direct descendant (cycle)", () => {
    const root = repo.create({ title: "Root" });
    const child = repo.create({ parentId: root.id, title: "Child" });
    const grandchild = repo.create({
      parentId: child.id,
      title: "Grandchild",
    });
    // root -> child (no cycle yet)
    // Trying to put root under grandchild would create a cycle.
    try {
      repo.update(root.id, { parentId: grandchild.id });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PageError).status).toBe(400);
    }
  });

  it("rejects reparenting under a deep descendant (multi-level cycle)", () => {
    const root = repo.create({ title: "Root" });
    const c1 = repo.create({ parentId: root.id, title: "c1" });
    const c2 = repo.create({ parentId: c1.id, title: "c2" });
    const c3 = repo.create({ parentId: c2.id, title: "c3" });
    try {
      repo.update(root.id, { parentId: c3.id });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PageError).status).toBe(400);
    }
  });

  it("rejects reparenting under an unknown parentId (400)", () => {
    const a = repo.create({ title: "A" });
    try {
      repo.update(a.id, { parentId: "ghost" });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PageError).status).toBe(400);
    }
  });

  it("accepts a position patch", () => {
    const a = repo.create({ title: "A" });
    const updated = repo.update(a.id, { position: 42 });
    expect(updated.position).toBe(42);
    expect(find(repo.list(), a.id)!.position).toBe(42);
  });
});

describe("PageRepository.remove", () => {
  let repo: PageRepository;
  beforeEach(() => {
    repo = newRepo();
  });

  it("deletes a single leaf page", () => {
    const a = repo.create({ title: "A" });
    repo.remove(a.id);
    expect(repo.list()).toHaveLength(0);
  });

  it("returns 404 for an unknown id", () => {
    try {
      repo.remove("nope");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PageError).status).toBe(404);
    }
  });

  it("cascades deletion to direct children", () => {
    const root = repo.create({ title: "Root" });
    const c1 = repo.create({ parentId: root.id, title: "c1" });
    const c2 = repo.create({ parentId: root.id, title: "c2" });
    const other = repo.create({ title: "other" });

    repo.remove(root.id);
    const ids = repo.list().map((p) => p.id);
    expect(ids).not.toContain(root.id);
    expect(ids).not.toContain(c1.id);
    expect(ids).not.toContain(c2.id);
    expect(ids).toContain(other.id);
  });

  it("cascades deletion across multiple levels", () => {
    const root = repo.create({ title: "Root" });
    const c1 = repo.create({ parentId: root.id, title: "c1" });
    const c1a = repo.create({ parentId: c1.id, title: "c1a" });
    const c1a1 = repo.create({ parentId: c1a.id, title: "c1a1" });
    const c1b = repo.create({ parentId: c1.id, title: "c1b" });
    const sibling = repo.create({ title: "sibling" });

    repo.remove(root.id);
    const remaining = repo.list().map((p) => p.id);
    expect(remaining).toEqual([sibling.id]);
    for (const gone of [root.id, c1.id, c1a.id, c1a1.id, c1b.id]) {
      expect(remaining).not.toContain(gone);
    }
  });

  it("deleting a child leaves the parent and siblings intact", () => {
    const root = repo.create({ title: "Root" });
    const keep = repo.create({ parentId: root.id, title: "keep" });
    const drop = repo.create({ parentId: root.id, title: "drop" });
    repo.remove(drop.id);
    const ids = repo.list().map((p) => p.id);
    expect(ids).toContain(root.id);
    expect(ids).toContain(keep.id);
    expect(ids).not.toContain(drop.id);
  });
});

describe("seedIfEmpty", () => {
  it("is idempotent: running twice never duplicates data", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const first = new PageRepository(db).list();
    seedIfEmpty(db); // second call should be a no-op
    const second = new PageRepository(db).list();
    expect(second).toEqual(first);
    expect(second).toHaveLength(44);
  });

  it("seeds at least three levels deep", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const repo = new PageRepository(db);
    const pages = repo.list();
    const byId = new Map(pages.map((p) => [p.id, p]));
    // projects > website-redesign > launch-checklist = depth 3.
    const lc = byId.get("launch-checklist")!;
    expect(byId.get(lc.parentId!)!.id).toBe("website-redesign");
    expect(byId.get(byId.get(lc.parentId!)!.parentId!)!.id).toBe("projects");
  });

  it("does not re-seed after all pages are deleted (seed-once via meta)", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const repo = new PageRepository(db);
    expect(repo.list()).toHaveLength(44);

    // Simulate the user deliberately emptying the workspace.
    const ids = repo.list().map((p) => p.id);
    for (const id of ids) {
      const stillThere = repo.findById(id);
      if (stillThere) repo.remove(id);
    }
    expect(repo.list()).toHaveLength(0);

    // Re-running the seed check must leave it empty (DEF-003).
    seedIfEmpty(db);
    expect(repo.list()).toEqual([]);
  });
});

describe("title validation (DEF-001, DEF-002)", () => {
  let repo: PageRepository;
  beforeEach(() => {
    repo = newRepo();
  });

  // ---- DEF-001: empty / whitespace titles ----

  it("POST rejects an empty title with 400", () => {
    try {
      repo.create({ title: "" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
  });

  it("POST rejects a whitespace-only title with 400", () => {
    try {
      repo.create({ title: "   " });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
  });

  it("POST with no title field still defaults to 'Untitled'", () => {
    const page = repo.create({});
    expect(page.title).toBe("Untitled");
  });

  it("POST trims a non-empty title and stores the trimmed value", () => {
    const page = repo.create({ title: "  Hello  " });
    expect(page.title).toBe("Hello");
    expect(find(repo.list(), page.id)!.title).toBe("Hello");
  });

  it("PATCH rejects an empty title with 400", () => {
    const page = repo.create({ title: "Original" });
    try {
      repo.update(page.id, { title: "" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
    // Existing title is unchanged.
    expect(find(repo.list(), page.id)!.title).toBe("Original");
  });

  it("PATCH rejects a whitespace-only title with 400", () => {
    const page = repo.create({ title: "Original" });
    try {
      repo.update(page.id, { title: "   " });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
    expect(find(repo.list(), page.id)!.title).toBe("Original");
  });

  it("PATCH trims a non-empty title and stores the trimmed value", () => {
    const page = repo.create({ title: "Original" });
    const updated = repo.update(page.id, { title: "  New Name  " });
    expect(updated.title).toBe("New Name");
    expect(find(repo.list(), page.id)!.title).toBe("New Name");
  });

  it("PATCH with no title field leaves the title intact", () => {
    const page = repo.create({ title: "Keep" });
    const updated = repo.update(page.id, { icon: "x" });
    expect(updated.title).toBe("Keep");
  });

  // ---- DEF-002: title length bound ----

  it(`POST rejects a title over ${MAX_TITLE_LENGTH} chars (201+) with 400`, () => {
    const long = "A".repeat(MAX_TITLE_LENGTH + 1);
    expect(long.length).toBe(MAX_TITLE_LENGTH + 1);
    try {
      repo.create({ title: long });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
  });

  it(`POST accepts a title of exactly ${MAX_TITLE_LENGTH} chars`, () => {
    const exact = "A".repeat(MAX_TITLE_LENGTH);
    expect(exact.length).toBe(MAX_TITLE_LENGTH);
    const page = repo.create({ title: exact });
    expect(page.title).toBe(exact);
    expect(page.title.length).toBe(MAX_TITLE_LENGTH);
  });

  it(`PATCH rejects a title over ${MAX_TITLE_LENGTH} chars with 400`, () => {
    const page = repo.create({ title: "Original" });
    const long = "B".repeat(MAX_TITLE_LENGTH + 1);
    try {
      repo.update(page.id, { title: long });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
    expect(find(repo.list(), page.id)!.title).toBe("Original");
  });

  it(`PATCH accepts a title of exactly ${MAX_TITLE_LENGTH} chars`, () => {
    const page = repo.create({ title: "Original" });
    const exact = "B".repeat(MAX_TITLE_LENGTH);
    const updated = repo.update(page.id, { title: exact });
    expect(updated.title).toBe(exact);
    expect(updated.title.length).toBe(MAX_TITLE_LENGTH);
  });

  it("the length bound is measured after trimming", () => {
    // 199 visible chars + leading/trailing spaces -> trimmed length 199, OK.
    const padded = "  " + "C".repeat(MAX_TITLE_LENGTH - 1) + "  ";
    const page = repo.create({ title: padded });
    expect(page.title).toBe("C".repeat(MAX_TITLE_LENGTH - 1));
    expect(page.title.length).toBe(MAX_TITLE_LENGTH - 1);
  });
});

// ---- row reparenting blocked (DEF-009) ----

describe("row reparenting is blocked (DEF-009)", () => {
  let repo: PageRepository;
  beforeEach(() => {
    repo = newRepo();
  });

  it("rejects reparenting a row to the root with 400", () => {
    const database = repo.create({ title: "DB", type: "database" });
    // Create a row directly under the database (the rows API path).
    const row = repo.create({
      parentId: database.id,
      type: "row",
      title: "Row1",
    });
    try {
      repo.update(row.id, { parentId: null });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
    // Row still under the database.
    expect(find(repo.list(), row.id)!.parentId).toBe(database.id);
  });

  it("rejects reparenting a row to another database with 400", () => {
    const db1 = repo.create({ title: "DB1", type: "database" });
    const db2 = repo.create({ title: "DB2", type: "database" });
    const row = repo.create({
      parentId: db1.id,
      type: "row",
      title: "Row1",
    });
    try {
      repo.update(row.id, { parentId: db2.id });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
    expect(find(repo.list(), row.id)!.parentId).toBe(db1.id);
  });

  it("rejects reparenting a row to a regular page with 400", () => {
    const database = repo.create({ title: "DB", type: "database" });
    const page = repo.create({ title: "Page" });
    const row = repo.create({
      parentId: database.id,
      type: "row",
      title: "Row1",
    });
    try {
      repo.update(row.id, { parentId: page.id });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
  });

  it("allows title and icon patches on a row (no reparent)", () => {
    const database = repo.create({ title: "DB", type: "database" });
    const row = repo.create({
      parentId: database.id,
      type: "row",
      title: "Row1",
    });
    const renamed = repo.update(row.id, { title: "Renamed Row" });
    expect(renamed.title).toBe("Renamed Row");
    const reiconed = repo.update(row.id, { icon: "\u{1F539}" });
    expect(reiconed.icon).toBe("\u{1F539}");
    // Still under its database.
    expect(find(repo.list(), row.id)!.parentId).toBe(database.id);
  });
});

// ---- only rows may live under a database (DEF-010) ----

describe("database children must be rows (DEF-010)", () => {
  let repo: PageRepository;
  beforeEach(() => {
    repo = newRepo();
  });

  it("POST rejects a non-row page under a database with 400", () => {
    const database = repo.create({ title: "DB", type: "database" });
    try {
      repo.create({
        parentId: database.id,
        type: "page",
        title: "Orphan page",
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
      expect((err as PageError).message).toBe(
        "database children must be rows",
      );
    }
    expect(repo.list().length).toBe(1); // only the database itself
  });

  it("POST rejects a database-under-database with 400", () => {
    const database = repo.create({ title: "DB", type: "database" });
    try {
      repo.create({
        parentId: database.id,
        type: "database",
        title: "Inner DB",
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
  });

  it("POST still allows creating a row directly under a database", () => {
    const database = repo.create({ title: "DB", type: "database" });
    const row = repo.create({
      parentId: database.id,
      type: "row",
      title: "Row via pages API",
    });
    expect(row.type).toBe("row");
    expect(row.parentId).toBe(database.id);
  });

  it("PATCH rejects reparenting a regular page under a database with 400", () => {
    const database = repo.create({ title: "DB", type: "database" });
    const page = repo.create({ title: "Page" });
    try {
      repo.update(page.id, { parentId: database.id });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
      expect((err as PageError).message).toBe(
        "database children must be rows",
      );
    }
    // Page still at root.
    expect(find(repo.list(), page.id)!.parentId).toBeNull();
  });

  it("PATCH rejects reparenting a database page under another database with 400", () => {
    const db1 = repo.create({ title: "DB1", type: "database" });
    const db2 = repo.create({ title: "DB2", type: "database" });
    try {
      repo.update(db1.id, { parentId: db2.id });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PageError);
      expect((err as PageError).status).toBe(400);
    }
  });

  it("PATCH still allows reparenting a regular page under another regular page", () => {
    const a = repo.create({ title: "A" });
    const b = repo.create({ title: "B" });
    const updated = repo.update(a.id, { parentId: b.id });
    expect(updated.parentId).toBe(b.id);
  });
});

