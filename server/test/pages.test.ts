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

describe('POST /api/pages', () => {
  it('creates a page with defaults', async () => {
    const res = await request(env.app).post('/api/pages').send({});
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.title).toBe('Untitled');
    expect(res.body.kind).toBe('page');
    expect(res.body.icon).toBeNull();
    expect(res.body.position).toBe(0);
    expect(res.body.parentId).toBeNull();
  });

  it('creates a child page appended after existing siblings', async () => {
    const parent = (
      await request(env.app).post('/api/pages').send({ title: 'Parent' })
    ).body;
    const c1 = (
      await request(env.app)
        .post('/api/pages')
        .send({ parentId: parent.id, title: 'C1' })
    ).body;
    const c2 = (
      await request(env.app)
        .post('/api/pages')
        .send({ parentId: parent.id, title: 'C2' })
    ).body;

    expect(c1.position).toBe(0);
    expect(c2.position).toBe(1);
    expect(c1.parentId).toBe(parent.id);
    expect(c2.parentId).toBe(parent.id);
  });

  it('keeps root-page positions independent of child positions', async () => {
    const r1 = (await request(env.app).post('/api/pages').send({ title: 'R1' })).body;
    const r2 = (await request(env.app).post('/api/pages').send({ title: 'R2' })).body;
    expect(r1.position).toBe(0);
    expect(r2.position).toBe(1);
  });

  it('creates the three default views when kind=database', async () => {
    const res = await request(env.app)
      .post('/api/pages')
      .send({ kind: 'database', title: 'My DB', icon: '🗃️' });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('database');

    const views = env.db
      .prepare('SELECT view_type, settings FROM views WHERE database_id = ?')
      .all(res.body.id) as { view_type: string; settings: string | null }[];
    const types = views.map((v) => v.view_type).sort();
    expect(types).toEqual(['board', 'list', 'table']);
    for (const v of views) {
      expect(v.settings).toBe('{}');
    }
  });

  it('rejects an invalid kind with 400', async () => {
    const res = await request(env.app)
      .post('/api/pages')
      .send({ kind: 'banana' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/pages/:id', () => {
  it('reads an existing page', async () => {
    const created = (
      await request(env.app).post('/api/pages').send({ title: 'Hi', icon: '👋' })
    ).body;
    const res = await request(env.app).get(`/api/pages/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.id);
    expect(res.body.title).toBe('Hi');
    expect(res.body.icon).toBe('👋');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(env.app).get('/api/pages/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});

describe('PATCH /api/pages/:id', () => {
  it('renames a page', async () => {
    const p = (
      await request(env.app).post('/api/pages').send({ title: 'Old' })
    ).body;
    const res = await request(env.app)
      .patch(`/api/pages/${p.id}`)
      .send({ title: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New Name');
  });

  it('rejects a whitespace-only title with 400', async () => {
    const p = (await request(env.app).post('/api/pages').send({ title: 'X' })).body;
    const res = await request(env.app)
      .patch(`/api/pages/${p.id}`)
      .send({ title: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects an empty-string title with 400', async () => {
    const p = (await request(env.app).post('/api/pages').send({ title: 'X' })).body;
    const res = await request(env.app)
      .patch(`/api/pages/${p.id}`)
      .send({ title: '' });
    expect(res.status).toBe(400);
  });

  it('updates icon and position', async () => {
    const p = (await request(env.app).post('/api/pages').send({ title: 'X' })).body;
    const res = await request(env.app)
      .patch(`/api/pages/${p.id}`)
      .send({ icon: '🎯', position: 7 });
    expect(res.status).toBe(200);
    expect(res.body.icon).toBe('🎯');
    expect(res.body.position).toBe(7);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(env.app)
      .patch('/api/pages/nope')
      .send({ title: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/pages/:id', () => {
  it('deletes a leaf page and reports deleted count of 1', async () => {
    const p = (await request(env.app).post('/api/pages').send({ title: 'Lonely' })).body;
    const res = await request(env.app).delete(`/api/pages/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    const after = env.db
      .prepare('SELECT COUNT(*) AS c FROM pages WHERE id = ?')
      .get(p.id) as { c: number };
    expect(after.c).toBe(0);
  });

  it('cascades to nested descendants and reports the right count', async () => {
    const root = (
      await request(env.app).post('/api/pages').send({ title: 'Root' })
    ).body;
    const child = (
      await request(env.app)
        .post('/api/pages')
        .send({ parentId: root.id, title: 'Child' })
    ).body;
    await request(env.app)
      .post('/api/pages')
      .send({ parentId: child.id, title: 'Grandchild A' });
    await request(env.app)
      .post('/api/pages')
      .send({ parentId: child.id, title: 'Grandchild B' });

    const res = await request(env.app).delete(`/api/pages/${root.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(4);

    const remaining = env.db.prepare('SELECT COUNT(*) AS c FROM pages').get() as {
      c: number;
    };
    expect(remaining.c).toBe(0);
  });

  it('deletes views and properties of a deleted database', async () => {
    const db = (
      await request(env.app)
        .post('/api/pages')
        .send({ kind: 'database', title: 'DB' })
    ).body;
    // Manually add a property and confirm it is removed on delete.
    env.db
      .prepare(
        `INSERT INTO properties (id, database_id, name, type, options, position)
         VALUES (?, ?, 'Name', 'text', NULL, 0)`
      )
      .run('prop-1', db.id);

    const res = await request(env.app).delete(`/api/pages/${db.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);

    const views = env.db
      .prepare('SELECT COUNT(*) AS c FROM views WHERE database_id = ?')
      .get(db.id) as { c: number };
    expect(views.c).toBe(0);
    const props = env.db
      .prepare('SELECT COUNT(*) AS c FROM properties WHERE database_id = ?')
      .get(db.id) as { c: number };
    expect(props.c).toBe(0);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(env.app).delete('/api/pages/nope');
    expect(res.status).toBe(404);
  });
});
