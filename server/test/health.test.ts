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

describe('GET /api/health', () => {
  it('returns { ok: true }', async () => {
    const res = await request(env.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
