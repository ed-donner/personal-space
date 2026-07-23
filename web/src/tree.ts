import type { Page, PageNode } from "./types";

/**
 * Build a nested tree from a flat list of pages.
 *
 * Behavior:
 *  - Pages with `type === "row"` are dropped — rows live inside databases and
 *    are never shown in the sidebar. (They are still pages, so they appear in
 *    the API's GET /api/pages response.)
 *  - Pages are sorted at each level by `position` (ascending), with ties broken by id for stability.
 *  - Depth is 0 for root pages, increasing by 1 per level of nesting.
 *  - Orphan tolerance: if a page references a parentId that is not in the list, it is treated as
 *    a root. This keeps the tree resilient to deleted parents before the client refreshes.
 *  - Duplicate ids keep the first occurrence; subsequent ones are dropped to avoid infinite loops.
 *  - Self-referential parents (parentId === id) are treated as roots, again as a safety net.
 */
export function buildTree(pages: Page[]): PageNode[] {
  // First pass: drop rows (they never appear in the tree) and collect which
  // ids were dropped so we can also drop any child that referenced them.
  const seen = new Set<string>();
  const unique: Page[] = [];
  const droppedIds = new Set<string>();
  for (const p of pages) {
    if (p.type === "row") {
      droppedIds.add(p.id);
      continue;
    }
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    unique.push(p);
  }

  // Drop pages whose parent is a row — they'd be orphans with no place in
  // the tree, and rendering them as roots would be misleading.
  const filtered: Page[] = unique.filter(
    (p) => !(p.parentId && droppedIds.has(p.parentId)),
  );

  const byId = new Map<string, PageNode>();
  for (const p of filtered) {
    byId.set(p.id, { page: p, children: [], depth: 0 });
  }

  const roots: PageNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.page.parentId;
    const isSelfParent = parentId === node.page.id;
    const parent = parentId && !isSelfParent ? byId.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (nodes: PageNode[], depth: number): void => {
    nodes.sort(
      (a, b) =>
        a.page.position - b.page.position || a.page.id.localeCompare(b.page.id),
    );
    for (const n of nodes) {
      n.depth = depth;
      sortRec(n.children, depth + 1);
    }
  };
  sortRec(roots, 0);

  return roots;
}

/**
 * Flatten a tree back to an ordered list (depth-first, parents before children).
 * Useful for lookups and tests.
 */
export function flattenTree(roots: PageNode[]): PageNode[] {
  const out: PageNode[] = [];
  const walk = (nodes: PageNode[]): void => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/**
 * Find the first root page in the tree (or undefined if empty).
 * Used for auto-selection on load.
 */
export function findFirstRoot(roots: PageNode[]): PageNode | undefined {
  return roots[0];
}

/**
 * Collect the ids of a page and all its descendants.
 */
export function collectDescendantIds(pageId: string, roots: PageNode[]): Set<string> {
  const ids = new Set<string>([pageId]);
  const walk = (nodes: PageNode[]): boolean => {
    for (const n of nodes) {
      if (n.page.id === pageId) {
        collectInto(n, ids);
        return true;
      }
      if (walk(n.children)) return true;
    }
    return false;
  };
  walk(roots);
  return ids;
}

function collectInto(node: PageNode, into: Set<string>): void {
  for (const c of node.children) {
    into.add(c.page.id);
    collectInto(c, into);
  }
}

/**
 * Given the page that was deleted, pick a sensible replacement selection.
 * Prefers the deleted page's parent; otherwise the first root; otherwise null.
 */
export function pickReplacementSelection(
  roots: PageNode[],
  deletedId: string,
): string | null {
  let parentId: string | null = null;
  const walk = (nodes: PageNode[]): boolean => {
    for (const n of nodes) {
      if (n.page.id === deletedId) return true;
      if (walk(n.children)) {
        if (parentId === null) parentId = n.page.id;
        return true;
      }
    }
    return false;
  };
  walk(roots);
  if (parentId) return parentId;
  return roots[0]?.page.id ?? null;
}
