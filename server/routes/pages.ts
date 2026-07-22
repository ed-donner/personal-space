import { Router } from 'express';
import { nanoid } from 'nanoid';
import type { DB } from '../db';

type PageKind = 'page' | 'database' | 'row';

interface PageRow {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  kind: PageKind;
  position: number;
  values: string | null;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  kind: PageKind;
  position: number;
  values?: Record<string, unknown>;
}

/** Maps a DB row to the JSON Page shape from CONTRACT.md. */
function toPage(row: PageRow): Page {
  const page: Page = {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    kind: row.kind,
    position: row.position,
  };
  // `values` is only present on rows, per the contract.
  if (row.kind === 'row') {
    page.values = row.values ? (JSON.parse(row.values) as Record<string, unknown>) : {};
  }
  return page;
}

const VIEW_TYPES = ['table', 'board', 'list'] as const;

function getPage(db: DB, id: string): PageRow | undefined {
  return db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow | undefined;
}

export function createPagesRouter(db: DB): Router {
  const router = Router();

  // GET /api/tree -> flat list of pages and databases, ordered for display.
  router.get('/tree', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT * FROM pages
         WHERE kind IN ('page', 'database')
         ORDER BY COALESCE(parent_id, ''), position ASC, id ASC`
      )
      .all() as PageRow[];
    res.json({ pages: rows.map(toPage) });
  });

  // GET /api/pages/:id -> a single page; 404 when missing.
  router.get('/pages/:id', (req, res) => {
    const row = getPage(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'Page not found' });
    res.json(toPage(row));
  });

  // POST /api/pages -> create a page (or database). Defaults per contract.
  router.post('/pages', (req, res) => {
    const body = req.body ?? {};
    const parentId = body.parentId ?? null;
    const title = body.title ?? 'Untitled';
    const icon = body.icon ?? null;
    const kind: string = body.kind ?? 'page';

    if (kind !== 'page' && kind !== 'database') {
      return res.status(400).json({ error: "kind must be 'page' or 'database'" });
    }

    // Append after existing siblings sharing the same parent.
    const pos = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS maxpos FROM pages WHERE parent_id IS ?')
      .get(parentId) as { maxpos: number };
    const position = pos.maxpos + 1;

    const id = nanoid();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO pages (id, parent_id, title, icon, kind, position, "values", created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(id, parentId, title, icon, kind, position, now, now);

    if (kind === 'database') {
      const insertView = db.prepare(
        'INSERT INTO views (database_id, view_type, settings) VALUES (?, ?, ?)'
      );
      for (const vt of VIEW_TYPES) {
        insertView.run(id, vt, '{}');
      }
    }

    const row = getPage(db, id)!;
    res.status(201).json(toPage(row));
  });

  // PATCH /api/pages/:id -> update title/icon/position; whitespace title -> 400.
  router.patch('/pages/:id', (req, res) => {
    const existing = getPage(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Page not found' });

    const body = req.body ?? {};
    const { title, icon, position } = body as {
      title?: string;
      icon?: string | null;
      position?: number;
    };

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim() === '') {
        return res.status(400).json({ error: 'title must not be empty or whitespace' });
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (title !== undefined) {
      sets.push('title = ?');
      params.push(title);
    }
    if (icon !== undefined) {
      sets.push('icon = ?');
      params.push(icon);
    }
    if (position !== undefined) {
      sets.push('position = ?');
      params.push(position);
    }
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id);

    db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    res.json(toPage(getPage(db, req.params.id)!));
  });

  // DELETE /api/pages/:id -> recursive cascade. { deleted: <page count> }.
  router.delete('/pages/:id', (req, res) => {
    const existing = getPage(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Page not found' });

    // Gather the page and every descendant via a recursive CTE.
    const rows = db
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM pages WHERE id = ?
           UNION ALL
           SELECT p.id FROM pages p JOIN descendants d ON p.parent_id = d.id
         )
         SELECT id FROM descendants`
      )
      .all(req.params.id) as { id: string }[];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');

    db.transaction(() => {
      db.prepare(`DELETE FROM blocks WHERE page_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM properties WHERE database_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM views WHERE database_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM pages WHERE id IN (${placeholders})`).run(...ids);
    })();

    res.json({ deleted: ids.length });
  });

  return router;
}
