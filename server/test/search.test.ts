import { describe, it, expect } from "vitest";
import { openDb } from "../src/db.js";
import { PageRepository } from "../src/pages.js";
import { BlockRepository } from "../src/blocks.js";
import { DatabaseRepository } from "../src/databases.js";
import { ViewRepository } from "../src/views.js";
import { SearchRepository, SEARCH_LIMIT } from "../src/search.js";
import { seedIfEmpty } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** Fresh repos backed by an in-memory database. */
function newRepos() {
  const db = openDb(":memory:");
  const pages = new PageRepository(db);
  const blocks = new BlockRepository(db);
  const dbs = new DatabaseRepository(db, pages);
  const views = new ViewRepository(db, dbs);
  const search = new SearchRepository(db);
  return { db, pages, blocks, dbs, views, search };
}

describe("SearchRepository.search", () => {
  it("matches across pages, databases and rows", () => {
    const r = newRepos();
    // Build a small workspace where one page, one database and one row all
    // share "alpha" in their title, so a single query hits all three types.
    const home = r.pages.create({ title: "Home" });
    const page = r.pages.create({ title: "Alpha Page", parentId: home.id });
    const db = r.pages.create({
      title: "Alpha Database",
      type: "database",
      parentId: home.id,
    });
    const row = r.dbs.createRow(db.id, { title: "Alpha Row" });

    const hits = r.search.search("Alpha");
    const byId = new Map(hits.map((h) => [h.id, h]));

    // All three types appear.
    expect(byId.get(page.id)!.type).toBe("page");
    expect(byId.get(db.id)!.type).toBe("database");
    expect(byId.get(row.id)!.type).toBe("row");

    // The row hit carries its database's title as parentTitle.
    expect(byId.get(row.id)!.parentTitle).toBe("Alpha Database");
    expect(byId.get(row.id)!.parentId).toBe(db.id);

    // The nested page carries its parent page's title.
    expect(byId.get(page.id)!.parentTitle).toBe("Home");
  });

  it("matches case-insensitively", () => {
    const r = newRepos();
    seedIfEmpty(r.db);
    const lower = r.search.search("tokyo").map((h) => h.id);
    const upper = r.search.search("TOKYO").map((h) => h.id);
    const mixed = r.search.search("ToKyO").map((h) => h.id);
    expect(upper).toEqual(lower);
    expect(mixed).toEqual(lower);
    expect(lower).toContain("tokyo-trip");
  });

  it("ranks exact > starts-with > contains", () => {
    const r = newRepos();
    // Build a small workspace so the ranking is unambiguous:
    //   - "Recipes"             (exact match for q "Recipes")
    //   - "Recipes Index"       (starts-with)
    //   - "Favorite Recipes"    (contains, also longer)
    //   - "Italian Recipes 2"  (contains, longer still)
    const home = r.pages.create({ title: "Home" });
    r.pages.create({ title: "Recipes", parentId: home.id });
    r.pages.create({ title: "Recipes Index", parentId: home.id });
    r.pages.create({ title: "Favorite Recipes", parentId: home.id });
    r.pages.create({ title: "Italian Recipes 2", parentId: home.id });

    const hits = r.search.search("Recipes");
    expect(hits.map((h) => h.title)).toEqual([
      "Recipes",
      "Recipes Index",
      "Favorite Recipes",
      "Italian Recipes 2",
    ]);
  });

  it("breaks rank ties by shorter title, then alphabetical", () => {
    const r = newRepos();
    const home = r.pages.create({ title: "Home" });
    // Three contains matches, equal rank. Two have the SAME length so the
    // alphabetical tie-break is exercised; the third is longer.
    //   "Cat Read"   (8)  alphabetical first among the length-8 pair
    //   "Dog Read"   (8)  alphabetical second
    //   "Zebra Read" (10) longer, comes last
    r.pages.create({ title: "Cat Read", parentId: home.id });
    r.pages.create({ title: "Dog Read", parentId: home.id });
    r.pages.create({ title: "Zebra Read", parentId: home.id });
    const hits = r.search.search("Read");
    // All three are rank 2 (contains). Shorter title first; for the two
    // length-8 titles, alphabetical: Cat < Dog.
    expect(hits.map((h) => h.title)).toEqual([
      "Cat Read",
      "Dog Read",
      "Zebra Read",
    ]);
  });

  it("returns an empty array for empty / whitespace q", () => {
    const r = newRepos();
    seedIfEmpty(r.db);
    expect(r.search.search("")).toEqual([]);
    expect(r.search.search("   ")).toEqual([]);
    expect(r.search.search("\t\n")).toEqual([]);
  });

  it("returns an empty array when nothing matches", () => {
    const r = newRepos();
    seedIfEmpty(r.db);
    expect(r.search.search("zzznope")).toEqual([]);
  });

  it("escapes LIKE wildcards in q so % and _ are literal", () => {
    const r = newRepos();
    const home = r.pages.create({ title: "Home" });
    r.pages.create({ title: "50% Off Sale", parentId: home.id });
    r.pages.create({ title: "A_B", parentId: home.id });
    r.pages.create({ title: "plain text", parentId: home.id });
    // q "50%" should match only the sale page, not every page (which a bare
    // % wildcard would).
    expect(r.search.search("50%").map((h) => h.title)).toEqual([
      "50% Off Sale",
    ]);
    // q "A_B" should match only A_B, not "AxB" or "AanythingB".
    expect(r.search.search("A_B").map((h) => h.title)).toEqual(["A_B"]);
  });

  it("limits results to SEARCH_LIMIT", () => {
    const r = newRepos();
    const home = r.pages.create({ title: "Home" });
    // Create far more than SEARCH_LIMIT matching pages.
    for (let i = 0; i < SEARCH_LIMIT + 10; i++) {
      r.pages.create({ title: `Match ${i}`, parentId: home.id });
    }
    const hits = r.search.search("Match");
    expect(hits.length).toBe(SEARCH_LIMIT);
  });

  it("a page hit at the root has null parentId and parentTitle", () => {
    const r = newRepos();
    seedIfEmpty(r.db);
    // "Home" is a root page -> parentId null, parentTitle null.
    const home = r.search.search("Home").find((h) => h.id === "home");
    expect(home).toBeDefined();
    expect(home!.parentId).toBeNull();
    expect(home!.parentTitle).toBeNull();
  });

  it("a nested page hit carries its parent page's title", () => {
    const r = newRepos();
    seedIfEmpty(r.db);
    const tokyo = r.search.search("Tokyo Trip").find((h) => h.id === "tokyo-trip");
    expect(tokyo).toBeDefined();
    expect(tokyo!.parentTitle).toBe("Travel");
    expect(tokyo!.parentId).toBe("travel");
  });
});

// ---- HTTP route ----

describe("GET /api/search", () => {
  const servers: Server[] = [];

  function startApp() {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const repo = new PageRepository(db);
    const blockRepo = new BlockRepository(db);
    const dbRepo = new DatabaseRepository(db, repo);
    const viewRepo = new ViewRepository(db, dbRepo);
    const searchRepo = new SearchRepository(db);
    const app = createApp({
      repo,
      blockRepo,
      dbRepo,
      viewRepo,
      searchRepo,
    });
    const server = createServer(app);
    server.listen(0);
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}`;
  }

  it("returns ranked mixed-type hits for q=read", async () => {
    const base = startApp();
    const res = await fetch(`${base}/api/search?q=read`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string; type: string; title: string; parentTitle: string | null }[] };
    // Reading List (database) and any rows whose title contains "read".
    const titles = body.results.map((h) => h.title);
    expect(titles).toContain("Reading List");
    // Every hit's title contains 'read' case-insensitively.
    for (const h of body.results) {
      expect(h.title.toLowerCase()).toContain("read");
    }
  });

  it("returns page + row context for q=tokyo", async () => {
    const base = startApp();
    const res = await fetch(`${base}/api/search?q=tokyo`);
    const body = (await res.json()) as { results: { id: string; type: string; parentTitle: string | null }[] };
    const tokyoPage = body.results.find((h) => h.id === "tokyo-trip");
    expect(tokyoPage).toBeDefined();
    expect(tokyoPage!.type).toBe("page");
    expect(tokyoPage!.parentTitle).toBe("Travel");
  });

  it("returns an empty results array for q=zzz", async () => {
    const base = startApp();
    const res = await fetch(`${base}/api/search?q=zzz`);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it("returns an empty results array for empty q", async () => {
    const base = startApp();
    const res = await fetch(`${base}/api/search?q=`);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });
});
