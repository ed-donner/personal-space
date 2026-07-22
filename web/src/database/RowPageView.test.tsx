import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RowPageView } from './RowPageView';
import type { DatabaseResponse, Property, PropertyType, RowPage } from '../lib/api';

function makeProperty(
  id: string,
  type: PropertyType,
  name: string,
  position: number,
  options: Property['options'] = null
): Property {
  return { id, databaseId: 'db1', name, type, options, position };
}

function makeRow(overrides: Partial<RowPage> = {}): RowPage {
  return {
    id: 'row1',
    parentId: 'db1',
    title: 'Project Hail Mary',
    icon: null,
    kind: 'row',
    position: 0,
    values: {
      pText: 'Ridiculously fun.',
      pNum: 5,
      pSel: 'opt-reading',
      pMulti: ['opt-fiction'],
      pDate: '2026-04-01',
      pCheck: true,
      pUrl: 'https://example.com/hail-mary',
    },
    ...overrides,
  };
}

function makeDatabase(overrides: Partial<DatabaseResponse> = {}): DatabaseResponse {
  return {
    page: { id: 'db1', parentId: null, title: 'Reading List', icon: null, kind: 'database', position: 0 },
    properties: [
      makeProperty('pText', 'text', 'Notes', 0),
      makeProperty('pNum', 'number', 'Rating', 1),
      makeProperty('pSel', 'select', 'Status', 2, [
        { id: 'opt-reading', label: 'Reading', color: '#209dd7' },
        { id: 'opt-done', label: 'Done', color: '#4a7a1f' },
      ]),
      makeProperty('pMulti', 'multi_select', 'Tags', 3, [
        { id: 'opt-fiction', label: 'Fiction', color: '#753991' },
      ]),
      makeProperty('pDate', 'date', 'Started', 4),
      makeProperty('pCheck', 'checkbox', 'Owned', 5),
      makeProperty('pUrl', 'url', 'Link', 6),
    ],
    rows: [makeRow()],
    views: {},
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface MockState {
  database: DatabaseResponse;
  patches: { url: string; body: unknown }[];
}

function setupMock(state: MockState): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && /\/api\/databases\/[^/]+$/.test(url)) {
      return jsonResponse(state.database);
    }
    if (method === 'GET' && /\/api\/pages\/[^/]+\/blocks$/.test(url)) {
      return jsonResponse({ blocks: [] });
    }
    if (method === 'PATCH' && /\/api\/properties\/[^/]+$/.test(url)) {
      const id = url.split('/').pop() ?? '';
      const body = JSON.parse((init?.body as string) ?? '{}');
      state.patches.push({ url, body });
      const existing = state.database.properties.find((p) => p.id === id);
      if (!existing) return jsonResponse({ error: 'not found' }, 404);
      const next: Property = {
        ...existing,
        options: body.options !== undefined ? body.options : existing.options,
      };
      state.database = {
        ...state.database,
        properties: state.database.properties.map((p) => (p.id === id ? next : p)),
      };
      return jsonResponse(next);
    }
    if (method === 'PATCH' && /\/api\/rows\/[^/]+$/.test(url)) {
      const id = url.split('/').pop() ?? '';
      const body = JSON.parse((init?.body as string) ?? '{}');
      state.patches.push({ url, body });
      const row = state.database.rows.find((r) => r.id === id);
      if (!row) return jsonResponse({ error: 'not found' }, 404);
      const nextValues = body.values ? { ...(row.values ?? {}), ...body.values } : row.values ?? {};
      const next = { ...row, title: body.title ?? row.title, values: nextValues };
      state.database = {
        ...state.database,
        rows: state.database.rows.map((r) => (r.id === id ? next : r)),
      };
      return jsonResponse(next);
    }
    return jsonResponse({ error: 'unexpected ' + method + ' ' + url }, 500);
  });
  return fetchMock;
}

function rowPatches(state: MockState) {
  return state.patches.filter((p) => /\/api\/rows\//.test(p.url)).map((p) => p.body);
}

describe('RowPageView', () => {
  let state: MockState;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state = { database: makeDatabase(), patches: [] };
    fetchMock = setupMock(state);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderRow() {
    return render(
      <MemoryRouter>
        <RowPageHarness state={state} />
      </MemoryRouter>
    );
  }

  it('renders the row title with a "Row" kind cue and a database crumb', async () => {
    renderRow();
    expect(await screen.findByTestId('row-page-kind')).toHaveTextContent('Row');
    expect(screen.getByTestId('row-title')).toHaveTextContent('Project Hail Mary');
    const crumb = screen.getByTestId('row-page-crumb');
    expect(crumb).toHaveTextContent('In');
    expect(crumb).toHaveTextContent('Reading List');
    const link = within(crumb).getByRole('link');
    expect(link.getAttribute('href')).toBe('/page/db1');
  });

  it('renders a property row for every property, with the type label', async () => {
    renderRow();
    for (const property of state.database.properties) {
      expect(await screen.findByTestId(`row-prop-${property.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`row-prop-label-${property.id}`)).toHaveTextContent(property.name);
    }
  });

  it('row title is editable: Enter PATCHes the new title', async () => {
    const user = userEvent.setup();
    renderRow();
    const title = await screen.findByTestId('row-title');
    await user.click(title);
    const input = screen.getByTestId('row-title-input');
    await user.clear(input);
    await user.type(input, 'New Title{Enter}');
    await waitFor(() => {
      const last = rowPatches(state).pop() as { title?: string } | undefined;
      expect(last?.title).toBe('New Title');
    });
  });

  it('row title edit: Escape cancels without PATCHing', async () => {
    const user = userEvent.setup();
    renderRow();
    const before = rowPatches(state).length;
    const title = screen.getByTestId('row-title');
    await user.click(title);
    const input = screen.getByTestId('row-title-input');
    await user.clear(input);
    await user.type(input, 'Discard{Escape}');
    await new Promise((r) => setTimeout(r, 20));
    expect(rowPatches(state).length).toBe(before);
    expect(screen.getByTestId('row-title')).toHaveTextContent('Project Hail Mary');
  });

  it('row title edit: whitespace-only is not PATCHed', async () => {
    const user = userEvent.setup();
    renderRow();
    const before = rowPatches(state).length;
    const title = screen.getByTestId('row-title');
    await user.click(title);
    const input = screen.getByTestId('row-title-input');
    await user.clear(input);
    await user.type(input, '   {Enter}');
    await new Promise((r) => setTimeout(r, 20));
    expect(rowPatches(state).length).toBe(before);
  });

  it('text property: clicking the cell opens the same inline editor as the table', async () => {
    const user = userEvent.setup();
    renderRow();
    const cell = await screen.findByTestId('cell-text-row1-pText');
    await user.click(cell);
    const input = screen.getByTestId('cell-input-pText');
    expect(input).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'Brand new');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      const last = rowPatches(state).pop() as { values?: Record<string, unknown> } | undefined;
      expect(last?.values?.pText).toBe('Brand new');
    });
  });

  it('number property: commits a number', async () => {
    const user = userEvent.setup();
    renderRow();
    const cell = await screen.findByTestId('cell-number-row1-pNum');
    await user.click(cell);
    const input = screen.getByTestId('cell-input-pNum');
    await user.clear(input);
    await user.type(input, '9');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      const last = rowPatches(state).pop() as { values?: Record<string, unknown> } | undefined;
      expect(last?.values?.pNum).toBe(9);
    });
  });

  it('select property: choosing an option PATCHes the row', async () => {
    const user = userEvent.setup();
    renderRow();
    const cell = await screen.findByTestId('cell-select-row1-pSel');
    await user.click(cell);
    const option = await screen.findByTestId('select-option-opt-done');
    await user.click(option);
    await waitFor(() => {
      const last = rowPatches(state).pop() as { values?: Record<string, unknown> } | undefined;
      expect(last?.values?.pSel).toBe('opt-done');
    });
  });

  it('checkbox property: clicking toggles immediately', async () => {
    const user = userEvent.setup();
    renderRow();
    const toggle = await screen.findByTestId('cell-checkbox-toggle-row1-pCheck');
    await user.click(toggle);
    await waitFor(() => {
      const last = rowPatches(state).pop() as { values?: Record<string, unknown> } | undefined;
      expect(last?.values?.pCheck).toBe(false);
    });
  });

  it('date property: picker change PATCHes the row', async () => {
    renderRow();
    const cell = await screen.findByTestId('cell-date-row1-pDate');
    await userEvent.click(cell);
    const input = screen.getByTestId('cell-input-pDate') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-08-12' } });
    fireEvent.blur(input);
    await waitFor(() => {
      const last = rowPatches(state).pop() as { values?: Record<string, unknown> } | undefined;
      expect(last?.values?.pDate).toBe('2026-08-12');
    });
  });

  it('url property renders a clickable link when not editing', async () => {
    renderRow();
    const link = await screen.findByTestId('cell-url-row1-pUrl');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('href')).toBe('https://example.com/hail-mary');
  });

  it('block editor is rendered under the properties panel', async () => {
    renderRow();
    expect(await screen.findByTestId('row-properties-panel')).toBeInTheDocument();
    // The block editor needs its own async fetch; await it instead of
    // asserting synchronously to remove a pre-existing race.
    expect(await screen.findByTestId('block-editor')).toBeInTheDocument();
  });

  it('shows an empty state when the database has no properties', async () => {
    // Keep a row so the harness can mount, then clear the properties.
    state.database = { ...state.database, properties: [] };
    renderRow();
    expect(await screen.findByTestId('row-properties-panel')).toBeInTheDocument();
    expect(screen.getByText(/no properties yet/i)).toBeInTheDocument();
  });
});

/** Test harness: keeps the row page's local state in sync with the
 *  shared mock state, just like DatabaseView does in production. */
function RowPageHarness({ state }: { state: MockState }) {
  const [row, setRow] = useState<RowPage>(state.database.rows[0]);
  return (
    <RowPageView
      page={row}
      onPageChanged={() => {
        const next = state.database.rows[0];
        if (next) setRow(next);
      }}
    />
  );
}
