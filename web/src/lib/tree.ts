// Tree-building utility. Pure functions — no React, no DOM, no fetch.
// Kept in its own module so the unit test can exercise nesting + ordering
// without rendering anything.

/** Page shape as returned by /api/tree. Mirrors the backend Page type. */
export interface PageNode {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  kind: 'page' | 'database' | 'row';
  position: number;
}

/** A node in the rendered tree. */
export interface TreeNode {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  kind: 'page' | 'database' | 'row';
  position: number;
  depth: number;
  children: TreeNode[];
}

/**
 * Builds a tree from a flat list of pages.
 *
 * Rules:
 * - Sibling order is by `position` ascending, ties broken by `id` ascending
 *   so the result is stable when the backend ordering is unchanged.
 * - Pages whose parent id doesn't appear in the list are treated as
 *   orphans: they are surfaced as top-level nodes so the user can see
 *   and act on them rather than losing them.
 * - `kind === 'row'` is filtered out — rows live inside a database page
 *   and are not shown in the sidebar (per CONTRACT.md).
 */
export function buildTree(pages: PageNode[]): TreeNode[] {
  const visible = pages.filter((p) => p.kind !== 'row');

  const byId = new Map<string, TreeNode>();
  for (const p of visible) {
    byId.set(p.id, {
      id: p.id,
      parentId: p.parentId,
      title: p.title,
      icon: p.icon,
      kind: p.kind,
      position: p.position,
      depth: 0,
      children: [],
    });
  }

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort siblings. Stable tie-break on id keeps the tree deterministic.
  const sort = (nodes: TreeNode[], depth: number) => {
    nodes.sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    for (const n of nodes) {
      n.depth = depth;
      sort(n.children, depth + 1);
    }
  };
  sort(roots, 0);

  return roots;
}

/** Flattens a tree to a depth-first list (handy for keyboard nav / tests). */
export function flattenTree(roots: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** Counts every node in a tree (roots + descendants). */
export function countNodes(roots: TreeNode[]): number {
  return flattenTree(roots).length;
}

/**
 * Returns the set of page ids that should be expanded by default when
 * the user has no saved expand state yet. We open the top-level
 * containers so the seeded workspace is immediately useful.
 */
export function defaultExpandedIds(roots: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  for (const r of roots) {
    ids.add(r.id);
    for (const c of r.children) ids.add(c.id);
  }
  return ids;
}
