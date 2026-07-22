import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { setup, type TestSetup } from './helpers';
import { seedIfEmpty } from '../seed';

let env: TestSetup;
beforeEach(() => {
  env = setup({ seed: true });
});
afterEach(() => {
  env.cleanup();
});

describe('GET /api/tree', () => {
  it('returns seeded pages with their icons', async () => {
    const res = await request(env.app).get('/api/tree');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.pages)).toBe(true);

    const titles = res.body.pages.map((p: { title: string }) => p.title);
    expect(titles).toContain('Projects');
    expect(titles).toContain('Home Renovation');
    expect(titles).toContain('Q3 Planning');
    expect(titles).toContain('Japan 2027');
    expect(titles).toContain('Food to Try');
    expect(titles).toContain('Reading List');
    expect(titles).toContain('Recipes');

    const projects = res.body.pages.find(
      (p: { title: string }) => p.title === 'Projects'
    );
    expect(projects.icon).toBe('📋');
    const reading = res.body.pages.find(
      (p: { title: string }) => p.title === 'Reading List'
    );
    expect(reading.icon).toBe('📚');
    expect(reading.kind).toBe('database');
  });

  it('excludes kind=row pages', async () => {
    // Create a database page and a row under it.
    const dbPage = (
      await request(env.app)
        .post('/api/pages')
        .send({ kind: 'database', title: 'A Database' })
    ).body;
    env.db
      .prepare(
        `INSERT INTO pages (id, parent_id, title, icon, kind, position, "values", created_at, updated_at)
         VALUES (?, ?, 'A Row', NULL, 'row', 0, '{}', ?, ?)`
      )
      .run('row-1', dbPage.id, new Date().toISOString(), new Date().toISOString());

    const res = await request(env.app).get('/api/tree');
    expect(res.status).toBe(200);

    const kinds = res.body.pages.map((p: { kind: string }) => p.kind);
    expect(kinds).not.toContain('row');
    const ids = res.body.pages.map((p: { id: string }) => p.id);
    expect(ids).not.toContain('row-1');
    // The database page itself should still appear.
    expect(ids).toContain(dbPage.id);
  });

  it('orders siblings by position', async () => {
    const res = await request(env.app).get('/api/tree');
    // Root-level pages in seed order: Projects, Travel, Journal, Reading List, Recipes.
    const roots = res.body.pages.filter(
      (p: { parentId: string | null }) => p.parentId === null
    );
    expect(roots.map((p: { title: string }) => p.title)).toEqual([
      'Projects',
      'Travel',
      'Journal',
      'Reading List',
      'Recipes',
    ]);
  });
});

describe('seed', () => {
  it('populates a fresh database', () => {
    const count = env.db.prepare('SELECT COUNT(*) AS c FROM pages').get() as {
      c: number;
    };
    expect(count.c).toBeGreaterThan(0);
    // Prior seed: Projects(1) + Home Renovation(1) + Paint & Materials(1)
    // + Contractor Quotes(1) + Renovation Tasks DB(1) + 5 renovation rows
    // + Work(1) + Q3 Planning(1) + Travel(1) + Japan 2027(1) + Food to Try(1)
    // + Journal(1) + 2026(1) + July(1) + May(1) + February(1)
    // + Reading List DB(1) + 6 reading rows + Recipes DB(1) + 5 recipe rows = 33.
    expect(count.c).toBe(33);
  });

  it('does not duplicate when run a second time', () => {
    const before = env.db.prepare('SELECT COUNT(*) AS c FROM pages').get() as {
      c: number;
    };
    seedIfEmpty(env.db); // should be a no-op
    const after = env.db.prepare('SELECT COUNT(*) AS c FROM pages').get() as {
      c: number;
    };
    expect(after.c).toBe(before.c);
  });
});
