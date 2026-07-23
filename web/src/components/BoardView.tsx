// BoardView: the kanban-style board view for a database.
//
// One column per option of the current `groupBy` property, plus a "No
// value" column when at least one row has no value for it. Cards can be
// dragged between columns with @dnd-kit/core; the drop fires a PATCH to
// update the row's groupBy value (or null for "No value"), with an
// optimistic local move that rolls back if the server fails.
//
// The view is composed from `viewLogic` (filter + sort + group). The
// header column chips use the same swatch colors as table chips, so the
// look matches the rest of the app.

import {
  DndContext as _DndContext,
  type DragEndEvent,
  DragOverlay as _DragOverlay,
  type DragStartEvent,
  PointerSensor as _PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import type { OptionColor, Property, Row } from "../types";
import { useDatabase } from "../databaseStore";
import { usePages } from "../store";
import {
  groupRows,
  renderCellValue,
  visibleRows,
  type BoardColumn,
} from "../viewLogic";

// @dnd-kit/core ships with older React types that don't include `bigint`
// in ReactNode, so the JSX types collide with @types/react@19 (hoisted by
// npm). The runtime is fine — cast the components through ComponentType
// to silence the type-only mismatch.
const DndContext = _DndContext as unknown as ComponentType<{
  sensors?: unknown;
  onDragStart?: (e: DragStartEvent) => void;
  onDragEnd?: (e: DragEndEvent) => void;
  onDragCancel?: () => void;
  children?: React.ReactNode;
}>;
const DragOverlay = _DragOverlay as unknown as ComponentType<{
  children?: React.ReactNode;
}>;

interface BoardViewProps {
  databaseId: string;
  properties: Property[];
  rows: Row[];
  groupBy: string | null;
  filterIds: string[];
  sortSpec: ViewSettingsLite["sort"];
}

interface ViewSettingsLite {
  filters: import("../viewLogic").Filter[];
  sort: import("../viewLogic").Sort | null;
}

export function BoardView({
  databaseId,
  properties,
  rows,
  groupBy,
  filterIds: _filterIds,
  sortSpec: _sortSpec,
}: BoardViewProps) {
  const settings = useDatabase((s) => s.views[boardKey()]);
  const updateRowValue = useDatabase((s) => s.updateRowValue);
  const groupByProp = useMemo(
    () => properties.find((p) => p.id === groupBy) ?? null,
    [properties, groupBy],
  );

  const visible = useMemo(
    () => visibleRows(rows, settings, properties),
    [rows, settings, properties],
  );

  const columns = useMemo(
    () => groupRows(visible, properties, groupBy),
    [visible, properties, groupBy],
  );

  // The dnd context needs a unique id namespace per drag so simultaneous
  // drags don't collide. The active card id is enough.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(_PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  if (!groupByProp) {
    return (
      <EmptyBoard
        properties={properties}
        onAddSelect={async () => {
          // Add a Status select property the user can group by.
          await useDatabase.getState().addProperty({
            name: "Status",
            type: "select",
          });
        }}
      />
    );
  }

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setError(null);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const overId = e.over?.id;
    if (!overId) return;
    const activeRowId = String(e.active.id);
    // overId is the column key: an option id, or "__none__" for the
    // "No value" bucket.
    const targetOptionId =
      typeof overId === "string" && overId !== "__none__" ? overId : null;
    const row = rows.find((r) => r.id === activeRowId);
    if (!row) return;
    const current = row.values[groupByProp.id] ?? null;
    if (current === targetOptionId) return;
    // Optimistic update.
    const previousRows = rows;
    useDatabase.setState((s) => ({
      rows: s.rows.map((r) =>
        r.id === activeRowId
          ? {
              ...r,
              values: { ...r.values, [groupByProp.id]: targetOptionId },
            }
          : r,
      ),
    }));
    try {
      await updateRowValue(activeRowId, groupByProp.id, targetOptionId);
      setError(null);
    } catch (err) {
      // Rollback.
      useDatabase.setState({ rows: previousRows });
      setError((err as Error).message);
    }
  };

  const activeRow = activeId ? rows.find((r) => r.id === activeId) : null;

  return (
    <div className="board-view" data-database-id={databaseId} data-testid="board-view">
      {error && (
        <div className="board-error" role="alert">
          Couldn't move that card: {error}
        </div>
      )}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="board-canvas">
          <div className="board-columns">
            {columns.map((col) => (
              <BoardColumnView
                key={col.key}
                column={col}
                properties={properties}
                onOpenRow={(rowId) => openRow(rowId)}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {activeRow ? (
            <div className="board-card board-card-dragging">
              <CardBody row={activeRow} properties={properties} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// Helper used in the store key selector above.
function boardKey(): "board" {
  return "board";
}

// Helpers used by both the column and the drag overlay.

function openRow(rowId: string) {
  const row = useDatabase.getState().rows.find((r) => r.id === rowId);
  if (!row) return;
  const page = useDatabase.getState().ensureRowInPages(row);
  if (page) usePages.getState().select(page.id);
}

function colorForOption(color: OptionColor): { bg: string; fg: string } {
  return {
    bg: `var(--chip-${color}-bg)`,
    fg: `var(--chip-${color}-fg)`,
  };
}

function BoardColumnView({
  column,
  properties,
  onOpenRow,
}: {
  column: BoardColumn;
  properties: Property[];
  onOpenRow: (rowId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  // Pick the "card props" — sensible subset: first two non-title select /
  // multiSelect / date / number / checkbox / url properties that have a
  // value, preferring the same properties the list view would show.
  const cardProps = pickCardProps(column.rows, properties);

  return (
    <section
      ref={setNodeRef}
      className="board-column"
      data-over={isOver}
      data-column-key={column.key}
    >
      <header className="board-column-header">
        {column.option ? (
          <span
            className="board-column-chip opt-chip"
            style={{
              background: colorForOption(column.option.color).bg,
              color: colorForOption(column.option.color).fg,
            }}
          >
            <span
              className="opt-chip-dot"
              style={{
                background: colorForOption(column.option.color).fg,
                opacity: 0.5,
              }}
            />
            {column.option.label}
          </span>
        ) : (
          <span className="board-column-chip board-column-chip-none">
            {column.label}
          </span>
        )}
        <span className="board-column-count">
          {column.rows.length}
        </span>
      </header>
      <div className="board-column-body">
        {column.rows.map((r) => (
          <BoardCard
            key={r.id}
            row={r}
            cardProps={cardProps}
            onOpen={() => onOpenRow(r.id)}
          />
        ))}
        {column.rows.length === 0 && (
          <div className="board-column-empty">Drop cards here</div>
        )}
      </div>
    </section>
  );
}

function BoardCard({
  row,
  cardProps,
  onOpen,
}: {
  row: Row;
  cardProps: Property[];
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: row.id,
  });
  return (
    <div
      ref={setNodeRef}
      className="board-card"
      data-dragging={isDragging}
      {...listeners}
      {...attributes}
    >
      <CardBody row={row} properties={cardProps} onOpen={onOpen} />
    </div>
  );
}

function CardBody({
  row,
  properties,
  onOpen,
}: {
  row: Row;
  properties: Property[];
  onOpen?: () => void;
}) {
  return (
    <div className="board-card-inner">
      <button
        type="button"
        className="board-card-title"
        onClick={(e) => {
          // Only fire on plain click, not after a drag (dnd-kit cancels
          // the click via the activationConstraint; PointerSensor with
          // a distance gate handles that).
          e.stopPropagation();
          onOpen?.();
        }}
      >
        {row.title || "Untitled"}
      </button>
      {properties.length > 0 && (
        <div className="board-card-props">
          {properties.map((p) => {
            const v = row.values[p.id] ?? null;
            const rendered = renderCellValue(p, v);
            if (!rendered) return null;
            return (
              <span
                key={p.id}
                className={`board-card-prop board-card-prop-${rendered.kind}`}
                title={p.name}
              >
                {rendered.kind === "chip" && p.type === "select" ? (
                  <span className="board-card-prop-chip">
                    {rendered.text}
                  </span>
                ) : rendered.kind === "chip" && p.type === "multiSelect" ? (
                  <span className="board-card-prop-chip board-card-prop-multichip">
                    {rendered.text}
                  </span>
                ) : rendered.kind === "check" ? (
                  <span className="board-card-prop-check">✓ {p.name}</span>
                ) : rendered.kind === "date" ? (
                  <span className="board-card-prop-date">{rendered.text}</span>
                ) : (
                  <span className="board-card-prop-text">{rendered.text}</span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Pick up to two properties to show on each card. We bias toward the
 * kinds that read well at a glance (select, date, checkbox, number,
 * url), and skip title-less text fields.
 */
function pickCardProps(rows: Row[], properties: Property[]): Property[] {
  const preferred = properties.filter(
    (p) =>
      p.type === "select" ||
      p.type === "multiSelect" ||
      p.type === "date" ||
      p.type === "url" ||
      p.type === "number" ||
      p.type === "checkbox",
  );
  // Score by how many rows have a non-empty value for the property.
  const scored = preferred
    .map((p) => {
      const filled = rows.filter((r) => {
        const v = r.values[p.id];
        if (v === null || v === undefined) return false;
        if (typeof v === "string" && v === "") return false;
        if (Array.isArray(v) && v.length === 0) return false;
        return true;
      }).length;
      return { p, filled };
    })
    .filter((s) => s.filled > 0)
    .sort((a, b) => b.filled - a.filled);
  return scored.slice(0, 2).map((s) => s.p);
}

function EmptyBoard({
  properties,
  onAddSelect,
}: {
  properties: Property[];
  onAddSelect: () => void;
}) {
  const hasSelect = properties.some(
    (p) => p.type === "select" || p.type === "multiSelect",
  );
  return (
    <div className="board-empty">
      <div className="board-empty-icon" aria-hidden="true">
        📋
      </div>
      <h2 className="board-empty-title">No grouping yet</h2>
      <p className="board-empty-sub">
        {hasSelect
          ? "Pick a Select property from the “Group by” menu to lay out the board."
          : "Add a Select property to group rows on the board."}
      </p>
      {!hasSelect && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={onAddSelect}
          data-testid="board-add-select"
        >
          + Add a Select property
        </button>
      )}
    </div>
  );
}

// Silence the unused-import warning in some toolchains.
void useEffect;
