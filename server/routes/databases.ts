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

interface PropertyRow {
  id: string;
  database_id: string;
  name: string;
  type: string;
  options: string | null;
  position: number;
}

export interface Option {
  id: string;
  label: string;
  color: string;
}

export interface Property {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  options: Option[] | null;
  position: number;
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

const PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
] as const;
type PropertyType = (typeof PROPERTY_TYPES)[number];

const DEFAULT_OPTION_COLOR = '#8a8f98';

function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as string[]).includes(value);
}

function toPage(row: PageRow): Page {
  const page: Page = {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    kind: row.kind,
    position: row.position,
  };
  if (row.kind === 'row') {
    page.values = row.values ? (JSON.parse(row.values) as Record<string, unknown>) : {};
  }
  return page;
}

function toProperty(row: PropertyRow): Property {
  return {
    id: row.id,
    databaseId: row.database_id,
    name: row.name,
    type: row.type,
    options: row.options ? (JSON.parse(row.options) as Option[]) : null,
    position: row.position,
  };
}

/** Fills in missing ids and colors on a list of option objects. */
function normalizeOptions(options: unknown): Option[] {
  if (!Array.isArray(options)) {
    throw new Error('options must be an array');
  }
  const result: Option[] = [];
  for (const raw of options) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('each option must be an object');
    }
    const o = raw as { id?: string; label?: string; color?: string };
    if (typeof o.label !== 'string' || o.label.trim() === '') {
      throw new Error('option label is required');
    }
    result.push({
      id: typeof o.id === 'string' && o.id.length > 0 ? o.id : nanoid(),
      label: o.label,
      color:
        typeof o.color === 'string' && o.color.length > 0
          ? o.color
          : DEFAULT_OPTION_COLOR,
    });
  }
  return result;
}

function getPage(db: DB, id: string): PageRow | undefined {
  return db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow | undefined;
}

function getProperty(db: DB, id: string): PropertyRow | undefined {
  return db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as
    | PropertyRow
    | undefined;
}

/**
 * Validates a single cell value against its property definition.
 * Returns the normalized value to store, or throws on invalid input.
 * `null` always clears (returns null).
 */
function validateCellValue(
  value: unknown,
  type: string,
  optionIds: Set<string>
): unknown {
  if (value === null) return null;
  switch (type) {
    case 'text':
    case 'url':
    case 'date': {
      if (typeof value !== 'string') {
        throw new Error(`${type} value must be a string or null`);
      }
      return value;
    }
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error('number value must be a number or null');
      }
      return value;
    }
    case 'select': {
      if (typeof value !== 'string' || !optionIds.has(value)) {
        throw new Error('select value must be a valid option id or null');
      }
      return value;
    }
    case 'multi_select': {
      if (!Array.isArray(value)) {
        throw new Error('multi_select value must be an array of option ids or null');
      }
      for (const v of value) {
        if (typeof v !== 'string' || !optionIds.has(v)) {
          throw new Error('multi_select value must contain valid option ids');
        }
      }
      return value;
    }
    case 'checkbox': {
      if (typeof value !== 'boolean') {
        throw new Error('checkbox value must be a boolean or null');
      }
      return value;
    }
    default:
      throw new Error(`unknown property type: ${type}`);
  }
}

export function createDatabasesRouter(db: DB): Router {
  const router = Router();

  // GET /api/databases/:id -> database shape with properties, rows, views.
  router.get('/databases/:id', (req, res) => {
    const page = getPage(db, req.params.id);
    if (!page || page.kind !== 'database') {
      return res.status(404).json({ error: 'Database not found' });
    }
    const properties = db
      .prepare(
        'SELECT * FROM properties WHERE database_id = ? ORDER BY position ASC, id ASC'
      )
      .all(req.params.id) as PropertyRow[];
    const rows = db
      .prepare(
        'SELECT * FROM pages WHERE parent_id = ? AND kind = ? ORDER BY position ASC, id ASC'
      )
      .all(req.params.id, 'row') as PageRow[];
    const viewRows = db
      .prepare('SELECT view_type, settings FROM views WHERE database_id = ?')
      .all(req.params.id) as { view_type: string; settings: string | null }[];

    const views: Record<string, unknown> = {};
    for (const v of viewRows) {
      views[v.view_type] = v.settings ? JSON.parse(v.settings) : {};
    }

    res.json({
      page: toPage(page),
      properties: properties.map(toProperty),
      rows: rows.map(toPage),
      views,
    });
  });

  // POST /api/databases/:id/properties -> create a property.
  router.post('/databases/:id/properties', (req, res) => {
    const page = getPage(db, req.params.id);
    if (!page || page.kind !== 'database') {
      return res.status(404).json({ error: 'Database not found' });
    }
    const body = req.body ?? {};
    const name = body.name;
    if (typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'name must not be empty' });
    }
    const type = body.type;
    if (!isPropertyType(type)) {
      return res.status(400).json({ error: 'invalid property type' });
    }

    let optionsJson: string | null = null;
    if (type === 'select' || type === 'multi_select') {
      let options: unknown = body.options;
      if (options === undefined || options === null) {
        options = [];
      }
      try {
        const normalized = normalizeOptions(options);
        optionsJson = JSON.stringify(normalized);
      } catch (e) {
        return res.status(400).json({ error: (e as Error).message });
      }
    }

    const pos = db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) AS maxpos FROM properties WHERE database_id = ?'
      )
      .get(req.params.id) as { maxpos: number };
    const position = pos.maxpos + 1;
    const id = nanoid();
    db.prepare(
      `INSERT INTO properties (id, database_id, name, type, options, position)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, req.params.id, name, type, optionsJson, position);

    res.status(201).json(toProperty(getProperty(db, id)!));
  });

  // PATCH /api/properties/:id -> rename and/or replace select options.
  router.patch('/properties/:id', (req, res) => {
    const existing = getProperty(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Property not found' });

    const body = req.body ?? {};
    const { name, options, type } = body as {
      name?: string;
      options?: unknown;
      type?: string;
    };

    if (type !== undefined && type !== existing.type) {
      return res.status(400).json({ error: 'property type is fixed' });
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'name must not be empty' });
      }
    }

    let optionsJson: string | null | undefined;
    if (options !== undefined) {
      if (existing.type !== 'select' && existing.type !== 'multi_select') {
        return res
          .status(400)
          .json({ error: 'options can only be set on select or multi_select' });
      }
      try {
        const normalized = normalizeOptions(options);
        optionsJson = JSON.stringify(normalized);
      } catch (e) {
        return res.status(400).json({ error: (e as Error).message });
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (name !== undefined) {
      sets.push('name = ?');
      params.push(name);
    }
    if (optionsJson !== undefined) {
      sets.push('options = ?');
      params.push(optionsJson);
    }
    if (sets.length === 0) {
      return res.json(toProperty(existing));
    }
    params.push(req.params.id);

    db.transaction(() => {
      db.prepare(`UPDATE properties SET ${sets.join(', ')} WHERE id = ?`).run(...params);

      // DEF-004: when select/multi_select options are replaced, strip dangling
      // option ids from every row of this database so cells do not silently
      // render "Empty" while storing an orphaned id. Done in the same
      // transaction as the options update. For select: drop the key when the
      // stored id is not in the new option set. For multi_select: filter the
      // stored array to ids still present, and drop the key if it empties.
      if (optionsJson !== undefined) {
        const newOptionIds = new Set<string>();
        if (optionsJson) {
          for (const o of JSON.parse(optionsJson) as Option[]) newOptionIds.add(o.id);
        }
        const rows = db
          .prepare(
            'SELECT id, "values" FROM pages WHERE parent_id = ? AND kind = ?'
          )
          .all(existing.database_id, 'row') as {
          id: string;
          values: string | null;
        }[];
        const now = new Date().toISOString();
        for (const r of rows) {
          if (!r.values) continue;
          const obj = JSON.parse(r.values) as Record<string, unknown>;
          if (!(existing.id in obj)) continue;
          const v = obj[existing.id];
          let changed = false;
          if (existing.type === 'select') {
            if (typeof v === 'string' && !newOptionIds.has(v)) {
              delete obj[existing.id];
              changed = true;
            }
          } else if (existing.type === 'multi_select') {
            if (Array.isArray(v)) {
              const filtered = v.filter(
                (item) => typeof item === 'string' && newOptionIds.has(item)
              );
              if (filtered.length !== (v as unknown[]).length) {
                if (filtered.length === 0) {
                  delete obj[existing.id];
                } else {
                  obj[existing.id] = filtered;
                }
                changed = true;
              }
            }
          }
          if (changed) {
            db.prepare(
              'UPDATE pages SET "values" = ?, updated_at = ? WHERE id = ?'
            ).run(JSON.stringify(obj), now, r.id);
          }
        }
      }
    })();

    res.json(toProperty(getProperty(db, req.params.id)!));
  });

  // DELETE /api/properties/:id -> delete property and strip its key from row values.
  router.delete('/properties/:id', (req, res) => {
    const existing = getProperty(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Property not found' });

    db.transaction(() => {
      db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id);
      const rows = db
        .prepare(
          'SELECT id, "values" FROM pages WHERE parent_id = ? AND kind = ?'
        )
        .all(existing.database_id, 'row') as { id: string; values: string | null }[];
      for (const r of rows) {
        if (!r.values) continue;
        const obj = JSON.parse(r.values) as Record<string, unknown>;
        if (!(existing.id in obj)) continue;
        delete obj[existing.id];
        db.prepare('UPDATE pages SET "values" = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(obj),
          new Date().toISOString(),
          r.id
        );
      }

      // DEF-006 / DEF-007: scrub every view's settings for this database so
      // filters/sorts/groupBy referencing the deleted property do not linger
      // and silently stop narrowing/sorting/grouping. Done in the same
      // transaction as the property delete. Filters referencing the deleted
      // property are removed; sort and groupBy referencing it are set to
      // null. Settings for other properties are left untouched.
      const viewRows = db
        .prepare('SELECT view_type, settings FROM views WHERE database_id = ?')
        .all(existing.database_id) as {
        view_type: string;
        settings: string | null;
      }[];
      for (const v of viewRows) {
        if (!v.settings) continue;
        const settings = JSON.parse(v.settings) as Record<string, unknown>;
        let changed = false;

        if (Array.isArray(settings.filters)) {
          const filtered = (settings.filters as Array<{
            propertyId?: unknown;
          }>).filter((f) => f && f.propertyId !== existing.id);
          if (filtered.length !== (settings.filters as unknown[]).length) {
            settings.filters = filtered;
            changed = true;
          }
        }

        if (
          settings.sort &&
          typeof settings.sort === 'object' &&
          !Array.isArray(settings.sort)
        ) {
          const sort = settings.sort as { propertyId?: unknown };
          if (sort.propertyId === existing.id) {
            settings.sort = null;
            changed = true;
          }
        }

        if (settings.groupBy === existing.id) {
          settings.groupBy = null;
          changed = true;
        }

        if (changed) {
          db.prepare(
            'UPDATE views SET settings = ? WHERE database_id = ? AND view_type = ?'
          ).run(JSON.stringify(settings), existing.database_id, v.view_type);
        }
      }
    })();

    res.json({ deleted: 1 });
  });

  // POST /api/databases/:id/rows -> create a row under the database.
  router.post('/databases/:id/rows', (req, res) => {
    const page = getPage(db, req.params.id);
    if (!page || page.kind !== 'database') {
      return res.status(404).json({ error: 'Database not found' });
    }
    const body = req.body ?? {};
    const title = typeof body.title === 'string' ? body.title : 'Untitled';

    const pos = db
      .prepare(
        `SELECT COALESCE(MAX(position), -1) AS maxpos
         FROM pages WHERE parent_id IS ? AND kind = 'row'`
      )
      .get(req.params.id) as { maxpos: number };
    const position = pos.maxpos + 1;
    const id = nanoid();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO pages (id, parent_id, title, icon, kind, position, "values", created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'row', ?, '{}', ?, ?)`
    ).run(id, req.params.id, title, position, now, now);

    res.status(201).json(toPage(getPage(db, id)!));
  });

  // PATCH /api/rows/:id -> rename and/or merge values.
  router.patch('/rows/:id', (req, res) => {
    const existing = getPage(db, req.params.id);
    if (!existing || existing.kind !== 'row') {
      return res.status(404).json({ error: 'Row not found' });
    }
    const body = req.body ?? {};
    const { title, values } = body as {
      title?: string;
      values?: Record<string, unknown>;
    };

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim() === '') {
        return res.status(400).json({ error: 'title must not be empty' });
      }
    }

    let mergedValues: Record<string, unknown> | undefined;
    if (values !== undefined) {
      if (values === null || typeof values !== 'object' || Array.isArray(values)) {
        return res.status(400).json({ error: 'values must be an object' });
      }
      // Look up the properties of this row's database once.
      const props = db
        .prepare('SELECT * FROM properties WHERE database_id = ?')
        .all(existing.parent_id) as PropertyRow[];
      const propById = new Map<string, PropertyRow>();
      const optionIdsByProp = new Map<string, Set<string>>();
      for (const p of props) {
        propById.set(p.id, p);
        if (p.options) {
          const opts = JSON.parse(p.options) as Option[];
          optionIdsByProp.set(p.id, new Set(opts.map((o) => o.id)));
        } else {
          optionIdsByProp.set(p.id, new Set());
        }
      }

      const current = existing.values
        ? (JSON.parse(existing.values) as Record<string, unknown>)
        : {};
      mergedValues = { ...current };
      for (const [key, value] of Object.entries(values)) {
        const prop = propById.get(key);
        if (!prop) {
          return res
            .status(400)
            .json({ error: `unknown property id: ${key}` });
        }
        try {
          mergedValues[key] = validateCellValue(
            value,
            prop.type,
            optionIdsByProp.get(key)!
          );
        } catch (e) {
          return res.status(400).json({ error: (e as Error).message });
        }
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (title !== undefined) {
      sets.push('title = ?');
      params.push(title);
    }
    if (mergedValues !== undefined) {
      sets.push('"values" = ?');
      params.push(JSON.stringify(mergedValues));
    }
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id);
    db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    res.json(toPage(getPage(db, req.params.id)!));
  });

  // DELETE /api/rows/:id -> delete the row and its blocks.
  router.delete('/rows/:id', (req, res) => {
    const existing = getPage(db, req.params.id);
    if (!existing || existing.kind !== 'row') {
      return res.status(404).json({ error: 'Row not found' });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM blocks WHERE page_id = ?').run(req.params.id);
      db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);
    })();
    res.json({ deleted: 1 });
  });

  return router;
}
