import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PageView } from './PageView';
import type { Page } from '../lib/api';

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'p1',
    parentId: null,
    title: 'My Page',
    icon: null,
    kind: 'page',
    position: 0,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function installMock(fetchMock: ReturnType<typeof vi.fn>, overrides: Record<string, unknown> = {}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && /\/api\/pages\/[^/]+\/blocks$/.test(url)) {
      return Promise.resolve(jsonResponse({ blocks: [] }));
    }
    if (method === 'GET' && /\/api\/databases\/[^/]+$/.test(url)) {
      return Promise.resolve(
        jsonResponse({
          page: { id: url.split('/').pop(), parentId: null, title: 'DB', icon: null, kind: 'database', position: 0 },
          properties: [],
          rows: [],
          views: {},
        })
      );
    }
    if (method === 'PATCH' && /\/api\/pages\/[^/]+$/.test(url)) {
      const body = JSON.parse((init?.body as string) ?? '{}');
      return Promise.resolve(jsonResponse({ id: 'p1', title: body.title, ...overrides }));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

function patchCall(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.find(
    (call) => ((call[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'PATCH'
  );
}

describe('PageView', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    installMock(fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the title, icon and kind label from the page prop', async () => {
    render(
      <PageView
        page={makePage({ title: 'My Page', icon: '⭐', kind: 'page' })}
        onPageChanged={() => {}}
      />
    );
    expect(screen.getByTestId('page-title')).toHaveTextContent('My Page');
    expect(screen.getByText('⭐')).toBeInTheDocument();
    expect(screen.getByText('Page')).toBeInTheDocument();
  });

  it('shows a default glyph and "Database" for kind=database with no icon', async () => {
    render(
      <MemoryRouter>
        <PageView
          page={makePage({ title: 'Tasks', icon: null, kind: 'database' })}
          onPageChanged={() => {}}
        />
      </MemoryRouter>
    );
    // The DatabaseView mounts and fetches the database shape; the title
    // shown in the header is the database page's own title, with a
    // "Database" kind cue.
    expect(await screen.findByTestId('db-page-title')).toHaveTextContent('Tasks');
    expect(screen.getByText('Database')).toBeInTheDocument();
  });

  it('shows the block editor with a product-true empty state for a regular page', async () => {
    render(
      <PageView
        page={makePage({ title: 'Empty', icon: null, kind: 'page' })}
        onPageChanged={() => {}}
      />
    );
    expect(await screen.findByTestId('block-editor')).toBeInTheDocument();
    expect(screen.getByTestId('block-editor-empty')).toHaveTextContent('Type / for blocks, or just start writing.');
  });

  it('re-renders the title when the page prop changes (sidebar rename, tree refresh)', () => {
    const { rerender } = render(
      <PageView page={makePage({ title: 'AAA' })} onPageChanged={() => {}} />
    );
    expect(screen.getByTestId('page-title')).toHaveTextContent('AAA');
    rerender(
      <PageView page={makePage({ title: 'BBB' })} onPageChanged={() => {}} />
    );
    expect(screen.getByTestId('page-title')).toHaveTextContent('BBB');
  });

  it('inline-renames the title on Enter and notifies the parent', async () => {
    const onPageChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <PageView
        page={makePage({ id: 'p3', title: 'Old' })}
        onPageChanged={onPageChanged}
      />
    );
    const title = screen.getByTestId('page-title');
    await user.click(title);
    const input = screen.getByTestId('page-title-input');
    await user.clear(input);
    await user.type(input, 'New{Enter}');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pages/p3',
        expect.objectContaining({ method: 'PATCH' })
      );
    });
    expect(onPageChanged).toHaveBeenCalled();
    const call = patchCall(fetchMock);
    expect(call).toBeDefined();
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ title: 'New' });
    expect(screen.getByTestId('page-title')).toHaveTextContent('New');
  });

  it('inline rename: Escape cancels without calling the title PATCH', async () => {
    const user = userEvent.setup();
    render(
      <PageView
        page={makePage({ id: 'p4', title: 'Original' })}
        onPageChanged={() => {}}
      />
    );
    const title = screen.getByTestId('page-title');
    await user.click(title);
    const input = screen.getByTestId('page-title-input');
    await user.clear(input);
    await user.type(input, 'Modified{Escape}');
    await new Promise((r) => setTimeout(r, 20));
    expect(patchCall(fetchMock)).toBeUndefined();
    expect(screen.getByTestId('page-title')).toHaveTextContent('Original');
  });

  it('inline rename: empty input does not call the title PATCH', async () => {
    const user = userEvent.setup();
    render(
      <PageView
        page={makePage({ id: 'p5', title: 'Has Title' })}
        onPageChanged={() => {}}
      />
    );
    const title = screen.getByTestId('page-title');
    await user.click(title);
    const input = screen.getByTestId('page-title-input');
    await user.clear(input);
    await user.keyboard('{Enter}');
    await new Promise((r) => setTimeout(r, 20));
    expect(patchCall(fetchMock)).toBeUndefined();
  });

  it('inline rename: whitespace-only input does not call the title PATCH', async () => {
    const user = userEvent.setup();
    render(
      <PageView
        page={makePage({ id: 'p6', title: 'Has Title' })}
        onPageChanged={() => {}}
      />
    );
    const title = screen.getByTestId('page-title');
    await user.click(title);
    const input = screen.getByTestId('page-title-input');
    await user.clear(input);
    await user.type(input, '   ');
    await user.keyboard('{Enter}');
    await new Promise((r) => setTimeout(r, 20));
    expect(patchCall(fetchMock)).toBeUndefined();
  });

  it('starts editing on Enter while focused on the title', async () => {
    const user = userEvent.setup();
    render(
      <PageView
        page={makePage({ id: 'p7', title: 'Editable' })}
        onPageChanged={() => {}}
      />
    );
    const title = screen.getByTestId('page-title');
    title.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('page-title-input')).toBeInTheDocument();
  });

  it('renders the default glyph (first letter) when icon is null', () => {
    render(
      <PageView
        page={makePage({ title: 'Alpha', icon: null })}
        onPageChanged={() => {}}
      />
    );
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});
