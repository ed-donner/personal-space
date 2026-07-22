import { describe, it, expect } from 'vitest';
import {
  buildTree,
  countNodes,
  defaultExpandedIds,
  flattenTree,
  type PageNode,
} from './tree';

function p(
  id: string,
  parentId: string | null,
  title: string,
  position = 0,
  icon: string | null = null,
  kind: PageNode['kind'] = 'page'
): PageNode {
  return { id, parentId, title, icon, kind, position };
}

describe('buildTree', () => {
  it('returns an empty array for an empty input', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('places parentless pages at the root, sorted by position', () => {
    const tree = buildTree([
      p('b', null, 'B', 1),
      p('a', null, 'A', 0),
      p('c', null, 'C', 2),
    ]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(tree.every((n) => n.depth === 0)).toBe(true);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it('nests children under their parents and preserves sibling order', () => {
    const tree = buildTree([
      p('root', null, 'Root', 0),
      p('z', 'root', 'Z', 1),
      p('a', 'root', 'A', 0),
      p('az', 'a', 'AZ', 0),
      p('aa', 'a', 'AA', 0),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('root');
    expect(tree[0].children.map((n) => n.id)).toEqual(['a', 'z']);
    expect(tree[0].children[0].children.map((n) => n.id)).toEqual([
      'aa',
      'az',
    ]);
  });

  it('breaks ties on position by id so order is stable', () => {
    const tree = buildTree([
      p('c', null, 'C', 0),
      p('a', null, 'A', 0),
      p('b', null, 'B', 0),
    ]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('surfaces orphan pages (parent not in list) as roots', () => {
    const tree = buildTree([
      p('orphan', 'missing-parent', 'Orphan', 0),
      p('real', null, 'Real', 0),
    ]);
    expect(tree.map((n) => n.id)).toEqual(['orphan', 'real']);
  });

  it('drops row-kind pages from the tree', () => {
    const tree = buildTree([
      p('p1', null, 'Page', 0, null, 'page'),
      p('row1', 'p1', 'Row 1', 0, null, 'row'),
    ]);
    expect(tree).toHaveLength(1);
    expect(countNodes(tree)).toBe(1);
  });

  it('keeps database-kind pages in the tree', () => {
    const tree = buildTree([
      p('db', null, 'Tasks', 0, null, 'database'),
      p('child', 'db', 'First task', 0, null, 'row'),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe('database');
    // Row children are still filtered out.
    expect(tree[0].children).toHaveLength(0);
  });

  it('handles deep nesting (4 levels)', () => {
    const tree = buildTree([
      p('a', null, 'A', 0),
      p('b', 'a', 'B', 0),
      p('c', 'b', 'C', 0),
      p('d', 'c', 'D', 0),
    ]);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[0].children[0].depth).toBe(2);
    expect(tree[0].children[0].children[0].children[0].depth).toBe(3);
    expect(countNodes(tree)).toBe(4);
  });

  it('preserves the icon field on each node', () => {
    const tree = buildTree([p('p', null, 'Home', 0, '🏡')]);
    expect(tree[0].icon).toBe('🏡');
  });
});

describe('flattenTree', () => {
  it('flattens in depth-first pre-order', () => {
    const tree = buildTree([
      p('a', null, 'A', 0),
      p('a1', 'a', 'A1', 0),
      p('a2', 'a', 'A2', 0),
      p('a1a', 'a1', 'A1a', 0),
      p('b', null, 'B', 0),
    ]);
    const flat = flattenTree(tree);
    expect(flat.map((n) => n.id)).toEqual(['a', 'a1', 'a1a', 'a2', 'b']);
  });
});

describe('defaultExpandedIds', () => {
  it('expands the top two levels by default so the seed is browsable', () => {
    const tree = buildTree([
      p('a', null, 'A', 0),
      p('a1', 'a', 'A1', 0),
      p('a1i', 'a1', 'A1i', 0),
      p('b', null, 'B', 0),
    ]);
    const ids = defaultExpandedIds(tree);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('a1')).toBe(true);
    expect(ids.has('a1i')).toBe(false);
    expect(ids.has('b')).toBe(true);
  });
});
