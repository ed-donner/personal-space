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

async function addProperty(body: { name: string; type: string; options?: unknown }) {
  return request(env.app).post(`/api/databases/${dbId}/properties`).send(body);
}

async function addRow(title?: string) {
  return request(env.app)
    .post(`/api/databases/${dbId}/rows`)
    .send(title === undefined ? {} : { title });
}

async function patchView(viewType: string, settings: unknown) {
  return request(env.app)
    .patch(`/api/databases/${dbId}/views/${viewType}`)
    .send({ settings });
}

describe('PATCH /api/databases/:id/views/:viewType', () => {
  it('round-trips table view settings and returns the full views object', async () => {
    const author = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await patchView('table', {
      filters: [{ propertyId: author.id, op: 'contains', value: 'Andy' }],
      sort: { propertyId: author.id, direction: 'asc' },
    });
    expect(res.status).toBe(200);
    expect(res.body.table).toEqual({
      filters: [{ propertyId: author.id, op: 'contains', value: 'Andy' }],
      sort: { propertyId: author.id, direction: 'asc' },
    });
    // The other views are untouched.
    expect(res.body.board).toEqual({});
    expect(res.body.list).toEqual({});
    expect(Object.keys(res.body).sort()).toEqual(['board', 'list', 'table']);
  });

  it('round-trips board view settings with groupBy', async () => {
    const status = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [{ id: 's1', label: 'A', color: '#fff' }],
      })
    ).body;
    const res = await patchView('board', { groupBy: status.id });
    expect(res.status).toBe(200);
    expect(res.body.board).toEqual({ groupBy: status.id });
  });

  it('round-trips list view settings with title sort', async () => {
    const res = await patchView('list', {
      sort: { propertyId: 'title', direction: 'asc' },
    });
    expect(res.status).toBe(200);
    expect(res.body.list).toEqual({
      sort: { propertyId: 'title', direction: 'asc' },
    });
  });

  it('ignores unknown keys inside settings', async () => {
    const author = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await patchView('table', {
      sort: { propertyId: author.id, direction: 'asc' },
      bogus: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.table).toEqual({
      sort: { propertyId: author.id, direction: 'asc' },
    });
  });

  it('rejects an unknown viewType with 400', async () => {
    const res = await patchView('kanban', {});
    expect(res.status).toBe(400);
  });

  it('returns 404 when the database does not exist', async () => {
    const res = await request(env.app)
      .patch('/api/databases/nope/views/table')
      .send({ settings: {} });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the page is not a database', async () => {
    const page = (
      await request(env.app).post('/api/pages').send({ title: 'Plain' })
    ).body;
    const res = await request(env.app)
      .patch(`/api/databases/${page.id}/views/table`)
      .send({ settings: {} });
    expect(res.status).toBe(404);
  });

  it('rejects a filter with an unknown propertyId with 400', async () => {
    const res = await patchView('table', {
      filters: [{ propertyId: 'made-up', op: 'contains', value: 'x' }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a filter op not fitting the type (contains on checkbox) with 400', async () => {
    const done = (await addProperty({ name: 'Done', type: 'checkbox' })).body;
    const res = await patchView('table', {
      filters: [{ propertyId: done.id, op: 'contains', value: 'x' }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown filter op with 400', async () => {
    const author = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await patchView('table', {
      filters: [{ propertyId: author.id, op: 'matches', value: 'x' }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a filter value missing for a non-checkbox op with 400', async () => {
    const author = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await patchView('table', {
      filters: [{ propertyId: author.id, op: 'contains' }],
    });
    expect(res.status).toBe(400);
  });

  it('accepts a checkbox filter without a value', async () => {
    const done = (await addProperty({ name: 'Done', type: 'checkbox' })).body;
    const res = await patchView('table', {
      filters: [{ propertyId: done.id, op: 'is_not_checked' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.table.filters[0]).toEqual({
      propertyId: done.id,
      op: 'is_not_checked',
    });
  });

  it('accepts is/is_not on multi_select', async () => {
    const tags = (
      await addProperty({
        name: 'Tags',
        type: 'multi_select',
        options: [{ id: 't1', label: 'A', color: '#fff' }],
      })
    ).body;
    const res = await patchView('table', {
      filters: [{ propertyId: tags.id, op: 'is', value: 't1' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.table.filters[0]).toEqual({
      propertyId: tags.id,
      op: 'is',
      value: 't1',
    });
  });

  it('accepts before/after on date', async () => {
    const started = (await addProperty({ name: 'Started', type: 'date' })).body;
    const res = await patchView('table', {
      filters: [{ propertyId: started.id, op: 'before', value: '2026-12-31' }],
    });
    expect(res.status).toBe(200);
  });

  it('rejects a sort with an unknown propertyId with 400', async () => {
    const res = await patchView('table', {
      sort: { propertyId: 'made-up', direction: 'asc' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects a sort with a bad direction with 400', async () => {
    const author = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await patchView('table', {
      sort: { propertyId: author.id, direction: 'up' },
    });
    expect(res.status).toBe(400);
  });

  it('accepts sort null to clear a sort', async () => {
    const author = (await addProperty({ name: 'Author', type: 'text' })).body;
    await patchView('table', {
      sort: { propertyId: author.id, direction: 'asc' },
    });
    const res = await patchView('table', { sort: null });
    expect(res.status).toBe(200);
    expect(res.body.table).toEqual({ sort: null });
  });

  it('rejects groupBy on a non-select property with 400', async () => {
    const author = (await addProperty({ name: 'Author', type: 'text' })).body;
    const res = await patchView('board', { groupBy: author.id });
    expect(res.status).toBe(400);
  });

  it('rejects groupBy on an unknown property with 400', async () => {
    const res = await patchView('board', { groupBy: 'made-up' });
    expect(res.status).toBe(400);
  });

  it('accepts groupBy null to clear grouping', async () => {
    const status = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [{ id: 's1', label: 'A', color: '#fff' }],
      })
    ).body;
    await patchView('board', { groupBy: status.id });
    const res = await patchView('board', { groupBy: null });
    expect(res.status).toBe(200);
    expect(res.body.board).toEqual({ groupBy: null });
  });

  it('rejects a non-object settings value with 400', async () => {
    const res = await patchView('table', 'not an object');
    expect(res.status).toBe(400);
  });

  it('rejects a missing settings field with 400', async () => {
    const res = await request(env.app)
      .patch(`/api/databases/${dbId}/views/table`)
      .send({ notSettings: {} });
    expect(res.status).toBe(400);
  });

  it('full-replaces settings (does not merge with prior)', async () => {
    const author = (await addProperty({ name: 'Author', type: 'text' })).body;
    const status = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [{ id: 's1', label: 'A', color: '#fff' }],
      })
    ).body;
    await patchView('table', {
      filters: [{ propertyId: status.id, op: 'is', value: 's1' }],
      sort: { propertyId: author.id, direction: 'asc' },
    });
    // Replace with only a sort -> filters should be gone.
    const res = await patchView('table', {
      sort: { propertyId: author.id, direction: 'desc' },
    });
    expect(res.status).toBe(200);
    expect(res.body.table).toEqual({
      sort: { propertyId: author.id, direction: 'desc' },
    });
    expect(res.body.table.filters).toBeUndefined();
  });

  it('persists settings across a re-fetch via GET /api/databases/:id', async () => {
    const status = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [{ id: 's1', label: 'A', color: '#fff' }],
      })
    ).body;
    await patchView('board', { groupBy: status.id });
    const res = await request(env.app).get(`/api/databases/${dbId}`);
    expect(res.status).toBe(200);
    expect(res.body.views.board).toEqual({ groupBy: status.id });
  });
});

describe('DEF-004: orphaned select values after option replacement', () => {
  it('clears a select value referencing a removed option id', async () => {
    const status = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [
          { id: 's1', label: 'Draft', color: '#8a8f98' },
          { id: 's2', label: 'Ready', color: '#3d9a50' },
        ],
      })
    ).body;
    const row = (await addRow('Book')).body;
    await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [status.id]: 's1' } });

    const before = (await request(env.app).get(`/api/databases/${dbId}`)).body;
    expect(before.rows[0].values[status.id]).toBe('s1');

    // Replace options without s1 (Draft removed).
    const res = await request(env.app)
      .patch(`/api/properties/${status.id}`)
      .send({ options: [{ id: 's2', label: 'Ready', color: '#3d9a50' }] });
    expect(res.status).toBe(200);

    const after = (await request(env.app).get(`/api/databases/${dbId}`)).body;
    expect(after.rows[0].values[status.id]).toBeUndefined();
  });

  it('filters removed ids out of a multi_select array and keeps valid ones', async () => {
    const tags = (
      await addProperty({
        name: 'Tags',
        type: 'multi_select',
        options: [
          { id: 't1', label: 'A', color: '#fff' },
          { id: 't2', label: 'B', color: '#fff' },
          { id: 't3', label: 'C', color: '#fff' },
        ],
      })
    ).body;
    const row = (await addRow('Book')).body;
    await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [tags.id]: ['t1', 't2', 't3'] } });

    // Remove t2; keep t1 and t3.
    const res = await request(env.app)
      .patch(`/api/properties/${tags.id}`)
      .send({
        options: [
          { id: 't1', label: 'A', color: '#fff' },
          { id: 't3', label: 'C', color: '#fff' },
        ],
      });
    expect(res.status).toBe(200);

    const after = (await request(env.app).get(`/api/databases/${dbId}`)).body;
    expect(after.rows[0].values[tags.id]).toEqual(['t1', 't3']);
  });

  it('drops a multi_select key when all its ids are removed', async () => {
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
    await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({ values: { [tags.id]: ['t1', 't2'] } });

    await request(env.app)
      .patch(`/api/properties/${tags.id}`)
      .send({ options: [] });

    const after = (await request(env.app).get(`/api/databases/${dbId}`)).body;
    expect(after.rows[0].values[tags.id]).toBeUndefined();
  });

  it('leaves values for untouched options in place', async () => {
    const status = (
      await addProperty({
        name: 'Status',
        type: 'select',
        options: [
          { id: 's1', label: 'A', color: '#fff' },
          { id: 's2', label: 'B', color: '#fff' },
        ],
      })
    ).body;
    const tags = (
      await addProperty({
        name: 'Tags',
        type: 'multi_select',
        options: [
          { id: 't1', label: 'A', color: '#fff' },
          { id: 't2', label: 'B', color: '#fff' },
          { id: 't3', label: 'C', color: '#fff' },
        ],
      })
    ).body;
    const row = (await addRow('Book')).body;
    await request(env.app)
      .patch(`/api/rows/${row.id}`)
      .send({
        values: { [status.id]: 's1', [tags.id]: ['t1', 't2', 't3'] },
      });

    // Replace status options keeping s1 (A stays); replace tags dropping t2.
    await request(env.app)
      .patch(`/api/properties/${status.id}`)
      .send({ options: [{ id: 's1', label: 'A', color: '#fff' }] });
    await request(env.app)
      .patch(`/api/properties/${tags.id}`)
      .send({
        options: [
          { id: 't1', label: 'A', color: '#fff' },
          { id: 't3', label: 'C', color: '#fff' },
        ],
      });

    const after = (await request(env.app).get(`/api/databases/${dbId}`)).body;
    expect(after.rows[0].values[status.id]).toBe('s1');
    expect(after.rows[0].values[tags.id]).toEqual(['t1', 't3']);
  });

  it('does not strip values when options is not being updated (rename only)', async () => {
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
      .patch(`/api/properties/${status.id}`)
      .send({ name: 'Situation' });

    const after = (await request(env.app).get(`/api/databases/${dbId}`)).body;
    expect(after.rows[0].values[status.id]).toBe('s1');
  });
});
