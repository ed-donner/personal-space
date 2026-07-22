import { describe, it, expect } from 'vitest';
import { databaseTitle, flatSearchResults, groupSearchResults, moveSearchIndex, SEARCH_GROUPS } from './search';
import type { SearchResult } from './api';
import type { Page } from './api';

const sample: SearchResult[] = [
  { id: 'p-1', title: 'Japan 2027', icon: '🇯🇵', kind: 'page' },
  { id: 'p-2', title: 'Recipes', icon: null, kind: 'page' },
  { id: 'd-1', title: 'Reading List', icon: '📚', kind: 'database' },
  { id: 'r-1', title: 'Project Hail Mary', icon: '🚀', kind: 'row', databaseId: 'd-1' },
];

describe('search helpers', () => {
  it('groupSearchResults orders and buckets the results', () => {
    const groups = groupSearchResults(sample);
    const labels = groups.map((group) => group.label);
    expect(labels).toEqual(['Pages', 'Databases', 'Rows']);
    expect(groups[0].results).toHaveLength(2);
    expect(groups[1].results.map((row) => row.id)).toEqual(['d-1']);
    expect(groups[2].results.map((row) => row.id)).toEqual(['r-1']);
  });

  it('groupSearchResults skips empty buckets', () => {
    const groups = groupSearchResults([
      { id: 'd-1', title: 'Reading List', icon: null, kind: 'database' },
    ]);
    expect(groups.map((group) => group.label)).toEqual(['Databases']);
  });

  it('flatSearchResults returns a flat list across all buckets', () => {
    const flat = flatSearchResults(sample);
    expect(flat).toHaveLength(4);
  });

  it('moveSearchIndex wraps forward and backward and returns -1 for empty', () => {
    expect(moveSearchIndex(0, 1, 3)).toBe(1);
    expect(moveSearchIndex(2, 1, 3)).toBe(0);
    expect(moveSearchIndex(0, -1, 3)).toBe(2);
    expect(moveSearchIndex(-1, 1, 3)).toBe(0);
    expect(moveSearchIndex(0, 1, 0)).toBe(-1);
  });

  it('databaseTitle finds the database id in the loaded tree', () => {
    const pages: Page[] = [
      { id: 'd-1', parentId: null, title: 'Reading List', icon: null, kind: 'database', position: 0 },
      { id: 'r-1', parentId: 'd-1', title: 'Project Hail Mary', icon: null, kind: 'row', position: 0 },
    ];
    expect(databaseTitle('d-1', pages)).toBe('Reading List');
    expect(databaseTitle('missing', pages)).toBeUndefined();
  });

  it('SEARCH_GROUPS preserves the stable order', () => {
    expect(SEARCH_GROUPS.map((group) => group.kind)).toEqual(['page', 'database', 'row']);
  });
});
