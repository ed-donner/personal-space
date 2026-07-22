import { Router } from 'express';
import { nanoid } from 'nanoid';
import type { DB } from '../db';

export type BlockType =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bulleted'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'divider'
  | 'code'
  | 'callout';

const BLOCK_TYPES: BlockType[] = [
  'paragraph',
  'h1',
  'h2',
  'h3',
  'bulleted',
  'numbered',
  'todo',
  'quote',
  'divider',
  'code',
  'callout',
];

function isBlockType(value: unknown): value is BlockType {
  return typeof value === 'string' && (BLOCK_TYPES as string[]).includes(value);
}

interface BlockRow {
  id: string;
  page_id: string;
  type: string;
  content: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Block {
  id: string;
  pageId: string;
  type: string;
  content: Record<string, unknown> | null;
  position: number;
}

/** Default content for a freshly created block of the given type. */
function defaultContent(type: BlockType): Record<string, unknown> | null {
  switch (type) {
    case 'todo':
      return { text: '', checked: false };
    case 'divider':
      return {};
    default:
      // text-ish blocks: paragraph, h1, h2, h3, bulleted, numbered, quote, code, callout
      return { text: '' };
  }
}

function toBlock(row: BlockRow): Block {
  return {
    id: row.id,
    pageId: row.page_id,
    type: row.type,
    content: row.content ? (JSON.parse(row.content) as Record<string, unknown>) : null,
    position: row.position,
  };
}

function getBlock(db: DB, id: string): BlockRow | undefined {
  return db.prepare('SELECT * FROM blocks WHERE id = ?').get(id) as BlockRow | undefined;
}

function pageExists(db: DB, id: string): boolean {
  const row = db.prepare('SELECT 1 FROM pages WHERE id = ?').get(id);
  return row !== undefined;
}

/** Returns ids of all blocks belonging to a page, ordered by position. */
function blockIdsForPage(db: DB, pageId: string): string[] {
  const rows = db
    .prepare('SELECT id FROM blocks WHERE page_id = ? ORDER BY position ASC, id ASC')
    .all(pageId) as { id: string }[];
  return rows.map((r) => r.id);
}

export function createBlocksRouter(db: DB): Router {
  const router = Router();

  // GET /api/pages/:id/blocks -> { blocks: Block[] } ordered by position.
  router.get('/pages/:id/blocks', (req, res) => {
    if (!pageExists(db, req.params.id)) {
      return res.status(404).json({ error: 'Page not found' });
    }
    const rows = db
      .prepare('SELECT * FROM blocks WHERE page_id = ? ORDER BY position ASC, id ASC')
      .all(req.params.id) as BlockRow[];
    res.json({ blocks: rows.map(toBlock) });
  });

  // POST /api/pages/:id/blocks -> create a block; default content per type;
  // optional 0-based `position` insertion index, append by default.
  router.post('/pages/:id/blocks', (req, res) => {
    const pageId = req.params.id;
    if (!pageExists(db, pageId)) {
      return res.status(404).json({ error: 'Page not found' });
    }
    const body = req.body ?? {};
    const type = body.type;
    if (!isBlockType(type)) {
      return res.status(400).json({ error: `Unknown block type: ${String(type)}` });
    }

    // Content: if supplied, must be an object. Otherwise default for the type.
    let content: Record<string, unknown> | null;
    if (body.content === undefined) {
      content = defaultContent(type);
    } else if (body.content === null || typeof body.content !== 'object' || Array.isArray(body.content)) {
      return res.status(400).json({ error: 'content must be an object' });
    } else {
      content = { ...body.content } as Record<string, unknown>;
      // todo: checked defaults to false when absent.
      if (type === 'todo' && content.checked === undefined) {
        content.checked = false;
      }
    }

    const now = new Date().toISOString();
    const id = nanoid();

    db.transaction(() => {
      const count = db
        .prepare('SELECT COUNT(*) AS c FROM blocks WHERE page_id = ?')
        .get(pageId) as { c: number };

      let position: number;
      if (body.position === undefined || body.position === null) {
        position = count.c; // append at end
      } else {
        position = Number(body.position);
        if (!Number.isInteger(position) || position < 0) {
          throw new Error('position must be a non-negative integer');
        }
        if (position > count.c) position = count.c; // clamp to append
        // Shift existing blocks at/after `position` up by one.
        db.prepare(
          'UPDATE blocks SET position = position + 1 WHERE page_id = ? AND position >= ?'
        ).run(pageId, position);
      }

      db.prepare(
        `INSERT INTO blocks (id, page_id, type, content, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, pageId, type, JSON.stringify(content), position, now, now);
    })();

    const row = getBlock(db, id)!;
    res.status(201).json(toBlock(row));
  });

  // PATCH /api/blocks/:id -> merge content (shallow) and/or change type.
  router.patch('/blocks/:id', (req, res) => {
    const existing = getBlock(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Block not found' });

    const body = req.body ?? {};
    const { content, type } = body as {
      content?: Record<string, unknown>;
      type?: string;
    };

    let newType: BlockType | undefined;
    if (type !== undefined) {
      if (!isBlockType(type)) {
        return res.status(400).json({ error: `Unknown block type: ${String(type)}` });
      }
      newType = type;
    }

    let mergedContent: Record<string, unknown> | null;
    const existingContent: Record<string, unknown> | null = existing.content
      ? (JSON.parse(existing.content) as Record<string, unknown>)
      : null;

    if (newType === 'divider') {
      // Converting to divider: content becomes {}.
      mergedContent = {};
    } else if (content !== undefined) {
      if (content === null || typeof content !== 'object' || Array.isArray(content)) {
        return res.status(400).json({ error: 'content must be an object' });
      }
      // Shallow merge over existing content.
      mergedContent = { ...(existingContent ?? {}), ...content };
      // Converting TO todo: default checked:false if absent.
      if (newType === 'todo' && mergedContent.checked === undefined) {
        mergedContent.checked = false;
      }
    } else if (newType !== undefined) {
      // Type changed but no content supplied: derive the merged content.
      if (newType === 'todo') {
        mergedContent = {
          text: existingContent?.text ?? '',
          checked: existingContent?.checked ?? false,
        };
      } else {
        // Non-divider type change: keep existing text if present, else ''.
        mergedContent = { ...(existingContent ?? {}) };
        if (mergedContent.text === undefined) mergedContent.text = '';
      }
    } else {
      // No type change, no content: nothing to update.
      mergedContent = existingContent;
    }

    const now = new Date().toISOString();
    const sets: string[] = [];
    const params: unknown[] = [];
    if (newType !== undefined) {
      sets.push('type = ?');
      params.push(newType);
    }
    sets.push('content = ?');
    params.push(JSON.stringify(mergedContent));
    sets.push('updated_at = ?');
    params.push(now);
    params.push(req.params.id);

    db.prepare(`UPDATE blocks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    res.json(toBlock(getBlock(db, req.params.id)!));
  });

  // DELETE /api/blocks/:id -> { deleted: 1 }. Positions are not compacted.
  router.delete('/blocks/:id', (req, res) => {
    const existing = getBlock(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Block not found' });
    db.prepare('DELETE FROM blocks WHERE id = ?').run(req.params.id);
    res.json({ deleted: 1 });
  });

  // PUT /api/pages/:id/blocks/order -> reorder. ids must be exactly the page's
  // current block ids (same set, no extras, no missing). position = index.
  router.put('/pages/:id/blocks/order', (req, res) => {
    const pageId = req.params.id;
    if (!pageExists(db, pageId)) {
      return res.status(404).json({ error: 'Page not found' });
    }
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) {
      return res.status(400).json({ error: 'ids must be an array of strings' });
    }
    const current = blockIdsForPage(db, pageId);
    const currentSet = new Set(current);
    const incomingSet = new Set(ids);

    if (current.length !== ids.length || currentSet.size !== incomingSet.size) {
      return res
        .status(400)
        .json({ error: 'ids must contain exactly the page block ids' });
    }
    for (const id of ids) {
      if (!currentSet.has(id)) {
        return res
          .status(400)
          .json({ error: 'ids must contain exactly the page block ids' });
      }
    }

    const now = new Date().toISOString();
    const update = db.prepare(
      'UPDATE blocks SET position = ?, updated_at = ? WHERE id = ?'
    );
    db.transaction(() => {
      ids.forEach((id: string, i: number) => update.run(i, now, id));
    })();

    const rows = db
      .prepare('SELECT * FROM blocks WHERE page_id = ? ORDER BY position ASC, id ASC')
      .all(pageId) as BlockRow[];
    res.json({ blocks: rows.map(toBlock) });
  });

  return router;
}
