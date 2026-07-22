import { nanoid } from 'nanoid';
import type { DB } from './db';

/**
 * Data-driven seed structure. Phase 3 extends pages with `kind: 'database'`,
 * `properties` and `rows` (each row may carry its own `blocks`).
 */
export interface SeedBlock {
  type: string;
  content?: Record<string, unknown>;
}

export interface SeedOption {
  id?: string;
  label: string;
  color: string;
}

export interface SeedProperty {
  name: string;
  type: 'text' | 'number' | 'select' | 'multi_select' | 'date' | 'checkbox' | 'url';
  options?: SeedOption[];
}

export interface SeedRow {
  title: string;
  values?: Record<string, unknown>;
  blocks?: SeedBlock[];
}

/**
 * Per-view settings for a seeded database. Property names and option labels
 * are resolved to ids at insert time. `sort.propertyId` may be the special
 * string 'title' to mean "sort by row title" (matches the views API
 * validation, which accepts 'title' as a sort property).
 */
export interface SeedViewSettings {
  filters?: {
    propertyId: string; // property name
    op: 'contains' | 'is' | 'is_not' | 'is_checked' | 'is_not_checked' | 'before' | 'after';
    value?: unknown;
  }[];
  sort?: { propertyId: string; direction: 'asc' | 'desc' } | null;
  groupBy?: string | null; // property name
}

export interface SeedViews {
  table?: SeedViewSettings;
  board?: SeedViewSettings;
  list?: SeedViewSettings;
}

export interface SeedPage {
  title: string;
  icon: string;
  kind?: 'page' | 'database';
  children?: SeedPage[];
  blocks?: SeedBlock[];
  properties?: SeedProperty[];
  rows?: SeedRow[];
  views?: SeedViews;
}

const VIEW_TYPES = ['table', 'board', 'list'] as const;

const SEED_PAGES: SeedPage[] = [
  {
    title: 'Projects',
    icon: '📋',
    children: [
      {
        title: 'Home Renovation',
        icon: '🏡',
        blocks: [
          {
            type: 'paragraph',
            content: {
              text: 'Kitchen first, then the bathroom. Budget is tight this year.',
            },
          },
          {
            type: 'quote',
            content: { text: 'Measure twice, cut once.' },
          },
        ],
        children: [
          { title: 'Paint & Materials', icon: '🖌️', blocks: [
            { type: 'callout', content: { text: 'Dulux trade paint is worth the premium for the hallway.' } },
            { type: 'bulleted', content: { text: 'Eggshell for walls' } },
            { type: 'bulleted', content: { text: 'Gloss for woodwork' } },
            { type: 'todo', content: { text: 'Colour-match the landing wall', checked: false } },
          ] },
          { title: 'Contractor Quotes', icon: '🔨', blocks: [
            { type: 'paragraph', content: { text: 'Three quotes for the kitchen rewire.' } },
            { type: 'numbered', content: { text: 'Sparks Direct — £780, can start August' } },
            { type: 'numbered', content: { text: 'JW Electrical — £865, two-week wait' } },
            { type: 'todo', content: { text: 'Check JW\'s Part P registration', checked: false } },
          ] },
          {
            title: 'Renovation Tasks',
            icon: '🔨',
            kind: 'database',
            properties: [
              {
                name: 'Room',
                type: 'select',
                options: [
                  { label: 'Kitchen', color: '#ecad0a' },
                  { label: 'Bathroom', color: '#209dd7' },
                  { label: 'Living room', color: '#753991' },
                  { label: 'Garden', color: '#3d9a50' },
                ],
              },
              { name: 'Cost estimate', type: 'number' },
              {
                name: 'Priority',
                type: 'select',
                options: [
                  { label: 'High', color: '#c0392b' },
                  { label: 'Medium', color: '#ecad0a' },
                  { label: 'Low', color: '#8a8f98' },
                ],
              },
              { name: 'Target date', type: 'date' },
              { name: 'Done', type: 'checkbox' },
              { name: 'Supplier', type: 'url' },
              { name: 'Notes', type: 'text' },
            ],
            rows: [
              {
                title: 'Replace worktops',
                values: {
                  Room: 'Kitchen',
                  'Cost estimate': 2400,
                  Priority: 'High',
                  'Target date': '2026-09-15',
                  Done: false,
                  Supplier: 'https://example-supplier.com/worktops',
                  Notes: 'Get three quotes first',
                },
                blocks: [
                  { type: 'todo', content: { text: 'Call the carpenter back', checked: false } },
                  {
                    type: 'paragraph',
                    content: { text: 'Quartz over laminate if the quote gap is small.' },
                  },
                ],
              },
              {
                title: 'Rewire kitchen sockets',
                values: {
                  Room: 'Kitchen',
                  'Cost estimate': 800,
                  Priority: 'High',
                  'Target date': '2026-08-30',
                  Done: false,
                  Supplier: null,
                  Notes: 'Needs Part P sign-off',
                },
              },
              {
                title: 'Retile the shower',
                values: {
                  Room: 'Bathroom',
                  'Cost estimate': 1300,
                  Priority: 'Medium',
                  'Target date': '2026-10-01',
                  Done: false,
                  Supplier: null,
                  Notes: null,
                },
              },
              {
                title: 'Paint the living room',
                values: {
                  Room: 'Living room',
                  'Cost estimate': 200,
                  Priority: 'Low',
                  'Target date': '2026-08-10',
                  Done: true,
                  Supplier: null,
                  Notes: 'Farrow & Ball, Setting Plaster',
                },
              },
              {
                title: 'Fix the garden fence',
                values: {
                  Room: 'Garden',
                  'Cost estimate': 450,
                  Priority: 'Medium',
                  'Target date': null,
                  Done: false,
                  Supplier: null,
                  Notes: null,
                },
              },
            ],
            views: {
              board: {
                groupBy: 'Room',
                sort: { propertyId: 'Cost estimate', direction: 'desc' },
              },
              table: {
                filters: [{ propertyId: 'Done', op: 'is_not_checked' }],
                sort: { propertyId: 'Target date', direction: 'asc' },
              },
              list: { sort: { propertyId: 'title', direction: 'asc' } },
            },
          },
        ],
      },
      {
        title: 'Work',
        icon: '💼',
        children: [
          {
            title: 'Q3 Planning',
            icon: '📊',
            blocks: [
              { type: 'h2', content: { text: 'Focus' } },
              {
                type: 'bulleted',
                content: { text: 'Ship the new onboarding flow' },
              },
              {
                type: 'bulleted',
                content: { text: 'Hire one backend engineer' },
              },
              { type: 'todo', content: { text: 'Draft Q3 OKRs', checked: false } },
              {
                type: 'todo',
                content: { text: 'Book the team offsite', checked: true },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    title: 'Travel',
    icon: '✈️',
    children: [
      {
        title: 'Japan 2027',
        icon: '🗾',
        blocks: [
          {
            type: 'callout',
            content: {
              text: 'Flights are booked for late March \u2014 cherry blossom season if we are lucky.',
            },
          },
          { type: 'h1', content: { text: 'Japan 2027' } },
          {
            type: 'paragraph',
            content: {
              text: 'Two weeks, landing in Tokyo and finishing in Osaka. The rough shape first, details as we book them.',
            },
          },
          { type: 'h2', content: { text: 'Itinerary' } },
          {
            type: 'numbered',
            content: { text: 'Tokyo \u2014 4 nights, Shinjuku' },
          },
          {
            type: 'numbered',
            content: { text: 'Kyoto \u2014 5 nights, near Gion' },
          },
          {
            type: 'numbered',
            content: { text: 'Osaka \u2014 3 nights, Dotonbori' },
          },
          { type: 'h2', content: { text: 'Before we go' } },
          { type: 'todo', content: { text: 'Book flights', checked: true } },
          {
            type: 'todo',
            content: { text: 'Reserve ryokan in Kyoto', checked: false },
          },
          {
            type: 'todo',
            content: { text: 'Buy rail passes', checked: false },
          },
          { type: 'divider', content: {} },
          {
            type: 'quote',
            content: {
              text: 'The journey of a thousand miles begins with a single step.',
            },
          },
          { type: 'h3', content: { text: 'Budget notes' } },
          {
            type: 'bulleted',
            content: {
              text: 'Rail pass pays for itself after two long legs',
            },
          },
          {
            type: 'bulleted',
            content: {
              text: 'Convenience-store breakfasts are genuinely good',
            },
          },
          {
            type: 'code',
            content: {
              text: 'Tokyo -> Kyoto: Nozomi, ~2h15m\nKyoto -> Osaka: local line, ~30m',
            },
          },
        ],
        children: [{ title: 'Food to Try', icon: '🍜', blocks: [
          { type: 'h2', content: { text: 'Tokyo' } },
          { type: 'bulleted', content: { text: 'Ramen at Fuunji' } },
          { type: 'bulleted', content: { text: 'Standing sushi in Shibuya' } },
          { type: 'h2', content: { text: 'Kyoto' } },
          { type: 'bulleted', content: { text: 'Kaiseki lunch (book ahead)' } },
          { type: 'bulleted', content: { text: 'Nishiki market grazing' } },
        ] }],
      },
    ],
  },
  {
    title: 'Journal',
    icon: '📓',
    children: [
      {
        title: '2026',
        icon: '🌱',
        children: [
          {
            title: 'July',
            icon: '☀️',
            blocks: [
              {
                type: 'callout',
                content: { text: 'Back from the coast — four days offline.' },
              },
              { type: 'h2', content: { text: 'Highlights' } },
              {
                type: 'bulleted',
                content: { text: 'Swam every morning before anyone else was up.' },
              },
              {
                type: 'bulleted',
                content: { text: 'Found a bookshop in the next village over.' },
              },
              { type: 'todo', content: { text: 'Print the photos', checked: false } },
            ],
          },
          {
            title: 'May',
            icon: '🌧️',
            blocks: [
              {
                type: 'paragraph',
                content: {
                  text: 'A wet month. Mostly indoors with the heating back on.',
                },
              },
              {
                type: 'quote',
                content: { text: 'April showers bring May flowers — not this year.' },
              },
              { type: 'todo', content: { text: 'Fix the leaky gutter', checked: true } },
            ],
          },
          {
            title: 'February',
            icon: '❄️',
            blocks: [
              {
                type: 'paragraph',
                content: { text: 'Cold snap. Pipes froze once, then thawed.' },
              },
              { type: 'divider', content: {} },
              {
                type: 'bulleted',
                content: { text: 'Re-read old notebooks for the new-year review.' },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    title: 'Reading List',
    icon: '📚',
    kind: 'database',
    properties: [
      { name: 'Author', type: 'text' },
      { name: 'Pages', type: 'number' },
      {
        name: 'Status',
        type: 'select',
        options: [
          { label: 'To read', color: '#8a8f98' },
          { label: 'Reading', color: '#209dd7' },
          { label: 'Finished', color: '#3d9a50' },
          { label: 'Abandoned', color: '#c0392b' },
        ],
      },
      {
        name: 'Genre',
        type: 'multi_select',
        options: [
          { label: 'Fiction', color: '#753991' },
          { label: 'Memoir', color: '#ecad0a' },
          { label: 'History', color: '#b07d2b' },
          { label: 'Sci-Fi', color: '#209dd7' },
          { label: 'Design', color: '#d4567d' },
        ],
      },
      { name: 'Started', type: 'date' },
      { name: 'Owned', type: 'checkbox' },
      { name: 'Link', type: 'url' },
    ],
    rows: [
      {
        title: 'Project Hail Mary',
        values: {
          Author: 'Andy Weir',
          Pages: 476,
          Status: 'Reading',
          Genre: ['Sci-Fi'],
          Started: '2026-07-01',
          Owned: true,
          Link: 'https://www.goodreads.com/book/show/54493401-project-hail-mary',
        },
        blocks: [
          {
            type: 'paragraph',
            content: {
              text: 'Ryne Grace wakes up with no memory. Halfway through and completely gripped.',
            },
          },
          { type: 'todo', content: { text: 'Finish by the end of July', checked: false } },
          {
            type: 'quote',
            content: { text: 'Good science fiction makes the impossible feel inevitable.' },
          },
        ],
      },
      {
        title: 'The Design of Everyday Things',
        values: {
          Author: 'Don Norman',
          Pages: 368,
          Status: 'Finished',
          Genre: ['Design'],
          Started: '2026-03-14',
          Owned: true,
          Link: 'https://www.goodreads.com/book/show/320935.The_Design_of_Everyday_Things',
        },
      },
      {
        title: 'A Gentleman in Moscow',
        values: {
          Author: 'Amor Towles',
          Pages: 462,
          Status: 'To read',
          Genre: ['Fiction'],
          Started: null,
          Owned: false,
          Link: 'https://www.goodreads.com/book/show/34066798-a-gentleman-in-moscow',
        },
      },
      {
        title: 'Sapiens',
        values: {
          Author: 'Yuval Noah Harari',
          Pages: 512,
          Status: 'Abandoned',
          Genre: ['History'],
          Started: '2025-11-02',
          Owned: false,
          Link: 'https://www.goodreads.com/book/show/25666050-sapiens',
        },
      },
      {
        title: 'Dune',
        values: {
          Author: 'Frank Herbert',
          Pages: 688,
          Status: 'To read',
          Genre: ['Sci-Fi', 'Fiction'],
          Started: null,
          Owned: true,
          Link: 'https://www.goodreads.com/book/show/23442234-dune',
        },
      },
      {
        title: 'Educated',
        values: {
          Author: 'Tara Westover',
          Pages: 352,
          Status: 'Finished',
          Genre: ['Memoir'],
          Started: '2026-01-20',
          Owned: true,
          Link: 'https://www.goodreads.com/book/show/35133722-educated',
        },
      },
    ],
    views: {
      table: {
        filters: [{ propertyId: 'Status', op: 'is_not', value: 'Abandoned' }],
        sort: { propertyId: 'Author', direction: 'asc' },
      },
      board: { groupBy: 'Status' },
      list: { sort: { propertyId: 'title', direction: 'asc' } },
    },
  },
  {
    title: 'Recipes',
    icon: '🍲',
    kind: 'database',
    properties: [
      {
        name: 'Cuisine',
        type: 'select',
        options: [
          { label: 'Italian', color: '#c0392b' },
          { label: 'Mexican', color: '#ecad0a' },
          { label: 'Japanese', color: '#209dd7' },
          { label: 'Middle Eastern', color: '#3d9a50' },
          { label: 'Baking', color: '#b07d2b' },
        ],
      },
      { name: 'Prep time', type: 'number' },
      { name: 'Vegetarian', type: 'checkbox' },
      {
        name: 'Rating',
        type: 'select',
        options: [
          { label: 'Loved', color: '#753991' },
          { label: 'Good', color: '#209dd7' },
          { label: 'Meh', color: '#8a8f98' },
        ],
      },
      { name: 'Last made', type: 'date' },
      { name: 'Source', type: 'url' },
      { name: 'Notes', type: 'text' },
    ],
    rows: [
      {
        title: "Marcella Hazan's tomato sauce",
        values: {
          Cuisine: 'Italian',
          'Prep time': 45,
          Vegetarian: true,
          Rating: 'Loved',
          'Last made': '2026-07-12',
          Source: 'https://www.seriouseats.com/marcella-hazan-tomato-sauce-recipe',
          Notes: 'Butter, onion, tinned tomatoes. That is the whole trick.',
        },
        blocks: [
          { type: 'h2', content: { text: 'Steps' } },
          {
            type: 'numbered',
            content: { text: 'Halve the onion and simmer everything 45 minutes' },
          },
          {
            type: 'numbered',
            content: { text: 'Fish the onion out, salt to taste' },
          },
          {
            type: 'todo',
            content: { text: 'Try with fresh San Marzano tomatoes', checked: false },
          },
        ],
      },
      {
        title: 'Chicken tinga tacos',
        values: {
          Cuisine: 'Mexican',
          'Prep time': 60,
          Vegetarian: false,
          Rating: 'Good',
          'Last made': '2026-06-28',
          Source: 'https://example.com/tinga',
          Notes: null,
        },
      },
      {
        title: 'Miso soup, properly',
        values: {
          Cuisine: 'Japanese',
          'Prep time': 15,
          Vegetarian: true,
          Rating: 'Good',
          'Last made': '2026-07-05',
          Source: null,
          Notes: 'Dashi from scratch is worth it',
        },
      },
      {
        title: 'Focaccia',
        values: {
          Cuisine: 'Baking',
          'Prep time': 240,
          Vegetarian: true,
          Rating: 'Loved',
          'Last made': '2026-07-18',
          Source: 'https://example.com/focaccia',
          Notes: 'Overnight cold proof',
        },
      },
      {
        title: 'Shakshuka',
        values: {
          Cuisine: 'Middle Eastern',
          'Prep time': 30,
          Vegetarian: true,
          Rating: 'Meh',
          'Last made': null,
          Source: null,
          Notes: 'Needs more cumin next time',
        },
      },
    ],
    views: {
      table: { sort: { propertyId: 'Last made', direction: 'desc' } },
      board: { groupBy: 'Cuisine' },
      list: { sort: { propertyId: 'title', direction: 'asc' } },
    },
  },
];

/**
 * Build the values object for a seeded row by mapping property names to
 * their generated ids. Select labels are resolved to option ids. Cells that
 * are `null` or omitted end up absent from the values JSON (the API treats
 * absent keys the same as null).
 */
function buildRowValues(
  propIdsByName: Map<string, string>,
  optionIdsByProp: Map<string, Map<string, string>>,
  cells: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(cells)) {
    const id = propIdsByName.get(name);
    if (!id) continue;
    if (value === null) continue;
    const labelMap = optionIdsByProp.get(id);
    if (labelMap && typeof value === 'string') {
      const resolved = labelMap.get(value);
      if (resolved) out[id] = resolved;
      else out[id] = value;
    } else if (labelMap && Array.isArray(value)) {
      out[id] = value
        .map((label) => (typeof label === 'string' ? labelMap.get(label) : undefined))
        .filter((v): v is string => typeof v === 'string');
    } else {
      out[id] = value;
    }
  }
  return out;
}

/**
 * Resolves a SeedViewSettings object (which uses property *names* and option
 * *labels*) into the stored shape (which uses ids). Property names that don't
 * match are skipped; select/multi_select filter values are resolved to option
 * ids, falling back to the raw string. The special sort propertyId 'title' is
 * preserved verbatim (it means "sort by row title" — see routes/views.ts).
 * `groupBy` resolves to the property id of the named select property; if the
 * name doesn't match a select property it is dropped.
 */
function resolveViewSettings(
  settings: SeedViewSettings,
  propIdsByName: Map<string, string>,
  optionIdsByProp: Map<string, Map<string, string>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (settings.filters) {
    const filters: Record<string, unknown>[] = [];
    for (const f of settings.filters) {
      const propId = propIdsByName.get(f.propertyId);
      if (!propId) continue;
      const checkboxOps = new Set(['is_checked', 'is_not_checked']);
      if (checkboxOps.has(f.op)) {
        filters.push({ propertyId: propId, op: f.op });
      } else {
        const labelMap = optionIdsByProp.get(propId);
        const value =
          labelMap && typeof f.value === 'string'
            ? (labelMap.get(f.value) ?? f.value)
            : f.value;
        filters.push({ propertyId: propId, op: f.op, value });
      }
    }
    out.filters = filters;
  }

  if (settings.sort !== undefined) {
    if (settings.sort === null) {
      out.sort = null;
    } else {
      const { propertyId, direction } = settings.sort;
      // 'title' is a special sort key (row title); leave as-is.
      const resolved = propertyId === 'title' ? 'title' : propIdsByName.get(propertyId);
      if (resolved !== undefined) {
        out.sort = { propertyId: resolved, direction };
      }
    }
  }

  if (settings.groupBy !== undefined) {
    if (settings.groupBy === null) {
      out.groupBy = null;
    } else {
      const propId = propIdsByName.get(settings.groupBy);
      if (propId) out.groupBy = propId;
    }
  }

  return out;
}

function insertBlocks(
  db: DB,
  pageId: string,
  blocks: SeedBlock[] | undefined,
  now: string
): void {
  if (!blocks) return;
  const insertBlock = db.prepare(
    `INSERT INTO blocks (id, page_id, type, content, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  blocks.forEach((b, i) => {
    insertBlock.run(
      nanoid(),
      pageId,
      b.type,
      b.content ? JSON.stringify(b.content) : null,
      i,
      now,
      now
    );
  });
}

function insertPage(
  db: DB,
  page: SeedPage,
  parentId: string | null,
  position: number
): string {
  const id = nanoid();
  const now = new Date().toISOString();
  const kind = page.kind ?? 'page';
  db.prepare(
    `INSERT INTO pages (id, parent_id, title, icon, kind, position, "values", created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(id, parentId, page.title, page.icon, kind, position, now, now);

  if (kind === 'database') {
    // Insert properties in order, capturing their ids by name.
    const propIdsByName = new Map<string, string>();
    const optionIdsByProp = new Map<string, Map<string, string>>();
    if (page.properties) {
      const insertProp = db.prepare(
        `INSERT INTO properties (id, database_id, name, type, options, position)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      page.properties.forEach((p, i) => {
        const propId = nanoid();
        let optionsJson: string | null = null;
        const labelToId = new Map<string, string>();
        if (p.type === 'select' || p.type === 'multi_select') {
          const opts = (p.options ?? []).map((o) => {
            const optId = o.id ?? nanoid();
            labelToId.set(o.label, optId);
            return { id: optId, label: o.label, color: o.color };
          });
          optionsJson = JSON.stringify(opts);
        }
        insertProp.run(propId, id, p.name, p.type, optionsJson, i);
        propIdsByName.set(p.name, propId);
        optionIdsByProp.set(propId, labelToId);
      });
    }

    // Insert rows in order.
    if (page.rows) {
      const insertRow = db.prepare(
        `INSERT INTO pages (id, parent_id, title, icon, kind, position, "values", created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'row', ?, ?, ?, ?)`
      );
      page.rows.forEach((r, i) => {
        const rowId = nanoid();
        const values = buildRowValues(propIdsByName, optionIdsByProp, r.values ?? {});
        insertRow.run(rowId, id, r.title, i, JSON.stringify(values), now, now);
        insertBlocks(db, rowId, r.blocks, now);
      });
    }

    // Create the three default views (empty settings, or seeded settings that
    // reference property/option ids). Done after properties+rows so the seeded
    // settings can resolve ids the same way row values do.
    const insertView = db.prepare(
      'INSERT INTO views (database_id, view_type, settings) VALUES (?, ?, ?)'
    );
    for (const vt of VIEW_TYPES) {
      const seeded = page.views?.[vt];
      const settings = seeded
        ? JSON.stringify(resolveViewSettings(seeded, propIdsByName, optionIdsByProp))
        : '{}';
      insertView.run(id, vt, settings);
    }
  }

  insertBlocks(db, id, page.blocks, now);

  if (page.children) {
    page.children.forEach((child, i) => insertPage(db, child, id, i));
  }
  return id;
}

/** Returns true when the pages table already has rows (seed not needed). */
export function isSeeded(db: DB): boolean {
  const row = db.prepare('SELECT COUNT(*) AS c FROM pages').get() as { c: number };
  return row.c > 0;
}

/** Seeds the database with the initial workspace, only when empty. */
export function seedIfEmpty(db: DB): void {
  if (isSeeded(db)) return;
  SEED_PAGES.forEach((page, i) => insertPage(db, page, null, i));
}

/** Exposed for tests / future inspection. */
export const SEED_STRUCTURE = SEED_PAGES;
