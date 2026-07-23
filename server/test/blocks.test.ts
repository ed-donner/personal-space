import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../src/db.js";
import {
  PageRepository,
  PageError,
} from "../src/pages.js";
import {
  BlockRepository,
  BlockError,
  MAX_CONTENT_LENGTH,
  BLOCK_TYPES,
} from "../src/blocks.js";
import { seedIfEmpty } from "../src/seed.js";
import type { Block, BlockType } from "../src/types.js";

function newRepos() {
  const db = openDb(":memory:");
  return {
    db,
    pages: new PageRepository(db),
    blocks: new BlockRepository(db),
  };
}

function typesOf(blocks: Block[]): string[] {
  return blocks.map((b) => b.type);
}

function positionsOf(blocks: Block[]): number[] {
  return blocks.map((b) => b.position);
}

function contentsOf(blocks: Block[]): string[] {
  return blocks.map((b) => b.content);
}

// A page id to use in tests; created fresh in each beforeEach.
let pageId: string;

describe("BlockRepository.create", () => {
  let pages: PageRepository;
  let blocks: BlockRepository;

  beforeEach(() => {
    const r = newRepos();
    pages = r.pages;
    blocks = r.blocks;
    pageId = pages.create({ title: "Page" }).id;
  });

  it("applies defaults: type paragraph, content '', checked false, position 0", () => {
    const b = blocks.create(pageId, {});
    expect(b.type).toBe("paragraph");
    expect(b.content).toBe("");
    expect(b.checked).toBe(false);
    expect(b.position).toBe(0);
    expect(b.pageId).toBe(pageId);
    expect(b.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("places subsequent blocks at the end by default", () => {
    const a = blocks.create(pageId, { content: "a" });
    const b = blocks.create(pageId, { content: "b" });
    const c = blocks.create(pageId, { content: "c" });
    expect(positionsOf([a, b, c])).toEqual([0, 1, 2]);
  });

  it("inserts at an explicit position and shifts later blocks down", () => {
    const a = blocks.create(pageId, { content: "a" }); // 0
    const b = blocks.create(pageId, { content: "b" }); // 1
    const c = blocks.create(pageId, { content: "c" }); // 2
    const x = blocks.create(pageId, { content: "x", position: 1 });
    expect(x.position).toBe(1);
    const order = contentsOf(blocks.list(pageId));
    expect(order).toEqual(["a", "x", "b", "c"]);
    expect(positionsOf(blocks.list(pageId))).toEqual([0, 1, 2, 3]);
  });

  it("inserts at position 0 shifting everything", () => {
    blocks.create(pageId, { content: "a" });
    blocks.create(pageId, { content: "b" });
    const x = blocks.create(pageId, { content: "x", position: 0 });
    expect(x.position).toBe(0);
    expect(contentsOf(blocks.list(pageId))).toEqual(["x", "a", "b"]);
  });

  it("clamps an out-of-range position to the end", () => {
    blocks.create(pageId, { content: "a" });
    blocks.create(pageId, { content: "b" });
    const x = blocks.create(pageId, { content: "x", position: 99 });
    expect(x.position).toBe(2);
    expect(contentsOf(blocks.list(pageId))).toEqual(["a", "b", "x"]);
  });

  it("clamps a negative position to 0", () => {
    blocks.create(pageId, { content: "a" });
    const x = blocks.create(pageId, { content: "x", position: -5 });
    expect(x.position).toBe(0);
    expect(contentsOf(blocks.list(pageId))).toEqual(["x", "a"]);
  });

  it("accepts every block type", () => {
    const types = [
      "paragraph",
      "heading1",
      "heading2",
      "heading3",
      "bulleted",
      "numbered",
      "todo",
      "quote",
      "divider",
      "code",
      "callout",
    ] as BlockType[];
    for (const type of types) {
      const b = blocks.create(pageId, { type, content: `c-${type}` });
      expect(b.type).toBe(type);
    }
    expect(blocks.list(pageId)).toHaveLength(11);
  });

  it("rejects an invalid type with 400", () => {
    try {
      blocks.create(pageId, { type: "nope" as BlockType });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BlockError);
      expect((err as BlockError).status).toBe(400);
    }
  });

  it("rejects an unknown page with 404", () => {
    try {
      blocks.create("missing-page", {});
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BlockError);
      expect((err as BlockError).status).toBe(404);
    }
  });

  it("stores checked=true for a todo", () => {
    const b = blocks.create(pageId, { type: "todo", content: "done", checked: true });
    expect(b.checked).toBe(true);
    expect(blocks.list(pageId)[0].checked).toBe(true);
  });

  it("divider blocks ignore content and checked", () => {
    const b = blocks.create(pageId, {
      type: "divider",
      content: "should be dropped",
      checked: true,
    });
    expect(b.content).toBe("");
    expect(b.checked).toBe(false);
  });
});

describe("BlockRepository.list", () => {
  let pages: PageRepository;
  let blocks: BlockRepository;

  beforeEach(() => {
    const r = newRepos();
    pages = r.pages;
    blocks = r.blocks;
    pageId = pages.create({ title: "Page" }).id;
  });

  it("returns blocks ordered by position", () => {
    blocks.create(pageId, { content: "a" });
    blocks.create(pageId, { content: "b" });
    blocks.create(pageId, { content: "c" });
    expect(contentsOf(blocks.list(pageId))).toEqual(["a", "b", "c"]);
    expect(positionsOf(blocks.list(pageId))).toEqual([0, 1, 2]);
  });

  it("returns an empty array for a page with no blocks", () => {
    expect(blocks.list(pageId)).toEqual([]);
  });

  it("returns an empty array for an unknown page (repo does not 404)", () => {
    expect(blocks.list("no-such-page")).toEqual([]);
  });
});

describe("BlockRepository.update", () => {
  let pages: PageRepository;
  let blocks: BlockRepository;

  beforeEach(() => {
    const r = newRepos();
    pages = r.pages;
    blocks = r.blocks;
    pageId = pages.create({ title: "Page" }).id;
  });

  it("patches content", () => {
    const b = blocks.create(pageId, { content: "old" });
    const updated = blocks.update(b.id, { content: "new" });
    expect(updated.content).toBe("new");
    expect(blocks.list(pageId)[0].content).toBe("new");
  });

  it("patches checked", () => {
    const b = blocks.create(pageId, { type: "todo", content: "t", checked: false });
    const updated = blocks.update(b.id, { checked: true });
    expect(updated.checked).toBe(true);
    expect(blocks.list(pageId)[0].checked).toBe(true);
  });

  it("patches type", () => {
    const b = blocks.create(pageId, { type: "paragraph", content: "hi" });
    const updated = blocks.update(b.id, { type: "heading1" });
    expect(updated.type).toBe("heading1");
    // Content is preserved when changing to a non-divider type.
    expect(updated.content).toBe("hi");
  });

  it("changing type to divider clears content and checked", () => {
    const b = blocks.create(pageId, {
      type: "paragraph",
      content: "lots of text",
    });
    const updated = blocks.update(b.id, { type: "divider" });
    expect(updated.type).toBe("divider");
    expect(updated.content).toBe("");
    expect(updated.checked).toBe(false);
  });

  it("patching a divider ignores content/checked", () => {
    const b = blocks.create(pageId, { type: "divider" });
    const updated = blocks.update(b.id, {
      content: "ignored",
      checked: true,
    });
    expect(updated.content).toBe("");
    expect(updated.checked).toBe(false);
  });

  it("reorders a block earlier (shifts the squeezed range up)", () => {
    const a = blocks.create(pageId, { content: "a" }); // 0
    const b = blocks.create(pageId, { content: "b" }); // 1
    const c = blocks.create(pageId, { content: "c" }); // 2
    const d = blocks.create(pageId, { content: "d" }); // 3
    // Move d to position 1.
    const moved = blocks.update(d.id, { position: 1 });
    expect(moved.position).toBe(1);
    expect(contentsOf(blocks.list(pageId))).toEqual(["a", "d", "b", "c"]);
    expect(positionsOf(blocks.list(pageId))).toEqual([0, 1, 2, 3]);
  });

  it("reorders a block later (shifts the squeezed range down)", () => {
    const a = blocks.create(pageId, { content: "a" }); // 0
    const b = blocks.create(pageId, { content: "b" }); // 1
    const c = blocks.create(pageId, { content: "c" }); // 2
    const d = blocks.create(pageId, { content: "d" }); // 3
    // Move a to position 2.
    const moved = blocks.update(a.id, { position: 2 });
    expect(moved.position).toBe(2);
    expect(contentsOf(blocks.list(pageId))).toEqual(["b", "c", "a", "d"]);
    expect(positionsOf(blocks.list(pageId))).toEqual([0, 1, 2, 3]);
  });

  it("reordering to the same position is a no-op", () => {
    const a = blocks.create(pageId, { content: "a" });
    blocks.create(pageId, { content: "b" });
    const moved = blocks.update(a.id, { position: 0 });
    expect(moved.position).toBe(0);
    expect(contentsOf(blocks.list(pageId))).toEqual(["a", "b"]);
  });

  it("clamps reorder position to the valid range", () => {
    const a = blocks.create(pageId, { content: "a" });
    const b = blocks.create(pageId, { content: "b" });
    const moved = blocks.update(a.id, { position: 99 });
    expect(moved.position).toBe(1);
    expect(contentsOf(blocks.list(pageId))).toEqual(["b", "a"]);
  });

  it("returns 404 for an unknown block", () => {
    try {
      blocks.update("nope", { content: "x" });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as BlockError).status).toBe(404);
    }
  });

  it("rejects an invalid type with 400", () => {
    const b = blocks.create(pageId, {});
    try {
      blocks.update(b.id, { type: "bogus" as BlockType });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as BlockError).status).toBe(400);
    }
  });
});

describe("BlockRepository.remove", () => {
  let pages: PageRepository;
  let blocks: BlockRepository;

  beforeEach(() => {
    const r = newRepos();
    pages = r.pages;
    blocks = r.blocks;
    pageId = pages.create({ title: "Page" }).id;
  });

  it("deletes a single block", () => {
    const a = blocks.create(pageId, { content: "a" });
    blocks.remove(a.id);
    expect(blocks.list(pageId)).toHaveLength(0);
  });

  it("keeps remaining blocks in a dense ordering", () => {
    blocks.create(pageId, { content: "a" }); // 0
    const b = blocks.create(pageId, { content: "b" }); // 1
    blocks.create(pageId, { content: "c" }); // 2
    blocks.create(pageId, { content: "d" }); // 3
    blocks.remove(b.id);
    const remaining = blocks.list(pageId);
    expect(contentsOf(remaining)).toEqual(["a", "c", "d"]);
    expect(positionsOf(remaining)).toEqual([0, 1, 2]);
  });

  it("returns 404 for an unknown block", () => {
    try {
      blocks.remove("nope");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as BlockError).status).toBe(404);
    }
  });

  it("deleting the first block renumbers the rest", () => {
    const a = blocks.create(pageId, { content: "a" });
    blocks.create(pageId, { content: "b" });
    blocks.create(pageId, { content: "c" });
    blocks.remove(a.id);
    expect(positionsOf(blocks.list(pageId))).toEqual([0, 1]);
    expect(contentsOf(blocks.list(pageId))).toEqual(["b", "c"]);
  });
});

describe("BlockRepository.replaceAll (PUT)", () => {
  let pages: PageRepository;
  let blocks: BlockRepository;

  beforeEach(() => {
    const r = newRepos();
    pages = r.pages;
    blocks = r.blocks;
    pageId = pages.create({ title: "Page" }).id;
  });

  it("replaces all blocks in order", () => {
    blocks.create(pageId, { content: "old" });
    blocks.create(pageId, { content: "older" });
    const result = blocks.replaceAll(pageId, [
      { type: "heading1", content: "New" },
      { type: "paragraph", content: "Body" },
    ]);
    expect(result).toHaveLength(2);
    expect(contentsOf(result)).toEqual(["New", "Body"]);
    expect(positionsOf(result)).toEqual([0, 1]);
    expect(contentsOf(blocks.list(pageId))).toEqual(["New", "Body"]);
  });

  it("honors client-supplied ids when valid and unique", () => {
    const result = blocks.replaceAll(pageId, [
      { id: "custom-1", type: "paragraph", content: "a" },
      { id: "custom-2", type: "paragraph", content: "b" },
    ]);
    expect(result.map((b) => b.id)).toEqual(["custom-1", "custom-2"]);
  });

  it("generates ids when none are supplied", () => {
    const result = blocks.replaceAll(pageId, [
      { type: "paragraph", content: "a" },
      { type: "paragraph", content: "b" },
    ]);
    for (const b of result) {
      expect(b.id).toMatch(/^[0-9a-f-]{36}$/i);
    }
    expect(new Set(result.map((b) => b.id)).size).toBe(2);
  });

  it("generates a fresh id for a duplicate id within the batch", () => {
    const result = blocks.replaceAll(pageId, [
      { id: "dup", type: "paragraph", content: "a" },
      { id: "dup", type: "paragraph", content: "b" },
    ]);
    expect(result[0].id).toBe("dup");
    expect(result[1].id).not.toBe("dup");
    expect(result[1].id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("generates a fresh id when the client id collides with another page's block", () => {
    const otherPage = pages.create({ title: "Other" }).id;
    blocks.create(otherPage, { type: "paragraph", content: "x" });
    const existing = blocks.list(otherPage)[0];
    // Replace this page's blocks using a colliding id.
    const result = blocks.replaceAll(pageId, [
      { id: existing.id, type: "paragraph", content: "y" },
    ]);
    expect(result[0].id).not.toBe(existing.id);
    // The other page's block is untouched.
    expect(blocks.list(otherPage)).toHaveLength(1);
    expect(blocks.list(otherPage)[0].id).toBe(existing.id);
  });

  it("allows reusing an id that belonged to this page before replace", () => {
    blocks.create(pageId, { type: "paragraph", content: "orig" });
    // Seed a block with a known id by replacing.
    const first = blocks.replaceAll(pageId, [
      { id: "keep-me", type: "paragraph", content: "first" },
    ]);
    expect(first[0].id).toBe("keep-me");
    // Re-replace reusing the same id; should be honored.
    const second = blocks.replaceAll(pageId, [
      { id: "keep-me", type: "paragraph", content: "second" },
    ]);
    expect(second[0].id).toBe("keep-me");
    expect(second[0].content).toBe("second");
  });

  it("an empty array clears all blocks", () => {
    blocks.create(pageId, { content: "a" });
    blocks.create(pageId, { content: "b" });
    const result = blocks.replaceAll(pageId, []);
    expect(result).toEqual([]);
    expect(blocks.list(pageId)).toEqual([]);
  });

  it("invalid type -> 400 and NO partial write (originals intact)", () => {
    blocks.create(pageId, { content: "keep-1" });
    blocks.create(pageId, { content: "keep-2" });
    try {
      blocks.replaceAll(pageId, [
        { type: "paragraph", content: "new-1" },
        { type: "bogus" as BlockType, content: "bad" },
      ]);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as BlockError).status).toBe(400);
    }
    // Nothing was written: the original two blocks survive.
    expect(contentsOf(blocks.list(pageId))).toEqual(["keep-1", "keep-2"]);
  });

  it("content too long -> 400 and NO partial write", () => {
    blocks.create(pageId, { content: "keep" });
    const tooLong = "x".repeat(MAX_CONTENT_LENGTH + 1);
    try {
      blocks.replaceAll(pageId, [
        { type: "paragraph", content: "ok" },
        { type: "paragraph", content: tooLong },
      ]);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as BlockError).status).toBe(400);
    }
    expect(contentsOf(blocks.list(pageId))).toEqual(["keep"]);
  });

  it("returns 404 for an unknown page", () => {
    try {
      blocks.replaceAll("missing", [{ type: "paragraph", content: "x" }]);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as BlockError).status).toBe(404);
    }
  });

  it("applies divider rules to replaced blocks", () => {
    const result = blocks.replaceAll(pageId, [
      { type: "divider", content: "ignored", checked: true },
    ]);
    expect(result[0].content).toBe("");
    expect(result[0].checked).toBe(false);
  });
});

describe("page deletion cascades to blocks", () => {
  let pages: PageRepository;
  let blocks: BlockRepository;

  beforeEach(() => {
    const r = newRepos();
    pages = r.pages;
    blocks = r.blocks;
  });

  it("deleting a page removes its blocks", () => {
    const a = pages.create({ title: "A" });
    const b = pages.create({ title: "B" });
    blocks.create(a.id, { content: "a1" });
    blocks.create(a.id, { content: "a2" });
    blocks.create(b.id, { content: "b1" });

    pages.remove(a.id);
    expect(blocks.list(a.id)).toEqual([]);
    // Sibling page's blocks survive.
    expect(contentsOf(blocks.list(b.id))).toEqual(["b1"]);
  });

  it("multi-level cascade removes descendant page blocks", () => {
    const root = pages.create({ title: "root" });
    const child = pages.create({ parentId: root.id, title: "child" });
    const grandchild = pages.create({ parentId: child.id, title: "gc" });
    const sibling = pages.create({ title: "sibling" });

    blocks.create(root.id, { content: "root-block" });
    blocks.create(child.id, { content: "child-block" });
    blocks.create(grandchild.id, { content: "gc-block" });
    blocks.create(sibling.id, { content: "sib-block" });

    pages.remove(root.id);
    expect(blocks.list(root.id)).toEqual([]);
    expect(blocks.list(child.id)).toEqual([]);
    expect(blocks.list(grandchild.id)).toEqual([]);
    expect(contentsOf(blocks.list(sibling.id))).toEqual(["sib-block"]);
  });

  it("deleting a child page removes only that child's blocks", () => {
    const root = pages.create({ title: "root" });
    const child = pages.create({ parentId: root.id, title: "child" });
    blocks.create(root.id, { content: "root-block" });
    blocks.create(child.id, { content: "child-block" });

    pages.remove(child.id);
    expect(blocks.list(child.id)).toEqual([]);
    expect(contentsOf(blocks.list(root.id))).toEqual(["root-block"]);
  });
});

describe("content length cap", () => {
  let pages: PageRepository;
  let blocks: BlockRepository;

  beforeEach(() => {
    const r = newRepos();
    pages = r.pages;
    blocks = r.blocks;
    pageId = pages.create({ title: "Page" }).id;
  });

  it(`create accepts content of exactly ${MAX_CONTENT_LENGTH} chars`, () => {
    const exact = "x".repeat(MAX_CONTENT_LENGTH);
    const b = blocks.create(pageId, { content: exact });
    expect(b.content.length).toBe(MAX_CONTENT_LENGTH);
  });

  it(`create rejects content over ${MAX_CONTENT_LENGTH} chars with 400`, () => {
    const tooLong = "x".repeat(MAX_CONTENT_LENGTH + 1);
    try {
      blocks.create(pageId, { content: tooLong });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as BlockError).status).toBe(400);
    }
  });

  it(`patch accepts content of exactly ${MAX_CONTENT_LENGTH} chars`, () => {
    const b = blocks.create(pageId, { content: "short" });
    const exact = "y".repeat(MAX_CONTENT_LENGTH);
    const updated = blocks.update(b.id, { content: exact });
    expect(updated.content.length).toBe(MAX_CONTENT_LENGTH);
  });

  it(`patch rejects content over ${MAX_CONTENT_LENGTH} chars with 400`, () => {
    const b = blocks.create(pageId, { content: "short" });
    const tooLong = "z".repeat(MAX_CONTENT_LENGTH + 1);
    try {
      blocks.update(b.id, { content: tooLong });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as BlockError).status).toBe(400);
    }
    // Existing content unchanged.
    expect(blocks.list(pageId)[0].content).toBe("short");
  });

  it("dividers skip the content length check", () => {
    const huge = "x".repeat(MAX_CONTENT_LENGTH + 100);
    const b = blocks.create(pageId, { type: "divider", content: huge });
    expect(b.content).toBe("");
  });
});

describe("block seed", () => {
  it("seeds blocks onto several pages exercising all 11 block types", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const pages = new PageRepository(db);
    const blocks = new BlockRepository(db);

    const allBlocks = blocks.list("home");
    expect(allBlocks.length).toBeGreaterThan(0);
    // Home starts with a callout.
    expect(allBlocks[0].type).toBe("callout");

    // Collect every seeded block type across all seeded pages.
    const pageIds = pages.list().map((p) => p.id);
    const seenTypes = new Set<string>();
    for (const pid of pageIds) {
      for (const b of blocks.list(pid)) {
        seenTypes.add(b.type);
      }
    }
    expect(seenTypes.size).toBe(11);
    for (const t of BLOCK_TYPES) {
      expect(seenTypes.has(t)).toBe(true);
    }
  });

  it("seeded blocks have dense 0-based positions per page", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const pages = new PageRepository(db);
    const blocks = new BlockRepository(db);
    for (const p of pages.list()) {
      const pos = positionsOf(blocks.list(p.id));
      expect(pos).toEqual([...pos].sort((a, b) => a - b));
      pos.forEach((value, index) => expect(value).toBe(index));
    }
  });

  it("seeded Launch Checklist has checked and unchecked todos", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const blocks = new BlockRepository(db);
    const todos = blocks
      .list("launch-checklist")
      .filter((b) => b.type === "todo");
    expect(todos.length).toBeGreaterThanOrEqual(4);
    expect(todos.some((t) => t.checked)).toBe(true);
    expect(todos.some((t) => !t.checked)).toBe(true);
  });

  it("seeding is idempotent (blocks are not duplicated on re-run)", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const blocks = new BlockRepository(db);
    const first = blocks.list("home").length;
    seedIfEmpty(db); // no-op
    expect(blocks.list("home").length).toBe(first);
  });

  it("does not re-seed blocks after pages are deleted", () => {
    const db = openDb(":memory:");
    seedIfEmpty(db);
    const pages = new PageRepository(db);
    const blocks = new BlockRepository(db);
    expect(blocks.list("home").length).toBeGreaterThan(0);

    // Delete every page.
    for (const p of [...pages.list()]) {
      if (pages.findById(p.id)) pages.remove(p.id);
    }
    expect(pages.list()).toHaveLength(0);
    expect(blocks.list("home")).toEqual([]);

    // Re-running the seed check must leave it empty (seed-once via meta).
    seedIfEmpty(db);
    expect(blocks.list("home")).toEqual([]);
  });
});
