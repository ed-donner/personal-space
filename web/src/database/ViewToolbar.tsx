// Shared toolbar that lives above each view. Hosts the Filter builder
// and Sort picker, and (for the board) a Group by dropdown. Every
// change PATCHes the view's settings via the supplied onChange callback.

import { useEffect, useRef, useState } from 'react';
import type {
  DatabaseFilter,
  DatabaseSort,
  DatabaseViewSettings,
  Property,
  ViewType,
} from '../lib/api';
import { OptionChip } from './CellEditor';
import {
  TITLE_PROPERTY_ID,
  emptyFilterFor,
  opsForType,
} from './views';

interface ViewToolbarProps {
  viewType: ViewType;
  properties: Property[];
  settings: DatabaseViewSettings;
  /** True when the toolbar should expose a groupBy dropdown (board view). */
  showGroupBy?: boolean;
  /** Property options to offer for groupBy (defaults to select properties). */
  groupByCandidates?: Property[];
  /** Called after the user changes any setting. The toolbar is debounced
   *  internally for typing; onChange is called with the next settings. */
  onChange: (next: DatabaseViewSettings) => void;
  /** True while a PATCH is in flight. */
  busy?: boolean;
}

type ToolbarPanel =
  | { kind: 'closed' }
  | { kind: 'filter' }
  | { kind: 'sort' };

export function ViewToolbar({
  viewType,
  properties,
  settings,
  showGroupBy = false,
  groupByCandidates,
  onChange,
  busy = false,
}: ViewToolbarProps) {
  const [panel, setPanel] = useState<ToolbarPanel>({ kind: 'closed' });
  const [groupByOpen, setGroupByOpen] = useState(false);
  const groupByHostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const filters = settings.filters ?? [];
  const sort = settings.sort ?? null;
  const groupBy = settings.groupBy ?? null;

  // Close the panel on outside click.
  useEffect(() => {
    if (panel.kind === 'closed' && !groupByOpen) return undefined;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && rootRef.current && rootRef.current.contains(target)) return;
      setPanel({ kind: 'closed' });
      setGroupByOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [panel.kind, groupByOpen]);

  const updateFilters = (next: DatabaseFilter[]) => {
    onChange({ ...settings, filters: next });
  };
  const updateSort = (next: DatabaseSort | null) => {
    onChange({ ...settings, sort: next });
  };
  const updateGroupBy = (next: string | null) => {
    onChange({ ...settings, groupBy: next });
  };

  const addFilter = (property: Property) => {
    const next = [...filters, emptyFilterFor(property)];
    updateFilters(next);
  };

  const removeFilterAt = (index: number) => {
    updateFilters(filters.filter((_, i) => i !== index));
  };

  const updateFilterAt = (index: number, patch: Partial<DatabaseFilter>) => {
    updateFilters(
      filters.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  };

  const addableProperties = properties.filter(
    (p) => opsForType(p.type).length > 0
  );

  const candidates: Property[] = groupByCandidates
    ? groupByCandidates
    : properties.filter(
        (p) => p.type === 'select' || p.type === 'multi_select'
      );

  const groupByProperty =
    groupBy == null
      ? null
      : properties.find((p) => p.id === groupBy) ?? null;

  return (
    <div
      className="view-toolbar"
      data-testid={`view-toolbar-${viewType}`}
      ref={rootRef}
    >
      <div className="view-toolbar-row">
        <button
          type="button"
          className={`view-toolbar-button ${filters.length > 0 ? 'is-active' : ''}`}
          onClick={() =>
            setPanel((p) =>
              p.kind === 'filter' ? { kind: 'closed' } : { kind: 'filter' }
            )
          }
          data-testid={`view-filter-button-${viewType}`}
          aria-expanded={panel.kind === 'filter'}
        >
          <span aria-hidden="true" className="view-toolbar-glyph">F</span>
          Filter
          {filters.length > 0 ? (
            <span className="view-toolbar-count" data-testid={`view-filter-count-${viewType}`}>
              {filters.length}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          className={`view-toolbar-button ${sort ? 'is-active' : ''}`}
          onClick={() =>
            setPanel((p) =>
              p.kind === 'sort' ? { kind: 'closed' } : { kind: 'sort' }
            )
          }
          data-testid={`view-sort-button-${viewType}`}
          aria-expanded={panel.kind === 'sort'}
        >
          <span aria-hidden="true" className="view-toolbar-glyph">S</span>
          Sort
          {sort ? (
            <span className="view-toolbar-sort-summary">
              {sort.propertyId === TITLE_PROPERTY_ID
                ? 'Title'
                : properties.find((p) => p.id === sort.propertyId)?.name ??
                  'Unknown'}
              {' '}
              <span aria-hidden="true">
                {sort.direction === 'asc' ? 'asc' : 'desc'}
              </span>
            </span>
          ) : null}
        </button>

        {showGroupBy ? (
          <div className="view-toolbar-groupby" ref={groupByHostRef}>
            <button
              type="button"
              className={`view-toolbar-button ${groupBy ? 'is-active' : ''}`}
              onClick={() => setGroupByOpen((open) => !open)}
              data-testid={`view-groupby-button-${viewType}`}
              aria-expanded={groupByOpen}
            >
              <span aria-hidden="true" className="view-toolbar-glyph">G</span>
              Group by
              {groupByProperty ? (
                <span className="view-toolbar-sort-summary">
                  {groupByProperty.name}
                </span>
              ) : (
                <span className="view-toolbar-sort-summary is-muted">None</span>
              )}
            </button>
            {groupByOpen ? (
              <div
                className="view-toolbar-popover"
                data-testid={`view-groupby-popover-${viewType}`}
                onMouseDown={(e) => e.stopPropagation()}
                role="listbox"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={groupBy == null}
                  className={`view-toolbar-popover-item ${groupBy == null ? 'is-selected' : ''}`}
                  onClick={() => {
                    updateGroupBy(null);
                    setGroupByOpen(false);
                  }}
                  data-testid={`view-groupby-none-${viewType}`}
                >
                  <span className="view-toolbar-popover-dot is-none" aria-hidden="true" />
                  None
                </button>
                {candidates.length === 0 ? (
                  <div className="view-toolbar-popover-empty">
                    No select properties yet.
                  </div>
                ) : (
                  candidates.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={groupBy === p.id}
                      className={`view-toolbar-popover-item ${groupBy === p.id ? 'is-selected' : ''}`}
                      onClick={() => {
                        updateGroupBy(p.id);
                        setGroupByOpen(false);
                      }}
                      data-testid={`view-groupby-option-${p.id}`}
                    >
                      <span className="view-toolbar-popover-dot" aria-hidden="true" />
                      {p.name}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {busy ? (
          <span className="view-toolbar-saving" data-testid={`view-toolbar-saving-${viewType}`}>
            Saving...
          </span>
        ) : null}
      </div>

      {filters.length > 0 ? (
        <div className="view-toolbar-chips" data-testid={`view-filter-chips-${viewType}`}>
          {filters.map((f, i) => (
            <FilterChip
              key={`${f.propertyId}-${i}`}
              filter={f}
              properties={properties}
              onRemove={() => removeFilterAt(i)}
              onChange={(patch) => updateFilterAt(i, patch)}
              testId={`view-filter-chip-${i}`}
            />
          ))}
        </div>
      ) : null}

      {sort ? (
        <div className="view-toolbar-chips" data-testid={`view-sort-chips-${viewType}`}>
          <SortChip
            sort={sort}
            properties={properties}
            onRemove={() => updateSort(null)}
            onChange={(next) => updateSort(next)}
          />
        </div>
      ) : null}

      {panel.kind === 'filter' ? (
        <FilterPanel
          viewType={viewType}
          properties={addableProperties}
          filters={filters}
          onAdd={addFilter}
          onClose={() => setPanel({ kind: 'closed' })}
        />
      ) : null}

      {panel.kind === 'sort' ? (
        <SortPanel
          viewType={viewType}
          properties={properties}
          sort={sort}
          onApply={(next) => {
            updateSort(next);
            setPanel({ kind: 'closed' });
          }}
          onClose={() => setPanel({ kind: 'closed' })}
        />
      ) : null}
    </div>
  );
}

function FilterChip({
  filter,
  properties,
  onRemove,
  onChange,
  testId,
}: {
  filter: DatabaseFilter;
  properties: Property[];
  onRemove: () => void;
  onChange: (patch: Partial<DatabaseFilter>) => void;
  testId: string;
}) {
  const property = properties.find((p) => p.id === filter.propertyId);
  const ops = property ? opsForType(property.type) : [];
  const needsValue = filter.op !== 'is_checked' && filter.op !== 'is_not_checked';
  return (
    <div className="view-filter-chip" data-testid={testId}>
      <span className="view-filter-chip-name">{property?.name ?? 'Unknown'}</span>
      <select
        className="view-filter-chip-op"
        value={filter.op}
        onChange={(e) => {
          const op = e.target.value as DatabaseFilter['op'];
          const patch: Partial<DatabaseFilter> = { op };
          if (op === 'is_checked' || op === 'is_not_checked') {
            patch.value = null;
          } else if (filter.value == null) {
            patch.value = '';
          }
          onChange(patch);
        }}
        data-testid={`${testId}-op`}
        aria-label="Filter operator"
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {opLabel(op)}
          </option>
        ))}
      </select>
      {needsValue ? (
        <FilterChipValue
          filter={filter}
          property={property ?? null}
          onChange={(v) => onChange({ value: v })}
        />
      ) : null}
      <button
        type="button"
        className="view-filter-chip-remove"
        onClick={onRemove}
        aria-label="Remove filter"
        data-testid={`${testId}-remove`}
      >
        x
      </button>
    </div>
  );
}

function FilterChipValue({
  filter,
  property,
  onChange,
}: {
  filter: DatabaseFilter;
  property: Property | null;
  onChange: (value: string | null) => void;
}) {
  if (!property) {
    return (
      <input
        className="view-filter-chip-value"
        value={typeof filter.value === 'string' ? filter.value : ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Filter value"
      />
    );
  }
  if (property.type === 'select' || property.type === 'multi_select') {
    return (
      <select
        className="view-filter-chip-value"
        value={typeof filter.value === 'string' ? filter.value : ''}
        onChange={(e) => onChange(e.target.value)}
        data-testid="view-filter-chip-value-select"
        aria-label="Filter value"
      >
        <option value=""></option>
        {(property.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (property.type === 'date') {
    return (
      <input
        type="date"
        className="view-filter-chip-value"
        value={typeof filter.value === 'string' ? filter.value : ''}
        onChange={(e) => onChange(e.target.value)}
        data-testid="view-filter-chip-value-date"
        aria-label="Filter value"
      />
    );
  }
  return (
    <input
      type="text"
      className="view-filter-chip-value"
      value={typeof filter.value === 'string' ? filter.value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder="value"
      data-testid="view-filter-chip-value-text"
      aria-label="Filter value"
    />
  );
}

function FilterPanel({
  viewType,
  properties,
  filters,
  onAdd,
  onClose,
}: {
  viewType: ViewType;
  properties: Property[];
  filters: DatabaseFilter[];
  onAdd: (property: Property) => void;
  onClose: () => void;
}) {
  const used = new Set(filters.map((f) => f.propertyId));
  const available = properties.filter((p) => !used.has(p.id));
  return (
    <div
      className="view-filter-panel"
      data-testid={`view-filter-panel-${viewType}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="view-filter-panel-title">Add a filter</div>
      {available.length === 0 ? (
        <div className="view-filter-panel-empty">
          Every filterable property already has a filter.
        </div>
      ) : (
        <div className="view-filter-panel-grid">
          {available.map((p) => (
            <button
              key={p.id}
              type="button"
              className="view-filter-panel-item"
              onClick={() => onAdd(p)}
              data-testid={`view-filter-add-${p.id}`}
            >
              <span className="view-filter-panel-item-name">{p.name}</span>
              <span className="view-filter-panel-item-type">
                {propertyTypeShort(p.type)}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="view-filter-panel-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onClose}
          data-testid={`view-filter-close-${viewType}`}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function SortChip({
  sort,
  properties,
  onRemove,
  onChange,
}: {
  sort: DatabaseSort;
  properties: Property[];
  onRemove: () => void;
  onChange: (next: DatabaseSort) => void;
}) {
  const propertyName =
    sort.propertyId === TITLE_PROPERTY_ID
      ? 'Title'
      : properties.find((p) => p.id === sort.propertyId)?.name ?? 'Unknown';
  return (
    <div className="view-filter-chip" data-testid="view-sort-chip">
      <span className="view-filter-chip-name">Sort</span>
      <span className="view-filter-chip-name">{propertyName}</span>
      <button
        type="button"
        className="view-filter-chip-direction"
        onClick={() =>
          onChange({
            ...sort,
            direction: sort.direction === 'asc' ? 'desc' : 'asc',
          })
        }
        aria-label="Toggle sort direction"
        data-testid="view-sort-chip-direction"
      >
        {sort.direction === 'asc' ? 'Asc' : 'Desc'}
      </button>
      <button
        type="button"
        className="view-filter-chip-remove"
        onClick={onRemove}
        aria-label="Remove sort"
        data-testid="view-sort-chip-remove"
      >
        x
      </button>
    </div>
  );
}

function SortPanel({
  viewType,
  properties,
  sort,
  onApply,
  onClose,
}: {
  viewType: ViewType;
  properties: Property[];
  sort: DatabaseSort | null;
  onApply: (next: DatabaseSort | null) => void;
  onClose: () => void;
}) {
  const [propertyId, setPropertyId] = useState<string>(
    sort?.propertyId ?? TITLE_PROPERTY_ID
  );
  const [direction, setDirection] = useState<'asc' | 'desc'>(
    sort?.direction ?? 'asc'
  );
  return (
    <div
      className="view-sort-panel"
      data-testid={`view-sort-panel-${viewType}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="view-filter-panel-title">Sort by</div>
      <div className="view-sort-panel-row">
        <select
          className="view-sort-panel-property"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          data-testid="view-sort-panel-property"
          aria-label="Sort property"
        >
          <option value={TITLE_PROPERTY_ID}>Title</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="view-sort-panel-direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value as 'asc' | 'desc')}
          data-testid="view-sort-panel-direction"
          aria-label="Sort direction"
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>
      <div className="view-filter-panel-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onClose}
          data-testid={`view-sort-panel-cancel-${viewType}`}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onApply({ propertyId, direction })}
          data-testid={`view-sort-panel-apply-${viewType}`}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function opLabel(op: DatabaseFilter['op']): string {
  switch (op) {
    case 'contains':
      return 'contains';
    case 'is':
      return 'is';
    case 'is_not':
      return 'is not';
    case 'is_checked':
      return 'is checked';
    case 'is_not_checked':
      return 'is not checked';
    case 'before':
      return 'before';
    case 'after':
      return 'after';
  }
}

function propertyTypeShort(type: Property['type']): string {
  switch (type) {
    case 'text':
      return 'Text';
    case 'url':
      return 'URL';
    case 'select':
      return 'Select';
    case 'multi_select':
      return 'Multi';
    case 'date':
      return 'Date';
    case 'checkbox':
      return 'Bool';
    case 'number':
      return 'Number';
  }
}

// Re-export so callers can render option chips inside the toolbar.
export { OptionChip };
