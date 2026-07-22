import { Router } from 'express';
import type { DB } from '../db';

/**
 * Phase 4 — view settings.
 *
 * Settings shape (per CONTRACT.md):
 *   { filters: [{propertyId, op, value}], sort: {propertyId, direction}|null,
 *     groupBy: propertyId|null }
 *
 * Filter ops by property type:
 *   - text, url        -> contains
 *   - select           -> is, is_not           (value = optionId)
 *   - multi_select     -> is, is_not           (value = optionId; "contains option")
 *   - checkbox         -> is_checked, is_not_checked (value ignored)
 *   - date             -> before, after        (value = date string)
 *   - number           -> (no filter ops defined)
 *
 * Sort propertyId must be a property on the database OR the special string
 * 'title', which means "sort by the row's title column". This is a contract
 * extension approved by the orchestrator (see the Phase 4 backend task spec)
 * and documented here so the row title can be used as a sort key, which the
 * seed needs (Reading List list view and Renovation Tasks list view both sort
 * by title). The frontend interprets 'title' the same way.
 */

const VIEW_TYPES = ['table', 'board', 'list'] as const;
type ViewType = (typeof VIEW_TYPES)[number];

const FILTER_OPS_BY_TYPE: Record<string, ReadonlySet<string>> = {
  text: new Set(['contains']),
  url: new Set(['contains']),
  select: new Set(['is', 'is_not']),
  multi_select: new Set(['is', 'is_not']),
  checkbox: new Set(['is_checked', 'is_not_checked']),
  date: new Set(['before', 'after']),
  number: new Set(),
};

const ALL_FILTER_OPS = new Set<string>([
  'contains',
  'is',
  'is_not',
  'is_checked',
  'is_not_checked',
  'before',
  'after',
]);

interface PropertyRowLite {
  id: string;
  type: string;
  options: string | null;
}

interface FilterInput {
  propertyId?: unknown;
  op?: unknown;
  value?: unknown;
}

interface SortInput {
  propertyId?: unknown;
  direction?: unknown;
}

/**
 * Validates a settings object against the database's properties. Returns the
 * normalized settings (unknown top-level keys ignored) or throws an Error
 * with a message suitable for a 400 response.
 */
export function validateViewSettings(
  raw: unknown,
  properties: PropertyRowLite[]
): Record<string, unknown> {
  if (raw === null || raw === undefined) {
    return {};
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('settings must be an object');
  }

  const propById = new Map<string, PropertyRowLite>();
  for (const p of properties) propById.set(p.id, p);

  const settings = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  // filters: optional array of { propertyId, op, value }.
  if (settings.filters !== undefined) {
    if (settings.filters !== null) {
      if (!Array.isArray(settings.filters)) {
        throw new Error('filters must be an array');
      }
      const validatedFilters: FilterInput[] = [];
      for (const f of settings.filters) {
        if (!f || typeof f !== 'object' || Array.isArray(f)) {
          throw new Error('each filter must be an object');
        }
        const { propertyId, op, value } = f as FilterInput;
        if (typeof propertyId !== 'string' || propertyId.length === 0) {
          throw new Error('filter propertyId is required');
        }
        const prop = propById.get(propertyId);
        if (!prop) {
          throw new Error(`unknown filter property: ${propertyId}`);
        }
        if (typeof op !== 'string' || !ALL_FILTER_OPS.has(op)) {
          throw new Error(`unknown filter op: ${String(op)}`);
        }
        const allowed = FILTER_OPS_BY_TYPE[prop.type];
        if (!allowed || !allowed.has(op)) {
          throw new Error(
            `filter op '${op}' is not valid for ${prop.type} property`
          );
        }
        const checkboxOps = new Set(['is_checked', 'is_not_checked']);
        if (checkboxOps.has(op)) {
          // value is ignored; do not require it.
          validatedFilters.push({ propertyId, op });
        } else {
          if (value === undefined) {
            throw new Error(`filter value is required for op '${op}'`);
          }
          if (typeof value !== 'string') {
            throw new Error(`filter value for op '${op}' must be a string`);
          }
          validatedFilters.push({ propertyId, op, value });
        }
      }
      result.filters = validatedFilters;
    } else {
      // null -> treat as no filters
      result.filters = [];
    }
  }

  // sort: optional { propertyId, direction } | null.
  if (settings.sort !== undefined) {
    if (settings.sort === null) {
      result.sort = null;
    } else {
      if (
        !settings.sort ||
        typeof settings.sort !== 'object' ||
        Array.isArray(settings.sort)
      ) {
        throw new Error('sort must be an object or null');
      }
      const { propertyId, direction } = settings.sort as SortInput;
      if (typeof propertyId !== 'string' || propertyId.length === 0) {
        throw new Error('sort propertyId is required');
      }
      // 'title' is the special row-title sort key (see file header).
      if (propertyId !== 'title' && !propById.has(propertyId)) {
        throw new Error(`unknown sort property: ${propertyId}`);
      }
      if (direction !== 'asc' && direction !== 'desc') {
        throw new Error("sort direction must be 'asc' or 'desc'");
      }
      result.sort = { propertyId, direction };
    }
  }

  // groupBy: optional propertyId | null; must be an existing select property.
  if (settings.groupBy !== undefined) {
    if (settings.groupBy === null) {
      result.groupBy = null;
    } else {
      if (typeof settings.groupBy !== 'string' || settings.groupBy.length === 0) {
        throw new Error('groupBy must be a property id or null');
      }
      const prop = propById.get(settings.groupBy);
      if (!prop) {
        throw new Error(`unknown groupBy property: ${settings.groupBy}`);
      }
      if (prop.type !== 'select') {
        throw new Error('groupBy must reference a select property');
      }
      result.groupBy = settings.groupBy;
    }
  }

  // Unknown top-level keys are ignored (lenient, per the Phase 4 task spec).
  return result;
}

export function createViewsRouter(db: DB): Router {
  const router = Router();

  // PATCH /api/databases/:id/views/:viewType -> replace a view's settings.
  router.patch('/databases/:id/views/:viewType', (req, res) => {
    const viewType = req.params.viewType;
    if (!(VIEW_TYPES as readonly string[]).includes(viewType)) {
      return res.status(400).json({ error: 'viewType must be table, board or list' });
    }
    const page = db
      .prepare('SELECT kind FROM pages WHERE id = ?')
      .get(req.params.id) as { kind: string } | undefined;
    if (!page || page.kind !== 'database') {
      return res.status(404).json({ error: 'Database not found' });
    }

    const body = req.body ?? {};
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'body must be an object' });
    }
    if (body.settings === undefined) {
      return res.status(400).json({ error: 'settings is required' });
    }

    const properties = db
      .prepare('SELECT id, type, options FROM properties WHERE database_id = ?')
      .all(req.params.id) as PropertyRowLite[];

    let normalized: Record<string, unknown>;
    try {
      normalized = validateViewSettings(body.settings, properties);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }

    db.prepare(
      'UPDATE views SET settings = ? WHERE database_id = ? AND view_type = ?'
    ).run(JSON.stringify(normalized), req.params.id, viewType);

    // Return the full updated views object per the contract.
    const viewRows = db
      .prepare('SELECT view_type, settings FROM views WHERE database_id = ?')
      .all(req.params.id) as { view_type: string; settings: string | null }[];
    const views: Record<string, unknown> = {};
    for (const v of viewRows) {
      views[v.view_type] = v.settings ? JSON.parse(v.settings) : {};
    }
    res.json(views);
  });

  return router;
}
