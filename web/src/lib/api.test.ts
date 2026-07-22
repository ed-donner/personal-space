import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { api, ApiError } from './api';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getTree hits /api/tree and parses the response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pages: [] }));
    const result = await api.getTree();
    expect(result).toEqual({ pages: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tree',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it('getPage URL-encodes the id and returns the page', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'a/b', parentId: null, title: 'T', icon: null, kind: 'page', position: 0 })
    );
    const p = await api.getPage('a/b');
    expect(p.id).toBe('a/b');
    expect(fetchMock).toHaveBeenCalledWith('/api/pages/a%2Fb', expect.any(Object));
  });

  it('createPage sends a JSON POST with the right body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'x', parentId: 'p', title: 'T', icon: '🐱', kind: 'page', position: 0 }, 201)
    );
    await api.createPage({ parentId: 'p', title: 'T', icon: '🐱' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      parentId: 'p',
      title: 'T',
      icon: '🐱',
    });
  });

  it('updatePage sends a JSON PATCH', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'x', parentId: null, title: 'New', icon: null, kind: 'page', position: 0 })
    );
    await api.updatePage('x', { title: 'New' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'New' });
  });

  it('updatePage can set icon=null explicitly', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'x', parentId: null, title: 'T', icon: null, kind: 'page', position: 0 })
    );
    await api.updatePage('x', { icon: null });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      icon: null,
    });
  });

  it('deletePage sends DELETE and parses the count', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: 3 }));
    const r = await api.deletePage('x');
    expect(r).toEqual({ deleted: 3 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pages/x');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('throws ApiError with the server message on a non-2xx response', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({ error: 'title must not be empty' }, 400)
    );
    const err = await api.updatePage('x', { title: ' ' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      message: 'title must not be empty',
      status: 400,
    });
  });

  it('falls back to a status-based message when the body is not JSON', async () => {
    fetchMock.mockImplementation(() => new Response('not-json', { status: 500 }));
    const err = await api.getPage('x').catch((e) => e);
    expect(err).toMatchObject({ status: 500 });
    expect((err as Error).message).toMatch(/500/);
  });

  it('preserves the 204 No Content path (returns undefined)', async () => {
    // The DELETE route is the only one that uses 204 in some hypothetical
    // future shape, but the request helper is shared. Verify the helper
    // returns undefined for a 204 instead of throwing on JSON parse.
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    // ApiError should not be thrown; the method should resolve.
    await expect(api.getTree()).resolves.toBeUndefined();
  });
});
