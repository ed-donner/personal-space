import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { setup, type TestSetup } from './helpers';

let env: TestSetup;

beforeEach(() => {
  env = setup({ seed: false });
});

afterEach(() => {
  env.cleanup();
});

async function makePage(title: string, opts?: { parentId?: string | null }) {
  const res = await request(env.app)
    .post('/api/pages')
    .send({ title, icon: '📄', ...(opts ?? {}) });
  return res.body;
}

async function makeDatabase(title: string) {
  const res = await request(env.app)
    .post('/api/pages')
    .send({ kind: 'database', title, icon: '🗂️' });
  return res.body;
}

async function addRow(dbId: string, title: string) {
  const res = await request(env.app)
    .post(`/api/databases/${dbId}/rows`)
    .send({ title });
  return res.body;
}

describe('GET /api/search', () => {
  it('returns { results: [] } for an empty q', async () => {
    const res = await request(env.app).get('/api/search?q=');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [] });
  });

  it('returns { results: [] } for a whitespace-only q', async () => {
    const res = await request(env.app).get('/api/search?q=%20%20%09');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [] });
  });

  it('returns { results: [] } when q is missing', async () => {
    const res = await request(env.app).get('/api/search');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [] });
  });

  it('matches pages, databases and rows', async () => {
    await makePage('Alpha notes');
    const db = await makeDatabase('Alpha database');
    await addRow(db.id, 'Alpha row');

    const res = await request(env.app).get('/api/search?q=Alpha');
    expect(res.status).toBe(200);
    const titles = res.body.results.map((r: { title: string }) => r.title);
    expect(titles.sort()).toEqual([
      'Alpha database',
      'Alpha notes',
      'Alpha row',
    ]);
  });

  it('matches case-insensitively', async () => {
    await makePage('Banana');
    const lower = await request(env.app).get('/api/search?q=banana');
    const upper = await request(env.app).get('/api/search?q=BANANA');
    const mixed = await request(env.app).get('/api/search?q=BaNanA');
    expect(lower.body.results.map((r: { title: string }) => r.title)).toEqual([
      'Banana',
    ]);
    expect(upper.body.results.map((r: { title: string }) => r.title)).toEqual([
      'Banana',
    ]);
    expect(mixed.body.results.map((r: { title: string }) => r.title)).toEqual([
      'Banana',
    ]);
  });

  it('uses substring matching, not prefix-only', async () => {
    await makePage('The quick brown fox');
    const res = await request(env.app).get('/api/search?q=brown');
    expect(res.body.results.map((r: { title: string }) => r.title)).toEqual([
      'The quick brown fox',
    ]);
  });

  it('does not treat % as a SQL LIKE wildcard', async () => {
    // % would match every title under LIKE semantics; only the page whose
    // title literally contains '%' should match.
    await makePage('Alpha notes');
    await makePage('Beta summary');
    await makePage('Sale 50% off');

    const res = await request(env.app).get('/api/search?q=%25'); // %25 == '%'
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { title: string }) => r.title)).toEqual([
      'Sale 50% off',
    ]);
  });

  it('does not treat _ as a SQL LIKE wildcard', async () => {
    // _ matches any single char under LIKE; only the page whose title
    // literally contains '_' should match.
    await makePage('Alpha notes');
    await makePage('Beta summary');
    await makePage('snake_case');

    const res = await request(env.app).get('/api/search?q=_');
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { title: string }) => r.title)).toEqual([
      'snake_case',
    ]);
  });

  it('returns no results for a % query when no title contains %', async () => {
    await makePage('Alpha notes');
    await makePage('Beta summary');
    const res = await request(env.app).get('/api/search?q=%25'); // %25 == '%'
    expect(res.body.results).toEqual([]);
  });

  it('sets databaseId on row results and not on pages/databases', async () => {
    const page = await makePage('A page');
    const db = await makeDatabase('A database');
    const row = await addRow(db.id, 'A row');

    const res = await request(env.app).get('/api/search?q=A%20');
    const byTitle = new Map(
      res.body.results.map((r: { title: string; databaseId?: string }) => [
        r.title,
        r,
      ])
    );
    expect(byTitle.get('A page').databaseId).toBeUndefined();
    expect(byTitle.get('A database').databaseId).toBeUndefined();
    expect(byTitle.get('A row').databaseId).toBe(db.id);
  });

  it('only returns the listed fields (no blocks/properties leakage)', async () => {
    const db = await makeDatabase('Leak database');
    await addRow(db.id, 'Leak row');
    // Add blocks to the row page and a property to the database so we can
    // assert nothing about them leaks into search results.
    await request(env.app)
      .post(`/api/pages/${db.id}/properties`)
      .send({ name: 'Color', type: 'text' });
    const row = (await request(env.app).get(`/api/databases/${db.id}`)).body
      .rows[0];
    await request(env.app)
      .post(`/api/pages/${row.id}/blocks`)
      .send({ type: 'paragraph', content: { text: 'secret' } });

    const res = await request(env.app).get('/api/search?q=Leak');
    const resultKeys = new Set(Object.keys(res.body.results[0]));
    expect(resultKeys.has('blocks')).toBe(false);
    expect(resultKeys.has('properties')).toBe(false);
    expect(resultKeys.has('values')).toBe(false);
    expect(resultKeys.has('position')).toBe(false);
    expect(resultKeys.has('parentId')).toBe(false);

    // The row's id is present, and databaseId equals the database id.
    const rowResult = res.body.results.find(
      (r: { id: string }) => r.id === row.id
    );
    expect(rowResult).toBeTruthy();
    expect(rowResult.databaseId).toBe(db.id);
  });

  it('orders same-titled results by kind as a stable tiebreaker', async () => {
    const db = await makeDatabase('Shared');
    await makePage('Shared');
    await addRow(db.id, 'Shared');

    const res = await request(env.app).get('/api/search?q=Shared');
    expect(res.body.results.map((r: { kind: string }) => r.kind)).toEqual([
      'database',
      'page',
      'row',
    ]);
  });

  it('orders distinct titles alphabetically, case-insensitively', async () => {
    await makePage('Zebra');
    await makePage('apple');
    await makePage('Mango');
    const res = await request(env.app).get('/api/search?q=a');
    // 'Zebra', 'apple', 'Mango' all contain 'a'.
    const titles = res.body.results.map((r: { title: string }) => r.title);
    expect(titles).toEqual(['apple', 'Mango', 'Zebra']);
  });

  it('caps results at 50', async () => {
    // Create 60 pages whose titles all match the query.
    for (let i = 0; i < 60; i++) {
      await makePage(`Cap ${i.toString().padStart(2, '0')}`);
    }
    const res = await request(env.app).get('/api/search?q=Cap');
    expect(res.body.results.length).toBe(50);
  });

  it('finds seeded rows against a fresh seeded DB', async () => {
    env.cleanup();
    env = setup({ seed: true });

    // "hail" matches the seeded Reading List row "Project Hail Mary".
    const res = await request(env.app).get('/api/search?q=hail');
    const titles = res.body.results.map((r: { title: string }) => r.title);
    expect(titles).toContain('Project Hail Mary');

    const row = res.body.results.find(
      (r: { title: string }) => r.title === 'Project Hail Mary'
    );
    expect(row.kind).toBe('row');
    expect(row.databaseId).toBeTruthy();
  });

  it('finds the seeded Recipes database case-insensitively', async () => {
    env.cleanup();
    env = setup({ seed: true });
    const res = await request(env.app).get('/api/search?q=RECIPES');
    const titles = res.body.results.map((r: { title: string }) => r.title);
    expect(titles).toContain('Recipes');
  });
});
