// Board view: rows in columns, one column per option of the groupBy
// property (plus a "No value" column). Drag a card to a different
// column to change the row's value. Click a card to open the row page.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { api, type DatabaseResponse, type Property, type RowPage } from '../lib/api';
import { OptionChip } from './CellEditor';
import { applyFilters, applySort, groupRowsByProperty } from './views';

interface BoardViewProps {
  database: DatabaseResponse;
  onMutated: () => void;
}

export function BoardView({ database, onMutated }: BoardViewProps) {
  const navigate = useNavigate();
  const settings = database.views.board ?? {};
  const properties = database.properties;
  const groupById = settings.groupBy ?? null;
  const groupByProperty: Property | null = groupById
    ? properties.find((p) => p.id === groupById) ?? null
    : null;

  const filteredSorted = useMemo(() => {
    const filtered = applyFilters(database.rows, settings.filters, properties);
    return applySort(filtered, settings.sort, properties);
  }, [database.rows, settings.filters, settings.sort, properties]);

  // Optimistic moves: when a card is dropped in another column we group it
  // there IMMEDIATELY (before the API call resolves), so the drag overlay
  // settles on the card's real destination instead of animating back to the
  // column it came from. Entries are pruned once the server value matches;
  // a failed save removes the entry so the card snaps back.
  const [pendingMoves, setPendingMoves] = useState<Record<string, string | null>>({});

  const rowsForBoard = useMemo(() => {
    if (!groupByProperty || Object.keys(pendingMoves).length === 0) return filteredSorted;
    return filteredSorted.map((row) =>
      row.id in pendingMoves
        ? { ...row, values: { ...(row.values ?? {}), [groupByProperty.id]: pendingMoves[row.id] } }
        : row
    );
  }, [filteredSorted, pendingMoves, groupByProperty]);

  useEffect(() => {
    if (!groupByProperty) return;
    setPendingMoves((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      const next = { ...prev };
      let changed = false;
      for (const rowId of ids) {
        const row = database.rows.find((r) => r.id === rowId);
        const actual = row ? ((row.values ?? {})[groupByProperty.id] ?? null) : undefined;
        if (actual === undefined || actual === prev[rowId]) {
          delete next[rowId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [database.rows, groupByProperty]);

  const columns = useMemo(
    () => groupRowsByProperty(rowsForBoard, groupByProperty),
    [rowsForBoard, groupByProperty]
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRow = useMemo(
    () => filteredSorted.find((r) => r.id === activeId) ?? null,
    [filteredSorted, activeId]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const rowId = String(event.active.id);
    const overId = event.over?.id;
    const finish = () => setActiveId(null);
    if (!overId) {
      finish();
      return;
    }
    const colId = String(overId);
    const targetColumn = columns.find((c) => (c.optionId ?? 'none') === colId);
    if (!targetColumn || !groupByProperty) {
      finish();
      return;
    }
    const row = database.rows.find((r) => r.id === rowId);
    if (!row) {
      finish();
      return;
    }
    const propId = groupByProperty.id;
    const current = (row.values ?? {})[propId] ?? null;
    const currentId = typeof current === 'string' || current === null ? current : null;
    const target = targetColumn.optionId;
    if (currentId !== target) {
      // Optimistic: re-group the card into the target column in the same
      // render that drops the overlay, then persist. On failure the pending
      // move is removed and the card snaps back.
      setPendingMoves((moves) => ({ ...moves, [rowId]: target }));
      void (async () => {
        try {
          await api.updateRow(rowId, { values: { [propId]: target } });
          onMutated();
        } catch {
          setPendingMoves((moves) => {
            const next = { ...moves };
            delete next[rowId];
            return next;
          });
          onMutated();
        }
      })();
    }
    finish();
  };

  const selectProperties = properties.filter(
    (p) => p.type === 'select' || p.type === 'multi_select'
  );

  // Empty state: no groupBy chosen OR no select properties at all.
  if (!groupByProperty) {
    return (
      <div
        className="board-empty"
        data-testid="board-empty"
      >
        <div className="board-empty-glyph" aria-hidden="true">G</div>
        <h2 className="board-empty-title">Pick a property to group by</h2>
        <p className="board-empty-hint">
          {selectProperties.length === 0
            ? 'This database has no select properties. Add one in the table view to start a board.'
            : 'Choose a select property from the Group by menu above.'}
        </p>
      </div>
    );
  }

  const addRowAt = async (optionId: string | null) => {
    try {
      const values: Record<string, unknown> = {};
      if (optionId !== null) {
        values[groupByProperty.id] = optionId;
      }
      const created = await api.createRow(database.page.id, {
        title: 'Untitled',
      });
      if (Object.keys(values).length > 0) {
        await api.updateRow(created.id, { values });
      }
      onMutated();
      navigate(`/page/${created.id}`);
    } catch {
      onMutated();
    }
  };

  return (
    <div className="board-host" data-testid="board-view">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="board-scroll">
          <div className="board-columns">
            {columns.map((col) => (
              <BoardColumnView
                key={col.optionId ?? 'none'}
                column={col}
                onCardClick={(row) => navigate(`/page/${row.id}`)}
                onAdd={() => void addRowAt(col.optionId)}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {activeRow ? (
            <BoardCard
              row={activeRow}
              properties={properties}
              isDragging
              onClick={() => undefined}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function BoardColumnView({
  column,
  onCardClick,
  onAdd,
}: {
  column: ReturnType<typeof groupRowsByProperty>[number];
  onCardClick: (row: RowPage) => void;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.optionId ?? 'none',
  });
  const colId = column.optionId ?? 'none';
  return (
    <div
      className={`board-column ${isOver ? 'is-over' : ''}`}
      data-testid={`board-column-${colId}`}
      ref={setNodeRef}
    >
      <div className="board-column-header" data-testid={`board-column-header-${colId}`}>
        {column.optionId == null ? (
          <span className="board-column-dot is-none" aria-hidden="true" />
        ) : (
          <span
            className="board-column-dot"
            style={{ '--option-color': column.color ?? '#8a8f98' } as React.CSSProperties}
            aria-hidden="true"
          />
        )}
        <span className="board-column-label">{column.label}</span>
        <span
          className="board-column-count"
          data-testid={`board-column-count-${colId}`}
        >
          {column.rows.length}
        </span>
      </div>
      <div className="board-column-cards">
        {column.rows.map((row) => (
          <DraggableCard
            key={row.id}
            row={row}
            onClick={() => onCardClick(row)}
          />
        ))}
        <button
          type="button"
          className="board-add-card"
          onClick={onAdd}
          data-testid={`board-add-${colId}`}
        >
          <span aria-hidden="true" className="board-add-card-plus">+</span>
          New row
        </button>
      </div>
    </div>
  );
}

function DraggableCard({
  row,
  onClick,
}: {
  row: RowPage;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: row.id,
  });
  // We use the listening element only as a drag handle. Clicking the card
  // body opens the row.
  return (
    <div
      ref={setNodeRef}
      className={`board-card-host ${isDragging ? 'is-dragging' : ''}`}
      data-testid={`board-card-${row.id}`}
    >
      <BoardCard
        row={row}
        properties={[]}
        onClick={onClick}
        dragHandle={
          <button
            type="button"
            className="board-card-handle"
            aria-label="Drag card"
            {...listeners}
            {...attributes}
            data-testid={`board-card-handle-${row.id}`}
          >
            <span aria-hidden="true">::</span>
          </button>
        }
      />
    </div>
  );
}

interface BoardCardProps {
  row: RowPage;
  properties: Property[];
  isDragging?: boolean;
  onClick: () => void;
  dragHandle?: React.ReactNode;
}

export function BoardCard({
  row,
  properties,
  isDragging = false,
  onClick,
  dragHandle,
}: BoardCardProps) {
  // Pick up to two non-title properties with a meaningful value as chips.
  const chips = useMemo(() => {
    const out: { id: string; node: React.ReactNode }[] = [];
    for (const p of properties) {
      if (out.length >= 2) break;
      const v = (row.values ?? {})[p.id];
      if (v == null || v === '' || v === false) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (p.type === 'select') {
        const opt = (p.options ?? []).find((o) => o.id === v);
        if (!opt) continue;
        out.push({
          id: `${p.id}-${opt.id}`,
          node: <OptionChip option={opt} />,
        });
      } else if (p.type === 'multi_select' && Array.isArray(v)) {
        for (const id of v.slice(0, 2 - out.length)) {
          const opt = (p.options ?? []).find((o) => o.id === id);
          if (opt) {
            out.push({
              id: `${p.id}-${opt.id}`,
              node: <OptionChip option={opt} />,
            });
          }
        }
      } else if (p.type === 'date' && typeof v === 'string') {
        out.push({
          id: `${p.id}-date`,
          node: (
            <span className="board-card-chip" data-testid={`board-card-chip-${p.id}`}>
              {v.slice(0, 10)}
            </span>
          ),
        });
      } else if (p.type === 'checkbox') {
        // Already handled by the truthy gate above.
      } else if (typeof v === 'string' || typeof v === 'number') {
        out.push({
          id: `${p.id}-text`,
          node: (
            <span className="board-card-chip" data-testid={`board-card-chip-${p.id}`}>
              {String(v)}
            </span>
          ),
        });
      }
    }
    return out;
  }, [row, properties]);

  return (
    <div
      className={`board-card ${isDragging ? 'is-dragging' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="board-card-title" data-testid={`board-card-title-${row.id}`}>
        {row.title || 'Untitled'}
      </div>
      {chips.length > 0 ? (
        <div className="board-card-chips">{chips.map((c) => c.node)}</div>
      ) : null}
      {dragHandle}
    </div>
  );
}

// Wrap the page board card so that it knows about the properties array.
export function BoardCardConnected({
  row,
  properties,
  onClick,
}: {
  row: RowPage;
  properties: Property[];
  onClick: () => void;
}) {
  return <BoardCard row={row} properties={properties} onClick={onClick} />;
}

// Re-export Link so other modules can use the same surface if needed.
export { Link };
