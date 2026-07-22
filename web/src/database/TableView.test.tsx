import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TableView } from './TableView';
import type { DatabaseResponse, Property, PropertyType } from '../lib/api';

// One property per type, so the showcase view covers all seven. Tests
// can pick which to exercise.
function makeProperty(
  id: string,
  type: PropertyType,
  name: string,
  position: number,
  options: Property['options'] = null
): Property {
  return { id, databaseId: 'db1', name, type, options, position };
}

function makeDatabase(overrides: Partial<DatabaseResponse> = {}): DatabaseResponse {
  const properties: Property[] = [
    makeProperty('pText', 'text', 'Notes', 0),
    makeProperty('pNum', 'number', 'Rating', 1),
    makeProperty('pSel', 'select', 'Status', 2, [
      { id: 'opt-reading', label: 'Reading', color: '#209dd7' },
      { id: 'opt-done', label: 'Done', color: '#4a7a1f' },
    ]),
    makeProperty('pMulti', 'multi_select', 'Tags', 3, [
      { id: 'opt-fiction', label: 'Fiction', color: '#753991' },
      { id: 'opt-nonfic', label: 'Non-fiction', color: '#ecad0a' },
    ]),
    makeProperty('pDate', 'date', 'Started', 4),
    makeProperty('pCheck', 'checkbox', 'Owned', 5),
    makeProperty('pUrl', 'url', 'Link', 6),
  ];
  return {
    page: { id: 'db1', parentId: null, title: 'Reading List', icon: null, kind: 'database', position: 0 },
    properties,
    rows: [
      {
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
      },
      {
        id: 'row2',
        parentId: 'db1',
        title: 'The Three-Body Problem',
        icon: null,
        kind: 'row',
        position: 1,
        values: {
          pText: 'Mind-bending',
          pNum: 4,
          pSel: 'opt-done',
          pMulti: ['opt-fiction', 'opt-nonfic'],
          pDate: '2026-01-15',
          pCheck: false,
          pUrl: 'https://example.com/3bp',
        },
      },
    ],
    views: {},
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface MockState {
  database: DatabaseResponse;
  // The body the most recent create-property call sent.
  lastCreateProperty?: { name: string; type: PropertyType };
  // The body the most recent update-property call sent.
  lastUpdateProperty?: { name?: string; options?: unknown };
  // The body of the most recent row value PATCH.
  lastRowPatch?: { title?: string; values?: Record<string, unknown> };
  // The id of the most recent deleted property / row.
  lastDeleteProperty?: string;
  lastDeleteRow?: string;
  // Bodies of all PATCHes by id.
  patches: { url: string; body: unknown }[];
  // Track when a row is created (we need to return a fresh row).
  nextRowId: number;
}

function setupMock(state: MockState): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && /\/api\/databases\/[^/]+$/.test(url)) {
      return jsonResponse(state.database);
    }
    if (method === 'POST' && /\/api\/databases\/[^/]+\/properties$/.test(url)) {
      const body = JSON.parse((init?.body as string) ?? '{}');
      state.lastCreateProperty = body;
      const newProp: Property = {
        id: `pNew-${Date.now()}-${Math.random()}`,
        databaseId: 'db1',
        name: body.name,
        type: body.type,
        options: body.options ?? null,
        position: state.database.properties.length,
      };
      state.database = { ...state.database, properties: [...state.database.properties, newProp] };
      return jsonResponse(newProp, 201);
    }
    if (method === 'PATCH' && /\/api\/properties\/[^/]+$/.test(url)) {
      const id = url.split('/').pop() ?? '';
      const body = JSON.parse((init?.body as string) ?? '{}');
      state.lastUpdateProperty = body;
      state.patches.push({ url, body });
      const existing = state.database.properties.find((p) => p.id === id);
      if (!existing) return jsonResponse({ error: 'not found' }, 404);
      const next: Property = {
        ...existing,
        name: body.name ?? existing.name,
        options: body.options !== undefined ? body.options : existing.options,
      };
      state.database = {
        ...state.database,
        properties: state.database.properties.map((p) => (p.id === id ? next : p)),
      };
      return jsonResponse(next);
    }
    if (method === 'DELETE' && /\/api\/properties\/[^/]+$/.test(url)) {
      const id = url.split('/').pop() ?? '';
      state.lastDeleteProperty = id;
      state.patches.push({ url, body: null });
      // Strip the value key from each row.
      const rows = state.database.rows.map((row) => {
        if (!row.values || !(id in row.values)) return row;
        const { [id]: _removed, ...rest } = row.values;
        return { ...row, values: rest };
      });
      state.database = {
        ...state.database,
        properties: state.database.properties.filter((p) => p.id !== id),
        rows,
      };
      return jsonResponse({ deleted: 1 });
    }
    if (method === 'POST' && /\/api\/databases\/[^/]+\/rows$/.test(url)) {
      const id = `row-new-${++state.nextRowId}`;
      const created = {
        id,
        parentId: 'db1',
        title: 'Untitled',
        icon: null,
        kind: 'row' as const,
        position: state.database.rows.length,
        values: {},
      };
      state.database = { ...state.database, rows: [...state.database.rows, created] };
      return jsonResponse(created, 201);
    }
    if (method === 'PATCH' && /\/api\/rows\/[^/]+$/.test(url)) {
      const id = url.split('/').pop() ?? '';
      const body = JSON.parse((init?.body as string) ?? '{}');
      state.lastRowPatch = body;
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
    if (method === 'DELETE' && /\/api\/rows\/[^/]+$/.test(url)) {
      const id = url.split('/').pop() ?? '';
      state.lastDeleteRow = id;
      state.patches.push({ url, body: null });
      state.database = {
        ...state.database,
        rows: state.database.rows.filter((r) => r.id !== id),
      };
      return jsonResponse({ deleted: 1 });
    }
    return jsonResponse({ error: 'unexpected ' + method + ' ' + url }, 500);
  });
  return fetchMock;
}

function getRowPatches(state: MockState) {
  return state.patches
    .filter((p) => /\/api\/rows\//.test(p.url))
    .map((p) => p.body);
}

function getPropertyPatches(state: MockState) {
  return state.patches
    .filter((p) => /\/api\/properties\//.test(p.url))
    .map((p) => p.body);
}

describe('TableView', () => {
  let state: MockState;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state = { database: makeDatabase(), patches: [], nextRowId: 0 };
    fetchMock = setupMock(state);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderTable() {
    return render(
      <MemoryRouter>
        <TableViewHarness state={state} />
      </MemoryRouter>
    );
  }

  it('renders the title column, one column per property, and every row', async () => {
    renderTable();
    await screen.findByTestId('db-table');
    expect(screen.getByText('Title')).toBeInTheDocument();
    for (const property of state.database.properties) {
      expect(screen.getByTestId(`db-th-${property.id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('db-row-row1')).toBeInTheDocument();
    expect(screen.getByTestId('db-row-row2')).toBeInTheDocument();
    expect(screen.getByText('Project Hail Mary')).toBeInTheDocument();
  });

  it('pads the Title header like the other headers (db-th-inner wrapper)', async () => {
    renderTable();
    await screen.findByTestId('db-table');
    const titleHeader = screen.getByText('Title').closest('th');
    expect(titleHeader).not.toBeNull();
    // Regression: the bare text child rendered flush against the table edge
    // because only .db-th-inner carries the header padding.
    expect(titleHeader?.querySelector('.db-th-inner')).not.toBeNull();
  });

  it('renders a URL cell as a link with target=_blank and rel attrs', async () => {
    renderTable();
    const link = await screen.findByTestId('cell-url-row1-pUrl');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link).toHaveTextContent('https://example.com/hail-mary');
  });

  it('renders number / date / text cell values', async () => {
    renderTable();
    expect(await screen.findByTestId('cell-number-row1-pNum')).toHaveTextContent('5');
    expect(screen.getByTestId('cell-date-row1-pDate')).toHaveTextContent('2026-04-01');
    expect(screen.getByTestId('cell-text-row1-pText')).toHaveTextContent('Ridiculously fun.');
  });

  it('renders select and multi-select cells as chips', async () => {
    renderTable();
    const select = await screen.findByTestId('cell-select-row1-pSel');
    expect(select).toHaveTextContent('Reading');
    const multi = screen.getByTestId('cell-multi-row2-pMulti');
    expect(multi).toHaveTextContent('Fiction');
    expect(multi).toHaveTextContent('Non-fiction');
  });

  it('renders the checkbox cell as a check mark when checked, empty otherwise', async () => {
    renderTable();
    const on = await screen.findByTestId('cell-checkbox-row1-pCheck');
    expect(on.getAttribute('data-checked')).toBe('true');
    const off = screen.getByTestId('cell-checkbox-row2-pCheck');
    expect(off.getAttribute('data-checked')).toBe('false');
  });

  it('text cell editor: Enter commits a string value', async () => {
    const user = userEvent.setup();
    renderTable();
    const cell = await screen.findByTestId('cell-text-row1-pText');
    await user.click(cell);
    const input = screen.getByTestId('cell-input-pText');
    await user.clear(input);
    await user.type(input, 'A new note');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      const patch = state.lastRowPatch;
      expect(patch).toBeDefined();
      expect(patch?.values?.pText).toBe('A new note');
    });
  });

  it('text cell editor: Escape cancels without PATCHing', async () => {
    const user = userEvent.setup();
    renderTable();
    const before = getRowPatches(state).length;
    const cell = await screen.findByTestId('cell-text-row1-pText');
    await user.click(cell);
    const input = screen.getByTestId('cell-input-pText');
    await user.clear(input);
    await user.type(input, 'Discard me');
    await user.keyboard('{Escape}');
    await new Promise((r) => setTimeout(r, 20));
    expect(getRowPatches(state).length).toBe(before);
  });

  it('url cell renders an <a> link with the right href when not editing', async () => {
    renderTable();
    const link = await screen.findByTestId('cell-url-row1-pUrl');
    expect(link.getAttribute('href')).toBe('https://example.com/hail-mary');
  });

  it('number cell: empty input commits null', async () => {
    const user = userEvent.setup();
    renderTable();
    const cell = await screen.findByTestId('cell-number-row1-pNum');
    await user.click(cell);
    const input = screen.getByTestId('cell-input-pNum');
    await user.clear(input);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(state.lastRowPatch?.values?.pNum).toBeNull();
    });
  });

  it('number cell: a valid number PATCHes that number', async () => {
    const user = userEvent.setup();
    renderTable();
    const cell = await screen.findByTestId('cell-number-row1-pNum');
    await user.click(cell);
    const input = screen.getByTestId('cell-input-pNum');
    await user.clear(input);
    await user.type(input, '7');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(state.lastRowPatch?.values?.pNum).toBe(7);
    });
  });

  it('number cell: junk input is reverted (no PATCH, old value displayed)', async () => {
    // DEF-002: typing non-numeric text into a number cell must not PATCH
    // null. The cell editor uses type="text" with inputMode="decimal" so
    // junk survives in the input's value; the commit handler detects the
    // non-finite result, reverts, and sends no PATCH.
    const user = userEvent.setup();
    renderTable();
    const before = getRowPatches(state).length;
    const cell = await screen.findByTestId('cell-number-row1-pNum');
    await user.click(cell);
    const input = screen.getByTestId('cell-input-pNum') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'not-a-number' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Let the commit handler run.
    await new Promise((r) => setTimeout(r, 20));
    // No PATCH should have been sent.
    expect(getRowPatches(state).length).toBe(before);
    // The editor closes and the cell re-displays the old value (5).
    expect(screen.getByTestId('cell-number-row1-pNum')).toHaveTextContent('5');
  });

  it('date cell: picker change PATCHes the new date', async () => {
    renderTable();
    const cell = await screen.findByTestId('cell-date-row1-pDate');
    await userEvent.click(cell);
    const input = screen.getByTestId('cell-input-pDate') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-05-20' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(state.lastRowPatch?.values?.pDate).toBe('2026-05-20');
    });
  });

  it('date cell: clearing commits null', async () => {
    renderTable();
    const cell = await screen.findByTestId('cell-date-row1-pDate');
    await userEvent.click(cell);
    const input = screen.getByTestId('cell-input-pDate') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(state.lastRowPatch?.values?.pDate).toBeNull();
    });
  });

  it('checkbox cell: clicking toggles immediately and PATCHes a boolean', async () => {
    const user = userEvent.setup();
    renderTable();
    const toggle = await screen.findByTestId('cell-checkbox-toggle-row1-pCheck');
    // Capture the sequence of row PATCHes that include the checkbox
    // value. The first click should PATCH false (the row starts true),
    // the second click should PATCH true.
    const valuePatches = (): boolean[] =>
      state.patches
        .filter((p) => /\/api\/rows\//.test(p.url))
        .map((p) => (p.body as { values?: Record<string, unknown> }).values?.pCheck)
        .filter((v): v is boolean => typeof v === 'boolean');
    await user.click(toggle);
    await waitFor(() => {
      expect(valuePatches()).toContain(false);
    });
    await user.click(toggle);
    await waitFor(() => {
      expect(valuePatches()).toContain(true);
    });
  });

  it('select cell: opening the popover lists every option with the right colors', async () => {
    const user = userEvent.setup();
    renderTable();
    const trigger = await screen.findByTestId('cell-button-row1-pSel');
    await user.click(trigger);
    const popover = await screen.findByTestId('select-popover-row1-pSel');
    expect(within(popover).getByTestId('select-option-opt-reading')).toBeInTheDocument();
    expect(within(popover).getByTestId('select-option-opt-done')).toBeInTheDocument();
    // The chip uses the option color via a CSS variable.
    const reading = within(popover).getByTestId('select-option-opt-reading');
    const chip = within(reading).getByText('Reading').closest('.option-chip') as HTMLElement;
    expect(chip.style.getPropertyValue('--option-color')).toBe('#209dd7');
  });

  it('select cell: clicking an option PATCHes that option id', async () => {
    const user = userEvent.setup();
    renderTable();
    const trigger = await screen.findByTestId('cell-button-row1-pSel');
    await user.click(trigger);
    const opt = await screen.findByTestId('select-option-opt-done');
    await user.click(opt);
    await waitFor(() => {
      expect(state.lastRowPatch?.values?.pSel).toBe('opt-done');
    });
  });

  it('select cell: clear button nulls the value', async () => {
    const user = userEvent.setup();
    renderTable();
    const trigger = await screen.findByTestId('cell-button-row1-pSel');
    await user.click(trigger);
    const clear = await screen.findByTestId('select-clear-pSel');
    await user.click(clear);
    await waitFor(() => {
      expect(state.lastRowPatch?.values?.pSel).toBeNull();
    });
  });

  it('select cell: create-option flow PATCHes property options then row value', async () => {
    const user = userEvent.setup();
    renderTable();
    const trigger = await screen.findByTestId('cell-button-row1-pSel');
    await user.click(trigger);
    const toggle = await screen.findByTestId('select-create-toggle-pSel');
    await user.click(toggle);
    const input = await screen.findByTestId('select-create-input-pSel');
    await user.clear(input);
    await user.type(input, 'Wishlist');
    const submit = screen.getByTestId('select-create-submit-pSel');
    await user.click(submit);
    // Property PATCH first (with the new option), then row PATCH with that id.
    await waitFor(() => {
      const propPatches = getPropertyPatches(state);
      const last = propPatches[propPatches.length - 1] as { options?: { id: string; label: string; color: string }[] };
      expect(last?.options).toBeDefined();
      const created = last?.options?.find((o) => o.label === 'Wishlist');
      expect(created).toBeDefined();
      expect(state.lastRowPatch?.values?.pSel).toBe(created?.id);
    });
  });

  it('select cell: case-insensitive duplicate label selects the existing option (no PATCH to property)', async () => {
    // DEF-003: when the user enters a label that case-insensitively
    // matches an existing option, the editor must NOT create a
    // duplicate option. It should select/toggle the existing option
    // and send no PATCH to /api/properties/:id.
    const user = userEvent.setup();
    renderTable();
    const propPatchBefore = getPropertyPatches(state).length;
    const trigger = await screen.findByTestId('cell-button-row1-pSel');
    await user.click(trigger);
    await user.click(screen.getByTestId('select-create-toggle-pSel'));
    const input = await screen.findByTestId('select-create-input-pSel');
    // The seeded property has options 'Reading' (opt-reading) and 'Done' (opt-done).
    // Type the existing label 'Reading' with different casing.
    await user.clear(input);
    await user.type(input, 'reading');
    await user.click(screen.getByTestId('select-create-submit-pSel'));
    // The row should be PATCHed with the existing option id, not a new one.
    await waitFor(() => {
      expect(state.lastRowPatch?.values?.pSel).toBe('opt-reading');
    });
    // No property PATCH should have been issued.
    await new Promise((r) => setTimeout(r, 20));
    expect(getPropertyPatches(state).length).toBe(propPatchBefore);
  });

  it('select cell: a created option appears for other rows of the same database (shared state)', async () => {
    const user = userEvent.setup();
    renderTable();
    // Open the popover on row1 and create an option.
    const trigger = await screen.findByTestId('cell-button-row1-pSel');
    await user.click(trigger);
    await user.click(screen.getByTestId('select-create-toggle-pSel'));
    const input = await screen.findByTestId('select-create-input-pSel');
    await user.type(input, 'Borrowed');
    await user.click(screen.getByTestId('select-create-submit-pSel'));
    // Close the popover so we can open it on the other row.
    await waitFor(() => {
      expect(state.lastRowPatch?.values?.pSel).toBeDefined();
    });
    // The new option should be visible in the row2 popover after the
    // table re-fetches with the updated property.
    const trigger2 = await screen.findByTestId('cell-button-row2-pSel');
    await user.click(trigger2);
    const popover2 = await screen.findByTestId('select-popover-row2-pSel');
    expect(within(popover2).getByText('Borrowed')).toBeInTheDocument();
  });

  it('multi-select cell: clicking an option toggles it in the row values', async () => {
    const user = userEvent.setup();
    renderTable();
    const trigger = await screen.findByTestId('cell-button-row1-pMulti');
    await user.click(trigger);
    // Row1 starts with ['opt-fiction']; clicking nonfic should add it.
    const nonfic = await screen.findByTestId('select-option-opt-nonfic');
    await user.click(nonfic);
    await waitFor(() => {
      const v = state.lastRowPatch?.values?.pMulti as string[] | undefined;
      expect(v).toContain('opt-fiction');
      expect(v).toContain('opt-nonfic');
    });
  });

  it('multi-select cell: clicking an already-selected option removes it', async () => {
    const user = userEvent.setup();
    renderTable();
    const trigger = await screen.findByTestId('cell-button-row1-pMulti');
    await user.click(trigger);
    const fiction = await screen.findByTestId('select-option-opt-fiction');
    await user.click(fiction);
    await waitFor(() => {
      const v = state.lastRowPatch?.values?.pMulti as string[] | undefined;
      expect(v).not.toContain('opt-fiction');
    });
  });

  it('new-property creator: opens, lets the user choose a type, then POSTs', async () => {
    const user = userEvent.setup();
    renderTable();
    const opener = await screen.findByTestId('db-new-property-button');
    await user.click(opener);
    const nameInput = await screen.findByTestId('db-new-property-name');
    await user.type(nameInput, 'Author');
    await user.click(screen.getByTestId('db-new-property-type-select'));
    const create = screen.getByTestId('db-new-property-create');
    await user.click(create);
    await waitFor(() => {
      expect(state.lastCreateProperty).toEqual({
        name: 'Author',
        type: 'select',
        options: [],
      });
    });
  });

  it('new-property creator: Escape closes the creator without POSTing', async () => {
    const user = userEvent.setup();
    renderTable();
    const before = state.patches.length;
    const opener = await screen.findByTestId('db-new-property-button');
    await user.click(opener);
    const nameInput = await screen.findByTestId('db-new-property-name');
    await user.type(nameInput, 'Ignored');
    await user.keyboard('{Escape}');
    await new Promise((r) => setTimeout(r, 20));
    expect(state.patches.length).toBe(before);
  });

  it('property header menu: rename PATCHes the property with the new name', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByTestId('db-th-menu-pText'));
    await user.click(screen.getByTestId('db-th-rename-pText'));
    const input = screen.getByTestId('db-th-rename-input-pText');
    await user.clear(input);
    await user.type(input, 'My Notes');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      const patches = getPropertyPatches(state);
      const last = patches[patches.length - 1] as { name?: string };
      expect(last?.name).toBe('My Notes');
    });
  });

  it('property header menu: delete asks for confirmation and the API is called on confirm', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByTestId('db-th-menu-pText'));
    await user.click(screen.getByTestId('db-th-delete-pText'));
    // Confirmation modal names the property and mentions every row's value.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/Notes/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Every row loses its value/i)).toBeInTheDocument();
    // Confirm.
    const confirm = within(dialog).getByTestId('confirm-delete');
    await user.click(confirm);
    await waitFor(() => {
      expect(state.lastDeleteProperty).toBe('pText');
    });
  });

  it('property delete confirmation cancel does not delete', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByTestId('db-th-menu-pText'));
    await user.click(screen.getByTestId('db-th-delete-pText'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByTestId('confirm-cancel'));
    await new Promise((r) => setTimeout(r, 20));
    expect(state.lastDeleteProperty).toBeUndefined();
  });

  it('add row: the + New row button POSTs a row and the table is updated', async () => {
    const user = userEvent.setup();
    renderTable();
    const addButton = await screen.findByTestId('db-add-row');
    await user.click(addButton);
    // The mock creates the row in state.database so the next render shows it.
    await waitFor(() => {
      expect(state.database.rows.length).toBe(3);
    });
  });

  it('row delete: the trash button opens a confirmation; confirm DELETEs', async () => {
    const user = userEvent.setup();
    renderTable();
    const trash = await screen.findByTestId('db-row-delete-row1');
    await user.click(trash);
    const dialog = await screen.findByRole('dialog');
    // The row name appears in the title and again in the message.
    expect(within(dialog).getAllByText(/Project Hail Mary/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    await user.click(within(dialog).getByTestId('confirm-delete'));
    await waitFor(() => {
      expect(state.lastDeleteRow).toBe('row1');
    });
  });

  it('row delete: cancel does not delete', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByTestId('db-row-delete-row1'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByTestId('confirm-cancel'));
    await new Promise((r) => setTimeout(r, 20));
    expect(state.lastDeleteRow).toBeUndefined();
  });

  it('row title is a link to the row page', async () => {
    renderTable();
    const link = await screen.findByTestId('db-row-title-row1');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/page/row1');
  });

  it('the table renders a + New property cell at the end of the header', async () => {
    renderTable();
    expect(await screen.findByTestId('db-new-property-button')).toBeInTheDocument();
  });
});

/**
 * Test harness. Mirrors what DatabaseView does in production: holds the
 * database in local state and re-syncs from the shared mock state every
 * time a mutation completes, so click-toggles see the new value.
 */
function TableViewHarness({ state }: { state: MockState }) {
  const [data, setData] = useState<DatabaseResponse>(state.database);
  return (
    <TableView
      database={data}
      onMutated={() => setData({ ...state.database })}
    />
  );
}
