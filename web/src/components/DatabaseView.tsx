// DatabaseView: the database page. Renders the title + header chrome,
// the view switcher (Table / Board / List), the filter + sort bar
// (shared across views), and one of the three views based on the
// current `activeView` in the database's views settings.
//
// The table view keeps the existing inline cell editing. Filtering /
// sorting apply to it as `visibleRows = filters(rows, sort)`; rows
// beyond that are hidden but still count toward the toolbar summary.

import { useEffect, useMemo, useState } from "react";
import type { CellValue, Page, Property } from "../types";
import { useDatabase } from "../databaseStore";
import { usePages } from "../store";
import { CellEditor } from "./CellEditor";
import { PropertyHeaderMenu } from "./PropertyHeaderMenu";
import { AddPropertyMenu } from "./AddPropertyMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { SelectDropdown } from "./SelectDropdown";
import { SaveIndicator } from "./BlockEditor";
import { ViewSwitcher } from "./ViewSwitcher";
import {
  FilterBar,
  GroupByControl,
  PropertiesPicker,
  SortControl,
} from "./FilterBar";
import { BoardView } from "./BoardView";
import { ListView } from "./ListView";
import { visibleRows } from "../viewLogic";

interface Props {
  database: Page;
}

export function DatabaseView({ database }: Props) {
  const { select } = usePages();
  const load = useDatabase((s) => s.load);
  const loadViews = useDatabase((s) => s.loadViews);
  const databaseId = useDatabase((s) => s.databaseId);
  const databaseLoaded = databaseId === database.id;
  const properties = useDatabase((s) => s.properties);
  const rows = useDatabase((s) => s.rows);
  const status = useDatabase((s) => s.status);
  const error = useDatabase((s) => s.error);
  const pending = useDatabase((s) => s.pending);
  const lastSavedAt = useDatabase((s) => s.lastSavedAt);
  const views = useDatabase((s) => s.views);
  const viewsLoaded = useDatabase((s) => s.viewsLoaded);
  const viewsPending = useDatabase((s) => s.viewsPending);
  const viewsError = useDatabase((s) => s.viewsError);

  const addProperty = useDatabase((s) => s.addProperty);
  const addRow = useDatabase((s) => s.addRow);
  const updateRowValue = useDatabase((s) => s.updateRowValue);
  const renameRow = useDatabase((s) => s.renameRow);
  const deleteRow = useDatabase((s) => s.deleteRow);
  const addOption = useDatabase((s) => s.addOption);
  const ensureRowInPages = useDatabase((s) => s.ensureRowInPages);

  const setActiveView = useDatabase((s) => s.setActiveView);
  const setGroupBy = useDatabase((s) => s.setGroupBy);
  const setListProps = useDatabase((s) => s.setListProps);
  const setSort = useDatabase((s) => s.setSort);
  const patchViews = useDatabase((s) => s.patchViews);

  const handleOpenRow = (rowId: string) => {
    const page = ensureRowInPages(rowId);
    if (page) select(page.id);
  };

  const handleAddRow = (title?: string) => addRow(database.id, title);

  // Debounced view-set update: filter chip add/remove fires immediately,
  // but group/sort changes (popover-confirmed) can be batched too. We
  // use a simple 250ms debounce on the patch calls so that quick bursts
  // (e.g. toggling several chips) don't hammer the server.
  useEffect(() => {
    if (databaseLoaded && viewsLoaded === false) {
      void loadViews(database.id);
    }
  }, [database.id, databaseLoaded, viewsLoaded, loadViews]);

  useEffect(() => {
    if (databaseId !== database.id) {
      void load(database.id);
    }
  }, [database.id, databaseId, load]);

  const activeView = views.activeView;
  const settings = views[activeView];
  const visible = useMemo(
    () => visibleRows(rows, settings, properties),
    [rows, settings, properties],
  );

  const handleFiltersChange = (next: import("../viewLogic").Filter[]) => {
    void patchViews({ [activeView]: { filters: next } });
  };
  const handleSortChange = (next: import("../viewLogic").Sort | null) => {
    void setSort(activeView, next);
  };

  if (status === "loading" || (status === "idle" && !databaseLoaded)) {
    return (
      <article>
        <DatabaseHeader database={database} />
        <div className="db-loading">Loading database…</div>
      </article>
    );
  }
  if (status === "error") {
    return (
      <article>
        <DatabaseHeader database={database} />
        <div className="block-error" role="alert">
          <strong>Couldn’t load this database.</strong>
          <p>{error}</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void load(database.id)}
          >
            Retry
          </button>
        </div>
      </article>
    );
  }

  const isEmpty = rows.length === 0 && properties.length === 0;

  return (
    <article className="db-view" data-database-id={database.id}>
      <DatabaseHeader database={database} />
      <section className="db-toolbar">
        <div className="db-toolbar-left">
          <span className="db-summary">
            {visible.length} {visible.length === 1 ? "row" : "rows"}
            {rows.length !== visible.length && (
              <span className="db-summary-of">
                {" "}of {rows.length}
              </span>
            )}
            {properties.length > 0 && (
              <>
                {" · "}
                {properties.length} {properties.length === 1 ? "property" : "properties"}
              </>
            )}
          </span>
          {viewsError && (
            <span className="db-summary-error" role="status" title={viewsError}>
              (views offline — using defaults)
            </span>
          )}
        </div>
        <div className="db-toolbar-right">
          <ViewSwitcher
            active={activeView}
            onChange={(kind) => void setActiveView(kind)}
            disabled={viewsPending}
          />
          {pending.size > 0 ? (
            <span className="save-indicator" data-status="saving">
              Saving…
            </span>
          ) : lastSavedAt ? (
            <SaveIndicator />
          ) : null}
        </div>
      </section>

      <section className="db-filter-sort" aria-label="Filter and sort">
        <FilterBar
          properties={properties}
          settings={settings}
          onChange={handleFiltersChange}
          saving={viewsPending}
        />
        <SortControl
          properties={properties}
          settings={settings}
          saving={viewsPending}
          onChange={handleSortChange}
        />
        {activeView === "board" && (
          <GroupByControl
            properties={properties}
            groupBy={settings.groupBy}
            saving={viewsPending}
            onChange={(id) => void setGroupBy(id)}
          />
        )}
        {activeView === "list" && (
          <PropertiesPicker
            properties={properties}
            selected={settings.listProps}
            saving={viewsPending}
            onChange={(ids) => void setListProps(ids)}
          />
        )}
      </section>

      {isEmpty ? (
        <EmptyDatabase
          onAddProperty={addProperty}
          onAddRow={handleAddRow}
        />
      ) : (
        <>
          {activeView === "table" && (
            <DatabaseTable
              properties={properties}
              rows={visible}
              pending={pending}
              onCommitCell={updateRowValue}
              onRenameRow={renameRow}
              onDeleteRow={deleteRow}
              onAddRow={handleAddRow}
              onCreateOption={addOption}
              onOpenRow={handleOpenRow}
            />
          )}
          {activeView === "board" && (
            <BoardView
              databaseId={database.id}
              properties={properties}
              rows={rows}
              groupBy={settings.groupBy}
              filterIds={settings.filters.map((f) => f.id)}
              sortSpec={settings.sort}
            />
          )}
          {activeView === "list" && (
            <ListView
              databaseId={database.id}
              properties={properties}
              rows={rows}
              listProps={settings.listProps}
            />
          )}
        </>
      )}
    </article>
  );
}

function DatabaseHeader({ database }: { database: Page }) {
  const { update } = usePages();
  const [renaming, setRenaming] = useState(false);
  return (
    <header className="page-header db-header">
      <div className="page-icon" aria-hidden="true">
        {database.icon || "🗃️"}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        {renaming ? (
          <input
            type="text"
            autoFocus
            className="db-title-input"
            defaultValue={database.title}
            onBlur={(e) => {
              const next = e.currentTarget.value.trim();
              if (next && next !== database.title) void update(database.id, { title: next });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setRenaming(false);
              }
            }}
          />
        ) : (
          <h1
            className="page-title db-title"
            onDoubleClick={() => setRenaming(true)}
            title="Double-click to rename"
          >
            {database.title || "Untitled"}
          </h1>
        )}
        <div className="page-meta">
          <span className="page-meta-tag">database</span>
        </div>
      </div>
    </header>
  );
}

function EmptyDatabase({
  onAddProperty,
  onAddRow,
}: {
  onAddProperty: ReturnType<typeof useDatabase.getState>["addProperty"];
  onAddRow: (title?: string) => Promise<unknown>;
}) {
  return (
    <div className="db-empty">
      <div className="db-empty-icon" aria-hidden="true">🗃️</div>
      <h2 className="db-empty-title">This database is empty</h2>
      <p className="db-empty-sub">
        Add your first property and row to get started. Properties define the
        columns; rows hold the data.
      </p>
      <div className="db-empty-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onAddProperty({ name: "Name", type: "text" })}
        >
          + Add property
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void onAddRow()}
        >
          + Add row
        </button>
      </div>
    </div>
  );
}

interface TableProps {
  properties: Property[];
  rows: ReturnType<typeof useDatabase.getState>["rows"];
  pending: Set<string>;
  onCommitCell: ReturnType<typeof useDatabase.getState>["updateRowValue"];
  onRenameRow: ReturnType<typeof useDatabase.getState>["renameRow"];
  onDeleteRow: ReturnType<typeof useDatabase.getState>["deleteRow"];
  onAddRow: (title?: string) => Promise<unknown>;
  onCreateOption: ReturnType<typeof useDatabase.getState>["addOption"];
  onOpenRow: (rowId: string) => void;
}

function DatabaseTable({
  properties,
  rows,
  pending,
  onCommitCell,
  onRenameRow,
  onDeleteRow,
  onAddRow,
  onCreateOption,
  onOpenRow,
}: TableProps) {
  const addProperty = useDatabase((s) => s.addProperty);
  const renameProperty = useDatabase((s) => s.renameProperty);
  const deleteProperty = useDatabase((s) => s.deleteProperty);
  return (
    <div className="db-table-wrap">
      <div className="db-table-scroll">
        <table className="db-table">
          <colgroup>
            <col className="db-col-title" />
            {properties.map((p) => (
              <col key={p.id} className={`db-col db-col-${p.type}`} />
            ))}
            <col className="db-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th className="db-th db-th-title">
                <span className="col-name-static">Name</span>
              </th>
              {properties.map((p) => (
                <th key={p.id} className="db-th">
                  <div className="db-th-inner">
                    <PropertyHeaderMenu
                      property={p}
                      onRename={(name) => renameProperty(p.id, name)}
                      onDelete={() => deleteProperty(p.id)}
                    />
                  </div>
                </th>
              ))}
              <th className="db-th db-th-add">
                <AddPropertyMenu
                  onAdd={(draft) => addProperty(draft)}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RowTr
                key={r.id}
                rowId={r.id}
                title={r.title}
                values={r.values}
                properties={properties}
                pending={pending}
                onCommitCell={onCommitCell}
                onRenameRow={onRenameRow}
                onDeleteRow={onDeleteRow}
                onOpenRow={onOpenRow}
                onCreateOption={onCreateOption}
              />
            ))}
            <tr className="db-add-row-row">
              <td colSpan={properties.length + 2}>
                <button
                  type="button"
                  className="db-add-row"
                  onClick={() => void onAddRow()}
                >
                  <span className="db-add-row-icon" aria-hidden="true">+</span>
                  New row
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowTr({
  rowId,
  title,
  values,
  properties,
  pending,
  onCommitCell,
  onRenameRow,
  onDeleteRow,
  onOpenRow,
  onCreateOption,
}: {
  rowId: string;
  title: string;
  values: Record<string, CellValue>;
  properties: Property[];
  pending: Set<string>;
  onCommitCell: ReturnType<typeof useDatabase.getState>["updateRowValue"];
  onRenameRow: ReturnType<typeof useDatabase.getState>["renameRow"];
  onDeleteRow: ReturnType<typeof useDatabase.getState>["deleteRow"];
  onOpenRow: (id: string) => void;
  onCreateOption: ReturnType<typeof useDatabase.getState>["addOption"];
}) {
  const [confirming, setConfirming] = useState(false);
  const handleConfirm = () => {
    setConfirming(false);
    void onDeleteRow(rowId);
  };
  return (
    <tr className="db-row" data-row-id={rowId}>
      <td className="db-td db-td-title">
        <a
          className="db-row-title"
          href={`#row/${rowId}`}
          onClick={(e) => {
            e.preventDefault();
            onOpenRow(rowId);
          }}
          title="Open row"
        >
          <TitleEditor
            initial={title}
            onCommit={(next) => onRenameRow(rowId, next)}
          />
        </a>
        <span className="db-row-actions">
          <button
            type="button"
            className="db-row-action"
            aria-label="Open row"
            onClick={() => onOpenRow(rowId)}
            title="Open"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M6 3 H3 V13 H13 V10 M9 3 H13 V7 M8 8 L13 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="db-row-action db-row-action-danger"
            aria-label="Delete row"
            title="Delete"
            onClick={() => setConfirming(true)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 4 H13 M6 4 V2.5 H10 V4 M5 4 L5.5 13 H10.5 L11 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </span>
      </td>
      {properties.map((p) => {
        const key = `${rowId}:${p.id}`;
        const saving = pending.has(key);
        return (
          <td key={p.id} className="db-td">
            <div className="db-cell" data-saving={saving}>
              <CellForProperty
                property={p}
                value={values[p.id] ?? null}
                saving={saving}
                onCommit={(next) =>
                  onCommitCell(rowId, p.id, next)
                }
                onCreateOption={(label) =>
                  onCreateOption(p.id, label).then((prop) => {
                    const last = prop.options[prop.options.length - 1];
                    return last;
                  })
                }
              />
            </div>
          </td>
        );
      })}
      <td className="db-td db-td-spacer" />
      {confirming && (
        <ConfirmHost
          onConfirm={handleConfirm}
          onCancel={() => setConfirming(false)}
          title={title}
        />
      )}
    </tr>
  );
}

function ConfirmHost({
  onConfirm,
  onCancel,
  title,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
}) {
  return (
    <ConfirmDialog
      title="Delete row"
      body={
        <>
          Delete <strong>{title || "this row"}</strong>? Its page content goes
          with it.
        </>
      }
      confirmLabel="Delete"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function TitleEditor({
  initial,
  onCommit,
}: {
  initial: string;
  onCommit: (next: string) => void | Promise<unknown>;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  return (
    <input
      type="text"
      className="db-title-cell"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== initial) void onCommit(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setValue(initial);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      aria-label="Row title"
    />
  );
}

function CellForProperty({
  property,
  value,
  saving,
  onCommit,
  onCreateOption,
}: {
  property: Property;
  value: CellValue;
  saving: boolean;
  onCommit: (next: CellValue | null) => void;
  onCreateOption: (label: string) => Promise<{ id: string; label: string; color: import("../types").OptionColor }>;
}) {
  if (property.type === "select") {
    const v = typeof value === "string" ? value : null;
    return (
      <SelectDropdown
        property={property}
        value={v}
        onChange={(id) => onCommit(id)}
        onCreateOption={onCreateOption}
      />
    );
  }
  if (property.type === "multiSelect") {
    const v = Array.isArray(value) ? (value as string[]) : [];
    return (
      <SelectDropdown
        property={property}
        multi
        value={v}
        onChange={(ids) => onCommit(ids)}
        onCreateOption={onCreateOption}
      />
    );
  }
  return (
    <CellEditor
      property={property}
      value={value}
      saving={saving}
      onCommit={onCommit}
    />
  );
}
