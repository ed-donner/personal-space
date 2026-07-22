import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { setup, type TestSetup } from './helpers';

let env: TestSetup;
let pageId: string;

beforeEach(async () => {
  env = setup({ seed: false });
  const res = await request(env.app).post('/api/pages').send({ title: 'Page' });
  pageId = res.body.id;
});
afterEach(() => {
  env.cleanup();
});

const ALL_TYPES = [
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

describe('POST /api/pages/:id/blocks', () => {
  it('creates a paragraph with default content', async () => {
    const res = await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'paragraph' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.pageId).toBe(pageId);
    expect(res.body.type).toBe('paragraph');
    expect(res.body.content).toEqual({ text: '' });
    expect(res.body.position).toBe(0);
  });

  it('applies default content for every block type', async () => {
    for (const type of ALL_TYPES) {
      const res = await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe(type);
      if (type === 'todo') {
        expect(res.body.content).toEqual({ text: '', checked: false });
      } else if (type === 'divider') {
        expect(res.body.content).toEqual({});
      } else {
        expect(res.body.content).toEqual({ text: '' });
      }
    }
  });

  it('accepts caller-supplied content', async () => {
    const res = await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'paragraph', content: { text: 'hi' } });
    expect(res.status).toBe(201);
    expect(res.body.content).toEqual({ text: 'hi' });
  });

  it('defaults todo checked to false when content omits it', async () => {
    const res = await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'todo', content: { text: 'buy milk' } });
    expect(res.status).toBe(201);
    expect(res.body.content).toEqual({ text: 'buy milk', checked: false });
  });

  it('appends blocks in order when no position is given', async () => {
    const a = await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'paragraph', content: { text: 'a' } });
    const b = await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'paragraph', content: { text: 'b' } });
    expect(a.body.position).toBe(0);
    expect(b.body.position).toBe(1);
  });

  it('inserting at position 0 shifts existing blocks', async () => {
    await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'paragraph', content: { text: 'first' } });
    await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'paragraph', content: { text: 'second' } });
    const inserted = await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'h1', content: { text: 'NEW' }, position: 0 });
    expect(inserted.status).toBe(201);
    expect(inserted.body.position).toBe(0);

    const list = await request(env.app).get(`/api/pages/${pageId}/blocks`);
    expect(list.body.blocks.map((b: { content: { text: string } }) => b.content.text)).toEqual([
      'NEW',
      'first',
      'second',
    ]);
  });

  it('inserting in the middle shifts only the blocks at/after that position', async () => {
    const ids: string[] = [];
    for (const t of ['a', 'b', 'c']) {
      ids.push(
        (
          await request(env.app)
            .post(`/api/pages/${pageId}/blocks`)
            .send({ type: 'paragraph', content: { text: t } })
        ).body.id
      );
    }
    const inserted = await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'paragraph', content: { text: 'X' }, position: 1 });
    expect(inserted.body.position).toBe(1);

    const list = await request(env.app).get(`/api/pages/${pageId}/blocks`);
    const order = list.body.blocks.map((b: { content: { text: string } }) => b.content.text);
    expect(order).toEqual(['a', 'X', 'b', 'c']);
  });

  it('rejects an unknown block type with 400', async () => {
    const res = await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'banana' });
    expect(res.status).toBe(400);
  });

  it('rejects non-object content with 400', async () => {
    const res = await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'paragraph', content: 'nope' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown page', async () => {
    const res = await request(env.app)
      .post('/api/pages/does-not-exist/blocks')
      .send({ type: 'paragraph' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/pages/:id/blocks', () => {
  it('returns blocks ordered by position', async () => {
    await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'paragraph', content: { text: 'one' } });
    await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'paragraph', content: { text: 'two' } });
    const res = await request(env.app).get(`/api/pages/${pageId}/blocks`);
    expect(res.status).toBe(200);
    expect(res.body.blocks.map((b: { content: { text: string } }) => b.content.text)).toEqual([
      'one',
      'two',
    ]);
  });

  it('returns 404 for an unknown page', async () => {
    const res = await request(env.app).get('/api/pages/none/blocks');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/blocks/:id', () => {
  it('merges content shallowly over the existing content', async () => {
    const block = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'todo', content: { text: 'task', checked: false } })
    ).body;
    const res = await request(env.app)
      .patch(`/api/blocks/${block.id}`)
      .send({ content: { checked: true } });
    expect(res.status).toBe(200);
    expect(res.body.content).toEqual({ text: 'task', checked: true });
  });

  it('toggles a todo off via PATCH', async () => {
    const block = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'todo', content: { text: 'done task', checked: true } })
    ).body;
    const res = await request(env.app)
      .patch(`/api/blocks/${block.id}`)
      .send({ content: { checked: false } });
    expect(res.status).toBe(200);
    expect(res.body.content.checked).toBe(false);
  });

  it('changes type to todo and defaults checked:false if absent', async () => {
    const block = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'paragraph', content: { text: 'become a todo' } })
    ).body;
    const res = await request(env.app)
      .patch(`/api/blocks/${block.id}`)
      .send({ type: 'todo' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('todo');
    expect(res.body.content).toEqual({ text: 'become a todo', checked: false });
  });

  it('changing type to divider resets content to {}', async () => {
    const block = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'paragraph', content: { text: 'lots of text' } })
    ).body;
    const res = await request(env.app)
      .patch(`/api/blocks/${block.id}`)
      .send({ type: 'divider' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('divider');
    expect(res.body.content).toEqual({});
  });

  it('changing type to divider ignores supplied content', async () => {
    const block = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'paragraph', content: { text: 'x' } })
    ).body;
    const res = await request(env.app)
      .patch(`/api/blocks/${block.id}`)
      .send({ type: 'divider', content: { text: 'ignored' } });
    expect(res.status).toBe(200);
    expect(res.body.content).toEqual({});
  });

  it('rejects an unknown type with 400', async () => {
    const block = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'paragraph' })
    ).body;
    const res = await request(env.app)
      .patch(`/api/blocks/${block.id}`)
      .send({ type: 'banana' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown block', async () => {
    const res = await request(env.app)
      .patch('/api/blocks/nope')
      .send({ content: { text: 'x' } });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/blocks/:id', () => {
  it('deletes a block and reports deleted:1', async () => {
    const block = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'paragraph' })
    ).body;
    const res = await request(env.app).delete(`/api/blocks/${block.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
    const list = await request(env.app).get(`/api/pages/${pageId}/blocks`);
    expect(list.body.blocks).toHaveLength(0);
  });

  it('returns 404 for an unknown block', async () => {
    const res = await request(env.app).delete('/api/blocks/nope');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/pages/:id/blocks/order', () => {
  it('reorders blocks and sets position = index', async () => {
    const a = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'paragraph', content: { text: 'a' } })
    ).body;
    const b = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'paragraph', content: { text: 'b' } })
    ).body;
    const c = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'paragraph', content: { text: 'c' } })
    ).body;

    const res = await request(env.app)
      .put(`/api/pages/${pageId}/blocks/order`)
      .send({ ids: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body.blocks.map((b: { id: string }) => b.id)).toEqual([c.id, a.id, b.id]);
    expect(res.body.blocks.map((b: { position: number }) => b.position)).toEqual([0, 1, 2]);
  });

  it('rejects an extra id with 400', async () => {
    const a = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'paragraph' })
    ).body;
    const res = await request(env.app)
      .put(`/api/pages/${pageId}/blocks/order`)
      .send({ ids: [a.id, 'made-up-id'] });
    expect(res.status).toBe(400);
  });

  it('rejects a missing id with 400', async () => {
    const a = (
      await request(env.app)
        .post(`/api/pages/${pageId}/blocks`)
        .send({ type: 'paragraph' })
    ).body;
    await request(env.app)
      .post(`/api/pages/${pageId}/blocks`)
      .send({ type: 'paragraph' });
    const res = await request(env.app)
      .put(`/api/pages/${pageId}/blocks/order`)
      .send({ ids: [a.id] });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown page', async () => {
    const res = await request(env.app)
      .put('/api/pages/none/blocks/order')
      .send({ ids: [] });
    expect(res.status).toBe(404);
  });
});
