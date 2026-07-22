import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { setup, type TestSetup } from './helpers';

let env: TestSetup;
let dbId: string;

beforeEach(async () => {
  env = setup({ seed: false });
  const res = await request(env.app)
    .post('/api/pages')
    .send({ kind: 'database', title: 'Books', icon: '📚' });
  dbId = res.body.id;
});

afterEach(() => {
  env.cleanup();
});

async function addProperty(
  body: { name: string; type: string; options?: unknown }
) {
  return request(env.app).post(`/api/databases/${dbId}/properties`).send(body);
}

async function addRow(title?: string) {
  return request(env.app)
    .post(`/api/databases/${dbId}/rows`)
    .send(title === undefined ? {} : { title });
}

describe('GET /api/databases/:id', () => {
  it('returns the database page, properties, rows and views', async () => {
    await addProperty({ name: 'Author', type: 'text' });
    await addProperty({
      name: 'Status',
      type: 'select',
      options: [{ label: 'To read', color: '#8a8f98' }],
    });
    await addRow('Book A');
    await addRow('Book B');

    const res = await request(env.app).get(`/api/databases/${dbId}`);
    expect(res.status).toBe(200);
    expect(res.body.page.id).toBe(dbId);
    expect(res.body.page.kind).toBe('database');
    expect(res.body.properties.map((p: { name: string }) => p.name)).toEqual([
      'Author',
      'Status',
    ]);
    // Properties ordered by position.
    expect(res.body.properties.map((p: { position: number }) => p.position)).toEqual([
      0, 1,
    ]);
    // The select has options filled with id/color.
    const status = res.body.properties.find(
      (p: { name: string }) => p.name === 'Status'
    );
    expect(status.options).toHaveLength(1);
    expect(status.options[0].label).toBe('To read');
    expect(status.options[0].color).toBe('#8a8f98');
    expect(status.options[0].id).toBeTruthy();
    // The text property has options: null.
    const author = res.body.properties.find(
      (p: { name: string }) => p.name === 'Author'
    );
    expect(author.options).toBeNull();
    // Rows in position order with parsed values objects.
    expect(res.body.rows.map((r: { title: string }) => r.title)).toEqual([
      'Book A',
      'Book B',
    ]);
    expect(res.body.rows[0].values).toEqual({});
    // Views present and parsed.
    expect(Object.keys(res.body.views).sort()).toEqual(['board', 'list', 'table']);
    for (const vt of ['table', 'board', 'list']) {
      expect(res.body.views[vt]).toEqual({});
    }
  });

  it('returns 404 for a non-database page', async () => {
    const page = (
      await request(env.app).post('/api/pages').send({ title: 'Plain' })
    ).body;
    const res = await request(env.app).get(`/api/databases/${page.id}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(env.app).get('/api/databases/nope');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/databases/:id/properties', () => {
  it('creates a text property with options null', async () => {
    const res = await addProperty({ name: 'Author', type: 'text' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.databaseId).toBe(dbId);
    expect(res.body.name).toBe('Author');
    expect(res.body.type).toBe('text');
    expect(res.body.options).toBeNull();
    expect(res.body.position).toBe(0);
  });

  it('defaults options to [] for select and multi_select', async () => {
    const sel = await addProperty({ name: 'Status', type: 'select' });
    expect(sel.status).toBe(201);
    expect(sel.body.options).toEqual([]);
    const multi = await addProperty({ name: 'Tags', type: 'multi_select' });
    expect(multi.status).toBe(201);
    expect(multi.body.options).toEqual([]);
    // position appended.
    expect(multi.body.position).toBe(1);
  });

  it('ignores options for non-select types', async () => {
    const res = await addProperty({
      name: 'Author',
      type: 'text',
      options: [{ label: 'ignored', color: '#fff' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.options).toBeNull();
  });

  it('fills missing ids and colors on options', async () => {
    const res = await addProperty({
      name: 'Status',
      type: 'select',
      options: [
        { label: 'To read' }, // no id, no color
        { id: 'custom-id', label: 'Reading', color: '#209dd7' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.options).toHaveLength(2);
    const [a, b] = res.body.options;
    expect(a.label).toBe('To read');
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe('custom-id');
    expect(a.color).toBe('#8a8f98'); // default gray
    expect(b.id).toBe('custom-id');
    expect(b.color).toBe('#209dd7');
  });

  it('rejects an empty name with 400', async () => {
    const res = await addProperty({ name: '   ', type: 'text' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing name with 400', async () => {
    const res = await addProperty({ type: 'text' } as { name: string; type: string });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid type with 400', async () => {
    const res = await addProperty({ name: 'X', type: 'banana' });
    expect(res.status).toBe(400);
  });

  it('rejects non-array options for select with 400', async () => {
    const res = await addProperty({
      name: 'Status',
      type: 'select',
      options: { label: 'nope' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects an option with no label with 400', async () => {
    const res = await addProperty({
      name: 'Status',
      type: 'select',
      options: [{ color: '#fff' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the database does not exist', async () => {
    const res = await request(env.app)
      .post('/api/databases/nope/properties')
      .send({ name: 'X', type: 'text' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/properties/:id', () => {
  it('renames a property', async () => {
    const p = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await request(env.app)
      .patch(`/api/properties/${p.id}`)
      .send({ name: 'Writer' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Writer');
    expect(res.body.type).toBe('text');
  });

  it('rejects an empty rename with 400', async () => {
    const p = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await request(env.app)
      .patch(`/api/properties/${p.id}`)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a type change with 400', async () => {
    const p = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await request(env.app)
      .patch(`/api/properties/${p.id}`)
      .send({ type: 'number' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('fixed');
  });

  it('allows a no-op type reassertion', async () => {
    const p = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await request(env.app)
      .patch(`/api/properties/${p.id}`)
      .send({ type: 'text' });
    expect(res.status).toBe(200);
  });

  it('replaces select options and fills ids/colors', async () => {
    const p = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [{ label: 'A', color: '#fff' }],
      })
    ).body;
    const res = await request(env.app)
      .patch(`/api/properties/${p.id}`)
      .send({ options: [{ label: 'B' }, { id: 'x', label: 'C', color: '#000' }] });
    expect(res.status).toBe(200);
    expect(res.body.options).toHaveLength(2);
    expect(res.body.options[0].label).toBe('B');
    expect(res.body.options[0].color).toBe('#8a8f98');
    expect(res.body.options[1].id).toBe('x');
  });

  it('rejects options on a non-select property with 400', async () => {
    const p = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await request(env.app)
      .patch(`/api/properties/${p.id}`)
      .send({ options: [{ label: 'x' }] });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown property', async () => {
    const res = await request(env.app)
      .patch('/api/properties/nope')
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/properties/:id', () => {
  it('deletes a property and reports deleted:1', async () => {
    const p = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await request(env.app).delete(`/api/properties/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
  });

  it('strips the property key from every row of that database', async () => {
    const statusProp = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [
          { id: 's1', label: 'To read', color: '#8a8f98' },
          { id: 's2', label: 'Reading', color: '#209dd7' },
        ],
      })
    ).body;
    const authorProp = (await addProperty({ name: 'Author', type: 'text' })).body;

    const row = (await addRow('Book')).body;
    await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({
        values: {
          [statusProp.id]: 's1',
          [authorProp.id]: 'Andy Weir',
        },
      });

    const before = (await request(env.app).get(`/api/databases/${dbId}`)).body;
    expect(before.rows[0].values[statusProp.id]).toBe('s1');
    expect(before.rows[0].values[authorProp.id]).toBe('Andy Weir');

    const res = await request(env.app).delete(`/api/properties/${statusProp.id}`);
    expect(res.status).toBe(200);

    const after = (await request(env.app).get(`/api/databases/${dbId}`)).body;
    expect(after.rows[0].values[statusProp.id]).toBeUndefined();
    expect(after.rows[0].values[authorProp.id]).toBe('Andy Weir');
  });

  it('returns 404 for an unknown property', async () => {
    const res = await request(env.app).delete('/api/properties/nope');
    expect(res.status).toBe(404);
  });

  // DEF-006 / DEF-007: deleting a property scrubs view settings that
  // reference it (filters removed, sort/groupBy nulled) inside the same
  // transaction, and leaves settings for other properties untouched.
  async function setViewSettings(
    viewType: string,
    settings: unknown
  ): Promise<void> {
    const res = await request(env.app)
      .patch(`/api/databases/${dbId}/views/${viewType}`)
      .send({ settings });
    expect(res.status).toBe(200);
  }

  it('scrubs filters/sort/groupBy referencing a deleted property from view settings', async () => {
    const notesProp = (await addProperty({ name: 'Notes', type: 'text' })).body;
    const statusProp = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [{ id: 's1', label: 'Open', color: '#8a8f98' }],
      })
    ).body;

    await setViewSettings('table', {
      filters: [
        { propertyId: notesProp.id, op: 'contains', value: 'sign-off' },
      ],
    });
    await setViewSettings('list', {
      sort: { propertyId: notesProp.id, direction: 'desc' },
    });
    await setViewSettings('board', {
      groupBy: statusProp.id,
    });

    const res = await request(env.app).delete(`/api/properties/${notesProp.id}`);
    expect(res.status).toBe(200);

    const after = (await request(env.app).get(`/api/databases/${dbId}`)).body;
    // DEF-006: filter referencing the deleted property is removed.
    expect(after.views.table.filters).toEqual([]);
    // DEF-007: sort referencing the deleted property is nulled.
    expect(after.views.list.sort).toBeNull();
    // groupBy on a still-existing property is untouched.
    expect(after.views.board.groupBy).toBe(statusProp.id);
  });

  it('nulls groupBy referencing a deleted property and leaves other settings untouched', async () => {
    const statusProp = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [{ id: 's1', label: 'Open', color: '#8a8f98' }],
      })
    ).body;
    const authorProp = (await addProperty({ name: 'Author', type: 'text' })).body;

    await setViewSettings('board', { groupBy: statusProp.id });
    await setViewSettings('table', {
      filters: [{ propertyId: authorProp.id, op: 'contains', value: 'Andy' }],
      sort: { propertyId: authorProp.id, direction: 'asc' },
    });

    const res = await request(env.app).delete(`/api/properties/${statusProp.id}`);
    expect(res.status).toBe(200);

    const after = (await request(env.app).get(`/api/databases/${dbId}`)).body;
    // groupBy referencing the deleted property is nulled.
    expect(after.views.board.groupBy).toBeNull();
    // Settings referencing the surviving property are untouched.
    expect(after.views.table.filters).toEqual([
      { propertyId: authorProp.id, op: 'contains', value: 'Andy' },
    ]);
    expect(after.views.table.sort).toEqual({
      propertyId: authorProp.id,
      direction: 'asc',
    });
  });
});

describe('POST /api/databases/:id/rows', () => {
  it('creates a row with default title and empty values', async () => {
    const res = await request(env.app).post(`/api/databases/${dbId}/rows`).send({});
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('row');
    expect(res.body.parentId).toBe(dbId);
    expect(res.body.title).toBe('Untitled');
    expect(res.body.values).toEqual({});
    expect(res.body.position).toBe(0);
  });

  it('appends rows after existing rows', async () => {
    const r1 = (await addRow('A')).body;
    const r2 = (await addRow('B')).body;
    expect(r1.position).toBe(0);
    expect(r2.position).toBe(1);
  });

  it('returns 404 when the database does not exist', async () => {
    const res = await request(env.app).post('/api/databases/nope/rows').send({});
    expect(res.status).toBe(404);
  });

  it('returns 404 when the parent is not a database', async () => {
    const page = (
      await request(env.app).post('/api/pages').send({ title: 'Plain' })
    ).body;
    const res = await request(env.app).post(`/api/databases/${page.id}/rows`).send({});
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/rows/:id', () => {
  it('renames a row', async () => {
    const row = (await addRow('Old')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ title: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New');
  });

  it('rejects an empty title with 400', async () => {
    const row = (await addRow('Old')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ title: '   ' });
    expect(res.status).toBe(400);
  });

  it('merges values key-by-key', async () => {
    const author = (await addProperty({ name: 'Author', type: 'text' })).body;
    const pages = (await addProperty({ name: 'Pages', type: 'number' })).body;
    const row = (await addRow('Book')).body;
    await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [author.id]: 'Andy Weir' } });
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [pages.id]: 476 } });
    expect(res.status).toBe(200);
    expect(res.body.values).toEqual({
      [author.id]: 'Andy Weir',
      [pages.id]: 476,
    });
  });

  it('null clears a cell value', async () => {
    const author = (await addProperty({ name: 'Author', type: 'text' })).body;
    const row = (await addRow('Book')).body;
    await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [author.id]: 'Andy Weir' } });
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [author.id]: null } });
    expect(res.status).toBe(200);
    expect(res.body.values[author.id]).toBeNull();
  });

  it('rejects an unknown property key with 400', async () => {
    const row = (await addRow('Book')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { 'made-up-id': 'x' } });
    expect(res.status).toBe(400);
  });

  it('rejects a string for a number property with 400', async () => {
    const pages = (await addProperty({ name: 'Pages', type: 'number' })).body;
    const row = (await addRow('Book')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [pages.id]: 'four hundred' } });
    expect(res.status).toBe(400);
  });

  it('accepts a numeric number value', async () => {
    const pages = (await addProperty({ name: 'Pages', type: 'number' })).body;
    const row = (await addRow('Book')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [pages.id]: 476 } });
    expect(res.status).toBe(200);
    expect(res.body.values[pages.id]).toBe(476);
  });

  it('rejects an invalid select option id with 400', async () => {
    const status = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [{ id: 's1', label: 'A', color: '#fff' }],
      })
    ).body;
    const row = (await addRow('Book')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [status.id]: 's2' } });
    expect(res.status).toBe(400);
  });

  it('accepts a valid select option id', async () => {
    const status = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [{ id: 's1', label: 'A', color: '#fff' }],
      })
    ).body;
    const row = (await addRow('Book')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [status.id]: 's1' } });
    expect(res.status).toBe(200);
    expect(res.body.values[status.id]).toBe('s1');
  });

  it('rejects an invalid id inside a multi_select array with 400', async () => {
    const tags = (
      await addProperty({
        name: 'Tags',
        type: 'multi_select',
        options: [
          { id: 't1', label: 'A', color: '#fff' },
          { id: 't2', label: 'B', color: '#fff' },
        ],
      })
    ).body;
    const row = (await addRow('Book')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [tags.id]: ['t1', 't3'] } });
    expect(res.status).toBe(400);
  });

  it('accepts a valid multi_select array', async () => {
    const tags = (
      await addProperty({
        name: 'Tags',
        type: 'multi_select',
        options: [
          { id: 't1', label: 'A', color: '#fff' },
          { id: 't2', label: 'B', color: '#fff' },
        ],
      })
    ).body;
    const row = (await addRow('Book')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [tags.id]: ['t1', 't2'] } });
    expect(res.status).toBe(200);
    expect(res.body.values[tags.id]).toEqual(['t1', 't2']);
  });

  it('rejects a non-boolean checkbox value with 400', async () => {
    const done = (await addProperty({ name: 'Done', type: 'checkbox' })).body;
    const row = (await addRow('Book')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [done.id]: 'yes' } });
    expect(res.status).toBe(400);
  });

  it('rejects a non-string date value with 400', async () => {
    const started = (await addProperty({ name: 'Started', type: 'date' })).body;
    const row = (await addRow('Book')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [started.id]: 42 } });
    expect(res.status).toBe(400);
  });

  it('rejects a non-string url value with 400', async () => {
    const link = (await addProperty({ name: 'Link', type: 'url' })).body;
    const row = (await addRow('Book')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [link.id]: 42 } });
    expect(res.status).toBe(400);
  });

  it('rejects non-object values with 400', async () => {
    const row = (await addRow('Book')).body;
    const res = await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: 'not an object' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the row does not exist', async () => {
    const res = await request(env.app)
      .patch('/api/rows/nope')
      .send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the page is not a row', async () => {
    const page = (
      await request(env.app).post('/api/pages').send({ title: 'Plain' })
    ).body;
    const res = await request(env.app)
      .patch(`/api/rows/${page.id}`)
      .send({ title: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/rows/:id', () => {
  it('deletes a row and reports deleted:1', async () => {
    const row = (await addRow('Book')).body;
    const res = await request(env.app).delete(`/api/rows/${row.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
  });

  it('deletes the row blocks too', async () => {
    const row = (await addRow('Book')).body;
    await request(env.app)
      .post(`/api/pages/${row.id}/blocks`)
      .send({ type: 'paragraph', content: { text: 'note' } });
    const beforeBlocks = env.db
      .prepare('SELECT COUNT(*) AS c FROM blocks WHERE page_id = ?')
      .get(row.id) as { c: number };
    expect(beforeBlocks.c).toBe(1);

    await request(env.app).delete(`/api/rows/${row.id}`);

    const afterBlocks = env.db
      .prepare('SELECT COUNT(*) AS c FROM blocks WHERE page_id = ?')
      .get(row.id) as { c: number };
    expect(afterBlocks.c).toBe(0);
    const pages = env.db
      .prepare('SELECT COUNT(*) AS c FROM pages WHERE id = ?')
      .get(row.id) as { c: number };
    expect(pages.c).toBe(0);
  });

  it('returns 404 when the row does not exist', async () => {
    const res = await request(env.app).delete('/api/rows/nope');
    expect(res.status).toBe(404);
  });

  it('returns 404 when the page is not a row', async () => {
    const page = (
      await request(env.app).post('/api/pages').send({ title: 'Plain' })
    ).body;
    const res = await request(env.app).delete(`/api/rows/${page.id}`);
    expect(res.status).toBe(404);
  });
});

describe('database cascade on page delete', () => {
  it('removes the database rows, row blocks, properties and views', async () => {
    const status = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [{ id: 's1', label: 'A', color: '#fff' }],
      })
    ).body;
    const row = (await addRow('Book')).body;
    await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [status.id]: 's1' } });
    await request(env.app)
      .post(`/api/pages/${row.id}/blocks`)
      .send({ type: 'paragraph', content: { text: 'note' } });

    const res = await request(env.app).delete(`/api/pages/${dbId}`);
    expect(res.status).toBe(200);
    // The database page plus its single row.
    expect(res.body.deleted).toBe(2);

    expect(
      (env.db
        .prepare('SELECT COUNT(*) AS c FROM pages WHERE parent_id = ?')
        .get(dbId) as { c: number }).c
    ).toBe(0);
    expect(
      (env.db
        .prepare('SELECT COUNT(*) AS c FROM properties WHERE database_id = ?')
        .get(dbId) as { c: number }).c
    ).toBe(0);
    expect(
      (env.db
        .prepare('SELECT COUNT(*) AS c FROM views WHERE database_id = ?')
        .get(dbId) as { c: number }).c
    ).toBe(0);
    expect(
      (env.db
        .prepare('SELECT COUNT(*) AS c FROM blocks WHERE page_id = ?')
        .get(row.id) as { c: number }).c
    ).toBe(0);
  });
});

describe('seeded databases', () => {
  beforeEach(() => {
    env.cleanup();
    env = setup({ seed: true });
  });

  it('seeds the Reading List database with properties and rows', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const reading = tree.pages.find((p: { title: string }) => p.title === 'Reading List');
    expect(reading).toBeTruthy();
    expect(reading.kind).toBe('database');

    const res = await request(env.app).get(`/api/databases/${reading.id}`);
    expect(res.status).toBe(200);
    expect(res.body.properties.map((p: { name: string }) => p.name)).toEqual([
      'Author',
      'Pages',
      'Status',
      'Genre',
      'Started',
      'Owned',
      'Link',
    ]);
    expect(res.body.rows.map((r: { title: string }) => r.title)).toEqual([
      'Project Hail Mary',
      'The Design of Everyday Things',
      'A Gentleman in Moscow',
      'Sapiens',
      'Dune',
      'Educated',
    ]);
    // First row has sensible values and three blocks.
    const first = res.body.rows[0];
    expect(first.values).toBeTruthy();
    expect(Object.keys(first.values).length).toBeGreaterThan(0);

    const blocks = await request(env.app).get(`/api/pages/${first.id}/blocks`);
    expect(blocks.status).toBe(200);
    expect(blocks.body.blocks.map((b: { type: string }) => b.type)).toEqual([
      'paragraph',
      'todo',
      'quote',
    ]);

    // The Status select has four colored options.
    const status = res.body.properties.find((p: { name: string }) => p.name === 'Status');
    expect(status.options.map((o: { label: string }) => o.label)).toEqual([
      'To read',
      'Reading',
      'Finished',
      'Abandoned',
    ]);
    // A Gentleman in Moscow has Started null (absent) and Owned false (present).
    const gentleman = res.body.rows.find(
      (r: { title: string }) => r.title === 'A Gentleman in Moscow'
    );
    const ownedId = res.body.properties.find((p: { name: string }) => p.name === 'Owned').id;
    const startedId = res.body.properties.find((p: { name: string }) => p.name === 'Started').id;
    expect(gentleman.values[ownedId]).toBe(false);
    expect(gentleman.values[startedId]).toBeUndefined();

    // Sapiens has a Started date and is Abandoned.
    const sapiens = res.body.rows.find((r: { title: string }) => r.title === 'Sapiens');
    const statusId = res.body.properties.find((p: { name: string }) => p.name === 'Status').id;
    expect(sapiens.values[startedId]).toBe('2025-11-02');
    expect(sapiens.values[statusId]).toBeTruthy();
  });

  it('seeds the Renovation Tasks database nested under Home Renovation', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const reno = tree.pages.find((p: { title: string }) => p.title === 'Renovation Tasks');
    expect(reno).toBeTruthy();
    expect(reno.kind).toBe('database');
    const home = tree.pages.find((p: { title: string }) => p.title === 'Home Renovation');
    expect(reno.parentId).toBe(home.id);

    const res = await request(env.app).get(`/api/databases/${reno.id}`);
    expect(res.status).toBe(200);
    expect(res.body.properties.map((p: { name: string }) => p.name)).toEqual([
      'Room',
      'Cost estimate',
      'Priority',
      'Target date',
      'Done',
      'Supplier',
      'Notes',
    ]);
    expect(res.body.rows.map((r: { title: string }) => r.title)).toEqual([
      'Replace worktops',
      'Rewire kitchen sockets',
      'Retile the shower',
      'Paint the living room',
      'Fix the garden fence',
    ]);

    // First row has a todo and a paragraph block.
    const first = res.body.rows[0];
    const blocks = await request(env.app).get(`/api/pages/${first.id}/blocks`);
    expect(blocks.body.blocks.map((b: { type: string }) => b.type)).toEqual([
      'todo',
      'paragraph',
    ]);

    // Fix the garden fence has no Target date (null/absent).
    const fence = res.body.rows.find(
      (r: { title: string }) => r.title === 'Fix the garden fence'
    );
    const targetId = res.body.properties.find(
      (p: { name: string }) => p.name === 'Target date'
    ).id;
    expect(fence.values[targetId]).toBeUndefined();
  });
});

describe('seeded view settings', () => {
  beforeEach(() => {
    env.cleanup();
    env = setup({ seed: true });
  });

  it('Reading List table filters out Abandoned and sorts by Author asc', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const reading = tree.pages.find(
      (p: { title: string }) => p.title === 'Reading List'
    );
    const res = await request(env.app).get(`/api/databases/${reading.id}`);
    const status = res.body.properties.find(
      (p: { name: string }) => p.name === 'Status'
    );
    const author = res.body.properties.find(
      (p: { name: string }) => p.name === 'Author'
    );
    const abandoned = status.options.find(
      (o: { label: string }) => o.label === 'Abandoned'
    );

    expect(res.body.views.table).toEqual({
      filters: [
        { propertyId: status.id, op: 'is_not', value: abandoned.id },
      ],
      sort: { propertyId: author.id, direction: 'asc' },
    });
  });

  it('Reading List board groups by Status', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const reading = tree.pages.find(
      (p: { title: string }) => p.title === 'Reading List'
    );
    const res = await request(env.app).get(`/api/databases/${reading.id}`);
    const status = res.body.properties.find(
      (p: { name: string }) => p.name === 'Status'
    );
    expect(res.body.views.board).toEqual({ groupBy: status.id });
  });

  it('Reading List list sorts by title asc', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const reading = tree.pages.find(
      (p: { title: string }) => p.title === 'Reading List'
    );
    const res = await request(env.app).get(`/api/databases/${reading.id}`);
    expect(res.body.views.list).toEqual({
      sort: { propertyId: 'title', direction: 'asc' },
    });
  });

  it('Renovation Tasks board groups by Room and sorts by Cost estimate desc', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const reno = tree.pages.find(
      (p: { title: string }) => p.title === 'Renovation Tasks'
    );
    const res = await request(env.app).get(`/api/databases/${reno.id}`);
    const room = res.body.properties.find(
      (p: { name: string }) => p.name === 'Room'
    );
    const cost = res.body.properties.find(
      (p: { name: string }) => p.name === 'Cost estimate'
    );
    expect(res.body.views.board).toEqual({
      groupBy: room.id,
      sort: { propertyId: cost.id, direction: 'desc' },
    });
  });

  it('Renovation Tasks table filters Done is_not_checked and sorts by Target date asc', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const reno = tree.pages.find(
      (p: { title: string }) => p.title === 'Renovation Tasks'
    );
    const res = await request(env.app).get(`/api/databases/${reno.id}`);
    const done = res.body.properties.find(
      (p: { name: string }) => p.name === 'Done'
    );
    const target = res.body.properties.find(
      (p: { name: string }) => p.name === 'Target date'
    );
    expect(res.body.views.table).toEqual({
      filters: [{ propertyId: done.id, op: 'is_not_checked' }],
      sort: { propertyId: target.id, direction: 'asc' },
    });
  });

  it('Renovation Tasks list sorts by title asc', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const reno = tree.pages.find(
      (p: { title: string }) => p.title === 'Renovation Tasks'
    );
    const res = await request(env.app).get(`/api/databases/${reno.id}`);
    expect(res.body.views.list).toEqual({
      sort: { propertyId: 'title', direction: 'asc' },
    });
  });

  it('seeds the Recipes database as a top-level database with properties and rows', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const recipes = tree.pages.find((p: { title: string }) => p.title === 'Recipes');
    expect(recipes).toBeTruthy();
    expect(recipes.kind).toBe('database');
    expect(recipes.parentId).toBeNull();
    expect(recipes.icon).toBe('🍲');

    const res = await request(env.app).get(`/api/databases/${recipes.id}`);
    expect(res.status).toBe(200);
    expect(res.body.properties.map((p: { name: string }) => p.name)).toEqual([
      'Cuisine',
      'Prep time',
      'Vegetarian',
      'Rating',
      'Last made',
      'Source',
      'Notes',
    ]);

    const cuisine = res.body.properties.find(
      (p: { name: string }) => p.name === 'Cuisine'
    );
    expect(cuisine.options.map((o: { label: string; color: string }) => [o.label, o.color]))
      .toEqual([
        ['Italian', '#c0392b'],
        ['Mexican', '#ecad0a'],
        ['Japanese', '#209dd7'],
        ['Middle Eastern', '#3d9a50'],
        ['Baking', '#b07d2b'],
      ]);

    const rating = res.body.properties.find(
      (p: { name: string }) => p.name === 'Rating'
    );
    expect(rating.options.map((o: { label: string; color: string }) => [o.label, o.color]))
      .toEqual([
        ['Loved', '#753991'],
        ['Good', '#209dd7'],
        ['Meh', '#8a8f98'],
      ]);

    expect(res.body.rows.map((r: { title: string }) => r.title)).toEqual([
      "Marcella Hazan's tomato sauce",
      'Chicken tinga tacos',
      'Miso soup, properly',
      'Focaccia',
      'Shakshuka',
    ]);

    // First row has three blocks (h2, numbered, numbered, todo).
    const first = res.body.rows[0];
    const blocks = await request(env.app).get(`/api/pages/${first.id}/blocks`);
    expect(blocks.body.blocks.map((b: { type: string }) => b.type)).toEqual([
      'h2',
      'numbered',
      'numbered',
      'todo',
    ]);

    // Marcella: Italian, prep 45, veg true, Loved, last made 2026-07-12,
    // source set, notes set.
    const marcella = res.body.rows.find(
      (r: { title: string }) => r.title === "Marcella Hazan's tomato sauce"
    );
    const cuisineId = cuisine.id;
    const prepId = res.body.properties.find((p: { name: string }) => p.name === 'Prep time').id;
    const vegId = res.body.properties.find((p: { name: string }) => p.name === 'Vegetarian').id;
    const ratingId = rating.id;
    const lastMadeId = res.body.properties.find((p: { name: string }) => p.name === 'Last made').id;
    const sourceId = res.body.properties.find((p: { name: string }) => p.name === 'Source').id;
    const notesId = res.body.properties.find((p: { name: string }) => p.name === 'Notes').id;
    const italianId = cuisine.options.find((o: { label: string }) => o.label === 'Italian').id;
    const lovedId = rating.options.find((o: { label: string }) => o.label === 'Loved').id;
    expect(marcella.values[cuisineId]).toBe(italianId);
    expect(marcella.values[prepId]).toBe(45);
    expect(marcella.values[vegId]).toBe(true);
    expect(marcella.values[ratingId]).toBe(lovedId);
    expect(marcella.values[lastMadeId]).toBe('2026-07-12');
    expect(marcella.values[sourceId]).toBe(
      'https://www.seriouseats.com/marcella-hazan-tomato-sauce-recipe'
    );
    expect(marcella.values[notesId]).toBe(
      'Butter, onion, tinned tomatoes. That is the whole trick.'
    );

    // Shakshuka has Last made and Source absent (null), Notes present.
    const shakshuka = res.body.rows.find(
      (r: { title: string }) => r.title === 'Shakshuka'
    );
    expect(shakshuka.values[lastMadeId]).toBeUndefined();
    expect(shakshuka.values[sourceId]).toBeUndefined();
    expect(shakshuka.values[notesId]).toBe('Needs more cumin next time');

    // Chicken tinga has no row blocks (no `blocks` field on the seeded row).
    const tinga = res.body.rows.find(
      (r: { title: string }) => r.title === 'Chicken tinga tacos'
    );
    const tingaBlocks = await request(env.app).get(`/api/pages/${tinga.id}/blocks`);
    expect(tingaBlocks.body.blocks).toEqual([]);
  });

  it('Recipes views are seeded (table sort, board groupBy, list title sort)', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const recipes = tree.pages.find((p: { title: string }) => p.title === 'Recipes');
    const res = await request(env.app).get(`/api/databases/${recipes.id}`);
    const lastMade = res.body.properties.find(
      (p: { name: string }) => p.name === 'Last made'
    );
    const cuisine = res.body.properties.find(
      (p: { name: string }) => p.name === 'Cuisine'
    );
    expect(res.body.views.table).toEqual({
      sort: { propertyId: lastMade.id, direction: 'desc' },
    });
    expect(res.body.views.board).toEqual({ groupBy: cuisine.id });
    expect(res.body.views.list).toEqual({
      sort: { propertyId: 'title', direction: 'asc' },
    });
  });
});

describe('seeded journal and stub pages', () => {
  beforeEach(() => {
    env.cleanup();
    env = setup({ seed: true });
  });

  it('nests July, May and February under 2026 with blocks', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const journal = tree.pages.find((p: { title: string }) => p.title === 'Journal');
    const year = tree.pages.find((p: { title: string }) => p.title === '2026');
    expect(year.parentId).toBe(journal.id);

    const july = tree.pages.find((p: { title: string }) => p.title === 'July');
    const may = tree.pages.find((p: { title: string }) => p.title === 'May');
    const february = tree.pages.find((p: { title: string }) => p.title === 'February');
    expect(july.parentId).toBe(year.id);
    expect(may.parentId).toBe(year.id);
    expect(february.parentId).toBe(year.id);
    expect(july.icon).toBe('☀️');
    expect(may.icon).toBe('🌧️');
    expect(february.icon).toBe('❄️');

    const julyBlocks = (await request(env.app).get(`/api/pages/${july.id}/blocks`)).body
      .blocks;
    expect(julyBlocks.map((b: { type: string }) => b.type)).toEqual([
      'callout',
      'h2',
      'bulleted',
      'bulleted',
      'todo',
    ]);

    const mayBlocks = (await request(env.app).get(`/api/pages/${may.id}/blocks`)).body
      .blocks;
    expect(mayBlocks.map((b: { type: string }) => b.type)).toEqual([
      'paragraph',
      'quote',
      'todo',
    ]);

    const febBlocks = (await request(env.app).get(`/api/pages/${february.id}/blocks`))
      .body.blocks;
    expect(febBlocks.map((b: { type: string }) => b.type)).toEqual([
      'paragraph',
      'divider',
      'bulleted',
    ]);
  });

  it('seeds blocks into the Food to Try, Paint & Materials and Contractor Quotes stubs', async () => {
    const tree = (await request(env.app).get('/api/tree')).body;
    const food = tree.pages.find((p: { title: string }) => p.title === 'Food to Try');
    const paint = tree.pages.find((p: { title: string }) => p.title === 'Paint & Materials');
    const quotes = tree.pages.find((p: { title: string }) => p.title === 'Contractor Quotes');

    const foodBlocks = (await request(env.app).get(`/api/pages/${food.id}/blocks`)).body
      .blocks;
    expect(foodBlocks.map((b: { type: string }) => b.type)).toEqual([
      'h2',
      'bulleted',
      'bulleted',
      'h2',
      'bulleted',
      'bulleted',
    ]);

    const paintBlocks = (await request(env.app).get(`/api/pages/${paint.id}/blocks`)).body
      .blocks;
    expect(paintBlocks.map((b: { type: string }) => b.type)).toEqual([
      'callout',
      'bulleted',
      'bulleted',
      'todo',
    ]);

    const quotesBlocks = (await request(env.app).get(`/api/pages/${quotes.id}/blocks`))
      .body.blocks;
    expect(quotesBlocks.map((b: { type: string }) => b.type)).toEqual([
      'paragraph',
      'numbered',
      'numbered',
      'todo',
    ]);
  });
});
