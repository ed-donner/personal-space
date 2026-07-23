import type Database from "better-sqlite3";

// Phase 5 search: a quick-find across page, database and row titles. The
// search is a case-insensitive substring match over every page row (a row is
// just a page of type 'row', a database is a page of type 'database'), so a
// single query against `pages` covers all three hit types. The parent's title
// is joined in so a row hit can carry its database's title and a page hit can
// carry its parent page's title (null at the root).

export type SearchHitType = "page" | "database" | "row";

export interface SearchHit {
  id: string;
  type: SearchHitType;
  title: string;
  icon: string;
  parentId: string | null;
  parentTitle: string | null;
}

/** Maximum number of results returned by a single search request. */
export const SEARCH_LIMIT = 20;

interface SearchRow {
  id: string;
  type: SearchHitType;
  title: string;
  icon: string;
  parent_id: string | null;
  parent_title: string | null;
  rank: number;
}

/**
 * SearchRepository owns the title search. It is constructed against an open
 * better-sqlite3 connection so tests can inject an in-memory database.
 */
export class SearchRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Search every page title for a case-insensitive substring match on `q`.
   *
   * Ranking (each step narrower than the last):
   *   0 - exact, case-insensitive title match
   *   1 - title starts with q (case-insensitive)
   *   2 - title contains q (case-insensitive)
   * Ties are broken by shorter title first, then alphabetical (case-folded).
   * At most SEARCH_LIMIT hits are returned.
   *
   * Empty / whitespace-only `q` returns an empty result list without touching
   * the database.
   */
  search(q: string): SearchHit[] {
    const trimmed = (q ?? "").trim();
    if (trimmed.length === 0) return [];

    // Escape LIKE wildcards in the user query so a literal % or _ in q is
    // treated as text, not a pattern. Backslash is the escape character.
    const escaped = trimmed
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    const pattern = `%${escaped}%`;

    const rows = this.db
      .prepare(
        `SELECT p.id         AS id,
                p.type        AS type,
                p.title       AS title,
                p.icon        AS icon,
                p.parent_id   AS parent_id,
                parent.title  AS parent_title,
                CASE
                  WHEN LOWER(p.title) = LOWER(@q)              THEN 0
                  WHEN LOWER(p.title) LIKE (@qLikePrefix)      THEN 1
                  ELSE 2
                END           AS rank
           FROM pages p
           LEFT JOIN pages parent ON parent.id = p.parent_id
          WHERE LOWER(p.title) LIKE @pattern ESCAPE '\\'
          ORDER BY rank ASC, LENGTH(p.title) ASC, LOWER(p.title) ASC
          LIMIT @limit`,
      )
      .all({
        q: trimmed,
        qLikePrefix: `${trimmed}%`,
        pattern,
        limit: SEARCH_LIMIT,
      }) as SearchRow[];

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      icon: r.icon,
      parentId: r.parent_id,
      parentTitle: r.parent_title,
    }));
  }
}
