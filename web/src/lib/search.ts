import type { Page, SearchResult } from './api';

export type { SearchResult } from './api';

export const SEARCH_GROUPS = [
  { kind: 'page' as const, label: 'Pages' },
  { kind: 'database' as const, label: 'Databases' },
  { kind: 'row' as const, label: 'Rows' },
];

export function groupSearchResults(results: SearchResult[]) {
  return SEARCH_GROUPS.map((group) => ({
    ...group,
    results: results.filter((result) => result.kind === group.kind),
  })).filter((group) => group.results.length > 0);
}

export function flatSearchResults(results: SearchResult[]) {
  return groupSearchResults(results).flatMap((group) => group.results);
}

export function moveSearchIndex(index: number, delta: number, count: number) {
  if (!count) return -1;
  return (index + delta + count) % count;
}

export function databaseTitle(databaseId: string | undefined, pages: Page[]) {
  return pages.find((page) => page.id === databaseId)?.title;
}
