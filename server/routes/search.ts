import { Router } from 'express';
import type { DB } from '../db';

type PageKind = 'page' | 'database' | 'row';

interface SearchRow {
  id: string;
  title: string;
  icon: string | null;
  kind: PageKind;
  parent_id: string | null;
}

interface SearchResult {
  id: string;
  title: string;
  icon: string | null;
  kind: PageKind;
  databaseId?: string;
}

/**
 * Phase 5 — quick-find across page, database and row titles.
 *
 * Per CONTRACT.md:
 *   GET /api/search?q=... -> { results: [{ id, title, icon, kind, databaseId? }] }
 *   matching page, database and row titles, case-insensitive, ordered by title.
 *   `databaseId` is set for rows (so the UI can offer "open in database").
 *   Empty/short q (< 1 char) returns { results: [] }.
 *
 * Matching is a case-insensitive substring on the stored title across all
 * three page kinds. Results carry only the listed fields (no blocks or
 * property values leak through). Ordered by title using locale-aware,
 * case-insensitive comparison, with `kind` as a stable tiebreaker. Capped
 * at 50 results.
 */
export function createSearchRouter(db: DB): Router {
  const router = Router();

  router.get('/search', (req, res) => {
    const raw = req.query.q;
    // Treat missing / non-string / empty as an empty query.
    const q = typeof raw === 'string' ? raw.trim() : '';
    if (q.length < 1) {
      return res.json({ results: [] });
    }

    // Case-insensitive substring match on title across all three kinds.
    // We use INSTR (not LIKE) so the query is treated literally: SQL LIKE
    // would treat `%` and `_` as wildcards, so searching for "%" or "_"
    // would return every page. INSTR on both LOWER()s keeps the
    // case-insensitive substring semantics the contract requires.
    const needle = q.toLowerCase();
    const rows = db
      .prepare(
        `SELECT id, title, icon, kind, parent_id FROM pages
         WHERE kind IN ('page', 'database', 'row')
           AND INSTR(LOWER(title), ?) > 0
         ORDER BY title ASC, kind ASC`
      )
      .all(needle) as SearchRow[];

    const results: SearchResult[] = rows.map((r) => {
      const out: SearchResult = {
        id: r.id,
        title: r.title,
        icon: r.icon,
        kind: r.kind,
      };
      if (r.kind === 'row') {
        out.databaseId = r.parent_id ?? undefined;
      }
      return out;
    });

    // Locale-aware, case-insensitive title sort with kind as a stable
    // tiebreaker. localeCompare with sensitivity 'base' ignores case and
    // accents, which is the natural "quick-find" behavior.
    results.sort((a, b) => {
      const byTitle = a.title.localeCompare(b.title, undefined, {
        sensitivity: 'base',
      });
      if (byTitle !== 0) return byTitle;
      return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
    });

    return res.json({ results: results.slice(0, 50) });
  });

  return router;
}
