import { describe, expect, it } from "vitest";
import {
  buildTree,
  collectDescendantIds,
  findFirstRoot,
  flattenTree,
  pickReplacementSelection,
} from "./tree";
import type { Page, PageNode } from "./types";

function page(
  id: string,
  parentId: string | null,
  position: number,
  title = id,
  type: Page["type"] = "page",
): Page {
  return { id, parentId, position, title, icon: "x", type };
}

describe("buildTree", () => {
  it("nests children under their parents at any depth", () => {
    const pages = [
      page("a", null, 0),
      page("a1", "a", 0),
      page("a1a", "a1", 0),
      page("a1b", "a1", 1),
      page("a2", "a", 1),
      page("b", null, 1),
    ];
    const tree = buildTree(pages);
    expect(tree.map((n) => n.page.id)).toEqual(["a", "b"]);

    const a = tree[0];
    expect(a.children.map((c) => c.page.id)).toEqual(["a1", "a2"]);

    const a1 = a.children[0];
    expect(a1.children.map((c) => c.page.id)).toEqual(["a1a", "a1b"]);

    const a1a = a1.children[0];
    expect(a1a.depth).toBe(2);
    expect(a1a.children).toEqual([]);
  });

  it("orders children by position, breaking ties by id", () => {
    const pages = [
      page("root", null, 0),
      page("c", "root", 2),
      page("a", "root", 0),
      page("b", "root", 1),
      page("a2", "root", 0), // same position as a — id sorts first
    ];
    const tree = buildTree(pages);
    expect(tree[0].children.map((n) => n.page.id)).toEqual([
      "a",
      "a2",
      "b",
      "c",
    ]);
  });

  it("treats orphan pages (missing parent) as roots", () => {
    const pages = [
      page("ghost", "deleted", 0),
      page("a", null, 0),
    ];
    const tree = buildTree(pages);
    expect(tree.map((n) => n.page.id).sort()).toEqual(["a", "ghost"]);
    // The orphan has depth 0 (it's a root).
    expect(tree.find((n) => n.page.id === "ghost")!.depth).toBe(0);
  });

  it("treats self-referential pages as roots", () => {
    const pages = [page("loop", "loop", 0)];
    const tree = buildTree(pages);
    expect(tree).toHaveLength(1);
    expect(tree[0].page.id).toBe("loop");
    expect(tree[0].children).toEqual([]);
  });

  it("ignores duplicate ids, keeping the first occurrence", () => {
    const dupA = page("dup", null, 0, "first");
    const dupB = page("dup", null, 0, "second");
    const tree = buildTree([dupA, dupB]);
    expect(tree).toHaveLength(1);
    expect(tree[0].page.title).toBe("first");
  });

  it("excludes rows from the tree even when they have a database parent", () => {
    const pages = [
      page("db", null, 0, "Reading", "database"),
      page("row-1", "db", 0, "Atomic Habits", "row"),
      page("row-2", "db", 1, "Deep Work", "row"),
    ];
    const tree = buildTree(pages);
    // Only the database shows; no rows nested under it.
    expect(tree.map((n) => n.page.id)).toEqual(["db"]);
    expect(tree[0].children).toEqual([]);
  });

  it("drops pages whose parent is a row (rows never appear in the tree)", () => {
    const pages = [
      page("db", null, 0, "Reading", "database"),
      page("row-1", "db", 0, "Atomic Habits", "row"),
      // A normal page whose only parent is a row — there's no good place
      // to render it, so we drop it from the tree rather than producing an
      // orphan root that the user can't reach.
      page("note", "row-1", 0, "Note under a row", "page"),
    ];
    const tree = buildTree(pages);
    expect(tree.map((n) => n.page.id)).toEqual(["db"]);
    expect(tree[0].children).toEqual([]);
  });

  it("handles an empty list", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("sets depth correctly at every level", () => {
    const pages = [
      page("a", null, 0),
      page("a1", "a", 0),
      page("a1a", "a1", 0),
      page("a1a1", "a1a", 0),
    ];
    const tree = buildTree(pages);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[0].children[0].depth).toBe(2);
    expect(tree[0].children[0].children[0].children[0].depth).toBe(3);
  });
});

describe("flattenTree", () => {
  it("walks depth-first, parents before children", () => {
    const pages = [
      page("a", null, 0),
      page("a1", "a", 0),
      page("a2", "a", 1),
      page("b", null, 1),
    ];
    const flat = flattenTree(buildTree(pages));
    expect(flat.map((n) => n.page.id)).toEqual(["a", "a1", "a2", "b"]);
  });
});

describe("findFirstRoot", () => {
  it("returns the first root node", () => {
    const tree = buildTree([page("a", null, 1), page("b", null, 0)]);
    const first = findFirstRoot(tree);
    expect(first?.page.id).toBe("b");
  });

  it("returns undefined for an empty tree", () => {
    expect(findFirstRoot([])).toBeUndefined();
  });
});

describe("collectDescendantIds", () => {
  it("includes the page and all its nested children", () => {
    const pages = [
      page("a", null, 0),
      page("a1", "a", 0),
      page("a1a", "a1", 0),
      page("a2", "a", 1),
      page("b", null, 1),
    ];
    const tree = buildTree(pages);
    const ids = collectDescendantIds("a", tree);
    expect([...ids].sort()).toEqual(["a", "a1", "a1a", "a2"]);
  });
});

describe("pickReplacementSelection", () => {
  it("prefers the deleted page's parent", () => {
    const pages = [
      page("a", null, 0),
      page("a1", "a", 0),
      page("a2", "a", 1),
    ];
    const tree = buildTree(pages);
    expect(pickReplacementSelection(tree, "a1")).toBe("a");
  });

  it("falls back to the first root if there is no parent", () => {
    const pages = [page("a", null, 0), page("b", null, 1)];
    const tree = buildTree(pages);
    expect(pickReplacementSelection(tree, "a")).toBe("a");
    // After deletion, a is gone, so the first root is now b.
    const remaining = buildTree(pages.filter((p) => p.id !== "a"));
    expect(pickReplacementSelection(remaining, "a")).toBe("b");
  });

  it("returns null when nothing is left", () => {
    const tree: PageNode[] = [];
    expect(pickReplacementSelection(tree, "anything")).toBeNull();
  });
});
