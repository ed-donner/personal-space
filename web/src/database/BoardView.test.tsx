import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BoardView } from './BoardView';
import type { DatabaseResponse, Property, RowPage } from '../lib/api';

// Capture the onDragEnd handler and stub the dnd-kit primitives so the drop
// logic can be driven directly in jsdom (no real pointer events needed).
let dragEndHandler: ((event: { active: { id: string }; over: { id: string } | null }) => void) | null =
  null;

vi.mock('@dnd-kit/core', () => ({
  DndContext: (props: { children: React.ReactNode; onDragEnd?: typeof dragEndHandler }) => {
    dragEndHandler = props.onDragEnd ?? null;
    return <>{props.children}</>;
  },
  DragOverlay: () => null,
  KeyboardSensor: {},
  PointerSensor: {},
  closestCenter: () => null,
  useSensor: (sensor: unknown) => sensor,
  useSensors: (...sensors: unknown[]) => sensors,
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: () => undefined, isOver: false }),
}));

const updateRowMock = vi.fn();

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      updateRow: (...args: unknown[]) => updateRowMock(...args),
    },
  };
});

function makeDatabase(): DatabaseResponse {
  const properties: Property[] = [
    {
      id: 'pSel',
      databaseId: 'db1',
      name: 'Status',
      type: 'select',
      options: [
        { id: 'opt-reading', label: 'Reading', color: '#209dd7' },
        { id: 'opt-done', label: 'Done', color: '#4a7a1f' },
      ],
      position: 0,
    },
  ];
  const rows: RowPage[] = [
    {
      id: 'r1',
      parentId: 'db1',
      title: 'Dune',
      icon: null,
      kind: 'row',
      position: 0,
      values: { pSel: 'opt-reading' },
    },
    {
      id: 'r2',
      parentId: 'db1',
      title: 'Educated',
      icon: null,
      kind: 'row',
      position: 1,
      values: { pSel: 'opt-done' },
    },
  ];
  return {
    page: { id: 'db1', parentId: null, title: 'Reading List', icon: null, kind: 'database', position: 0 },
    properties,
    rows,
    views: {
      table: { filters: [], sort: null, groupBy: null },
      board: { filters: [], sort: null, groupBy: 'pSel' },
      list: { filters: [], sort: null, groupBy: null },
    },
  };
}

function renderBoard(database: DatabaseResponse, onMutated: () => void) {
  return render(
    <MemoryRouter>
      <BoardView database={database} onMutated={onMutated} />
    </MemoryRouter>
  );
}

function cardColumn(title: string): string | null {
  const card = screen.getByTestId(`board-card-title-${title === 'Dune' ? 'r1' : 'r2'}`);
  const column = card.closest('[data-testid^="board-column-"]');
  return column?.getAttribute('data-testid') ?? null;
}

describe('BoardView optimistic card moves', () => {
  beforeEach(() => {
    dragEndHandler = null;
    updateRowMock.mockReset();
  });

  it('groups the card into the target column immediately on drop (before the API resolves)', async () => {
    let resolveUpdate: ((value: unknown) => void) | null = null;
    updateRowMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        })
    );
    const onMutated = vi.fn();
    renderBoard(makeDatabase(), onMutated);

    expect(cardColumn('Dune')).toBe('board-column-opt-reading');
    expect(dragEndHandler).not.toBeNull();

    act(() => {
      dragEndHandler!({ active: { id: 'r1' }, over: { id: 'opt-done' } });
    });

    // Optimistic grouping: the card is in the target column NOW, while the
    // API call is still pending — the drop animation settles here, not back
    // on the source column.
    expect(cardColumn('Dune')).toBe('board-column-opt-done');
    expect(updateRowMock).toHaveBeenCalledWith('r1', { values: { pSel: 'opt-done' } });
    expect(onMutated).not.toHaveBeenCalled();

    await act(async () => {
      resolveUpdate!({});
    });
    expect(onMutated).toHaveBeenCalled();
  });

  it('snaps the card back when the save fails', async () => {
    updateRowMock.mockRejectedValue(new Error('network down'));
    const onMutated = vi.fn();
    renderBoard(makeDatabase(), onMutated);

    act(() => {
      dragEndHandler!({ active: { id: 'r1' }, over: { id: 'opt-done' } });
    });
    expect(cardColumn('Dune')).toBe('board-column-opt-done');

    await waitFor(() => {
      expect(cardColumn('Dune')).toBe('board-column-opt-reading');
    });
    expect(onMutated).toHaveBeenCalled();
  });

  it('keeps the card in place when the server state catches up (pending move pruned)', async () => {
    updateRowMock.mockResolvedValue({});
    const onMutated = vi.fn();
    const database = makeDatabase();
    const { rerender } = render(
      <MemoryRouter>
        <BoardView database={database} onMutated={onMutated} />
      </MemoryRouter>
    );

    act(() => {
      dragEndHandler!({ active: { id: 'r1' }, over: { id: 'opt-done' } });
    });
    expect(cardColumn('Dune')).toBe('board-column-opt-done');

    // Parent refetches with the move persisted; the pending entry prunes and
    // the card stays put.
    const updated = makeDatabase();
    updated.rows[0] = { ...updated.rows[0], values: { pSel: 'opt-done' } };
    await act(async () => {
      rerender(
        <MemoryRouter>
          <BoardView database={updated} onMutated={onMutated} />
        </MemoryRouter>
      );
    });
    expect(cardColumn('Dune')).toBe('board-column-opt-done');
  });

  it('does nothing when the card is dropped on its own column', () => {
    renderBoard(makeDatabase(), vi.fn());
    act(() => {
      dragEndHandler!({ active: { id: 'r1' }, over: { id: 'opt-reading' } });
    });
    expect(updateRowMock).not.toHaveBeenCalled();
    expect(cardColumn('Dune')).toBe('board-column-opt-reading');
  });
});
