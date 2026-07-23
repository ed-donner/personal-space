// Filter bar + sort control. These are shared across all three views:
// table, board, list. They live above the view area so the user sees the
// active filters and sort regardless of which view is active.
//
// The filter "add" flow is a three-step inline composer:
//   1. pick a property
//   2. pick an op (only those valid for the property type)
//   3. enter a value (typed per property type)
// Committing adds the filter and clears the composer.
//
// Sort is a similar composer, slightly simpler: property + asc/desc
// toggle, with a "clear" affordance.
//
// Both PUT the *active* view's settings — so the same composer is wired
// to whichever view the user is looking at, and persistence is automatic.

import { useEffect, useRef, useState } from "react";
import type { Property } from "../types";
import type {
  Filter,
  FilterOp,
  Sort,
  SortDirection,
  ViewSettings,
} from "../viewLogic";
import {
  defaultListProps,
  opsForType,
  selectProperties,
} from "../viewLogic";
import { Popover } from "./Popover";

// ---- FilterBar ----

interface FilterBarProps {
  properties: Property[];
  settings: ViewSettings;
  /** Persists the new filter list. */
  onChange: (next: Filter[]) => void | Promise<void>;
  /** True while a views PUT is in flight; composer inputs lock. */
  saving?: boolean;
}

let _filterCounter = 0;
export function makeFilterId(): string {
  _filterCounter += 1;
  return `f-${_filterCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

type ComposerStep =
  | { kind: "property" }
  | { kind: "op"; propertyId: string }
  | {
      kind: "value";
      propertyId: string;
      op: FilterOp;
      value: unknown;
    };

export function FilterBar({ properties, settings, onChange, saving }: FilterBarProps) {
  const [composer, setComposer] = useState<ComposerStep | null>(null);

  // DEF-013/DEF-012: a chip whose property is missing from the current
  // database's properties would otherwise render as a raw property id
  // (UUID). We never render those chips; instead, the next render
  // effect writes the cleaned list back to the store / server so the
  // stale entries are scrubbed permanently.
  const visibleFilters = settings.filters.filter((f) =>
    properties.some((p) => p.id === f.propertyId),
  );
  useEffect(() => {
    if (
      visibleFilters.length !== settings.filters.length &&
      // Only write back when the parent isn't in the middle of saving —
      // this avoids a tight loop where our onChange triggers another
      // re-render with a still-pending list.
      !saving
    ) {
      void onChange(visibleFilters);
    }
  }, [visibleFilters, settings.filters.length, saving, onChange]);

  const handleAdd = (filter: Filter) => {
    void onChange([...settings.filters, filter]);
    setComposer(null);
  };

  const handleRemove = (id: string) => {
    void onChange(settings.filters.filter((f) => f.id !== id));
  };

  const renderChipLabel = (f: Filter): string => {
    const p = properties.find((x) => x.id === f.propertyId);
    if (!p) return ""; // unreachable: visibleFilters drops these, but be safe
    const valueText = renderFilterValue(p, f);
    const opText = humanOp(p.type, f.op);
    return `${p.name} ${opText}${valueText ? ` ${valueText}` : ""}`;
  };

  return (
    <div className="filter-bar">
      <div className="filter-bar-chips" aria-label="Active filters">
        {visibleFilters.map((f) => (
          <button
            key={f.id}
            type="button"
            className="filter-chip"
            onClick={() => handleRemove(f.id)}
            title="Remove filter"
            data-testid={`filter-chip-${f.id}`}
          >
            <span className="filter-chip-text">{renderChipLabel(f)}</span>
            <span className="filter-chip-x" aria-hidden="true">
              <svg width="10" height="10" viewBox="0 0 16 16">
                <path
                  d="M4 4 L12 12 M12 4 L4 12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </button>
        ))}
        {composer ? (
          <FilterComposer
            properties={properties}
            state={composer}
            onCancel={() => setComposer(null)}
            onPickProperty={(id) =>
              setComposer({ kind: "op", propertyId: id })
            }
            onPickOp={(op) => {
              if (composer.kind !== "property") {
                setComposer({
                  kind: "value",
                  propertyId: composer.propertyId,
                  op,
                  value: defaultValue(properties, composer.propertyId, op),
                });
              }
            }}
            onChangeValue={(value) => {
              if (composer.kind !== "value") return;
              setComposer({ ...composer, value });
            }}
            onCommit={(filter) => handleAdd(filter)}
          />
        ) : (
          <button
            type="button"
            className="filter-add"
            onClick={() => setComposer({ kind: "property" })}
            disabled={saving || properties.length === 0}
            data-testid="filter-add"
          >
            <span aria-hidden="true">+</span> Filter
          </button>
        )}
      </div>
    </div>
  );
}

function humanOp(_type: Property["type"], op: FilterOp): string {
  switch (op) {
    case "contains":
      return "contains";
    case "not-contains":
      return "does not contain";
    case "eq":
      return "=";
    case "gt":
      return ">";
    case "lt":
      return "<";
    case "is":
      return "is";
    case "is-not":
      return "is not";
    case "before":
      return "is before";
    case "after":
      return "is after";
  }
}

function renderFilterValue(p: Property, f: Filter): string {
  if (f.op === "is" && p.type === "checkbox") {
    return f.value === true ? "checked" : "unchecked";
  }
  if (p.type === "select" && typeof f.value === "string") {
    return p.options.find((o) => o.id === f.value)?.label ?? f.value;
  }
  if (typeof f.value === "string") return f.value;
  if (typeof f.value === "number") return String(f.value);
  if (typeof f.value === "boolean") return f.value ? "yes" : "no";
  return "";
}

function defaultValue(
  properties: Property[],
  propertyId: string,
  op: FilterOp,
): unknown {
  const p = properties.find((x) => x.id === propertyId);
  if (!p) return null;
  switch (p.type) {
    case "text":
    case "url":
      return "";
    case "number":
      return 0;
    case "select":
    case "multiSelect":
      return p.options[0]?.id ?? null;
    case "checkbox":
      return op === "is" ? true : false;
    case "date":
      return new Date().toISOString().slice(0, 10);
  }
}

interface ComposerProps {
  properties: Property[];
  state: ComposerStep;
  onPickProperty: (id: string) => void;
  onPickOp: (op: FilterOp) => void;
  onChangeValue: (v: unknown) => void;
  onCommit: (filter: Filter) => void;
  onCancel: () => void;
}

function FilterComposer({
  properties,
  state,
  onPickProperty,
  onPickOp,
  onChangeValue,
  onCommit,
  onCancel,
}: ComposerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.kind === "value") {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [state.kind]);

  if (state.kind === "property") {
    return (
      <div className="filter-composer filter-composer-step">
        <span className="filter-composer-label">Filter where</span>
        <select
          autoFocus
          className="filter-composer-select"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onPickProperty(e.target.value);
          }}
          onBlur={onCancel}
        >
          <option value="" disabled>
            Choose a property…
          </option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (state.kind === "op") {
    const p = properties.find((x) => x.id === state.propertyId);
    if (!p) return null;
    const ops = opsForType(p.type);
    return (
      <div className="filter-composer filter-composer-step">
        <span className="filter-composer-label">{p.name}</span>
        <select
          autoFocus
          className="filter-composer-select"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onPickOp(e.target.value as FilterOp);
          }}
          onBlur={onCancel}
        >
          <option value="" disabled>
            Choose…
          </option>
          {ops.map((o) => (
            <option key={o} value={o}>
              {humanOp(p.type, o)}
            </option>
          ))}
        </select>
      </div>
    );
  }
  // value step
  const p = properties.find((x) => x.id === state.propertyId);
  if (!p) return null;
  return (
    <div className="filter-composer filter-composer-step filter-composer-value">
      <span className="filter-composer-label">
        {p.name} {humanOp(p.type, state.op)}
      </span>
      <FilterValueInput
        property={p}
        op={state.op}
        value={state.value}
        onChange={onChangeValue}
        inputRef={inputRef}
        // Commit directly with a live value (avoids reading state.value
        // through a closure, which would be stale).
        commit={(v) => {
          if (v === "" || v === null || v === undefined) return;
          onCommit({
            id: makeFilterId(),
            propertyId: p.id,
            op: state.op,
            value: v as Filter["value"],
          });
        }}
        onSubmit={() => {
          if (state.value === "" || state.value === null) return;
          onCommit({
            id: makeFilterId(),
            propertyId: p.id,
            op: state.op,
            value: state.value as Filter["value"],
          });
        }}
      />
      <button
        type="button"
        className="btn btn-secondary btn-tiny"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

interface ValueInputProps {
  property: Property;
  op: FilterOp;
  value: unknown;
  onChange: (v: unknown) => void;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  /** Commit using the *live* value (used by select / checkbox). */
  commit: (v: unknown) => void;
  /** Commit using state.value (used by Enter-key submit). */
  onSubmit: () => void;
}

function FilterValueInput({
  property,
  op,
  value,
  onChange,
  inputRef,
  commit,
  onSubmit,
}: ValueInputProps) {
  // Checkbox: two buttons that commit inline.
  if (property.type === "checkbox" && op === "is") {
    return (
      <div className="filter-value-toggle">
        <button
          type="button"
          className="filter-value-toggle-btn"
          data-active={value === true}
          onClick={() => {
            onChange(true);
            commit(true);
          }}
        >
          Checked
        </button>
        <button
          type="button"
          className="filter-value-toggle-btn"
          data-active={value === false}
          onClick={() => {
            onChange(false);
            commit(false);
          }}
        >
          Unchecked
        </button>
      </div>
    );
  }

  // Select / multiSelect: a dropdown that commits inline on selection.
  if (property.type === "select" || property.type === "multiSelect") {
    return (
      <select
        autoFocus
        className="filter-composer-select"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v);
          commit(v);
        }}
      >
        <option value="" disabled>
          Choose…
        </option>
        {property.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  // Date: native date input.
  if (property.type === "date") {
    return (
      <input
        ref={inputRef}
        type="date"
        className="filter-composer-input"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    );
  }

  // Number: numeric input.
  if (property.type === "number") {
    return (
      <input
        ref={inputRef}
        type="number"
        className="filter-composer-input filter-composer-input-number"
        value={typeof value === "number" ? String(value) : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? "" : Number(e.target.value))
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    );
  }

  // Text / url: plain text input.
  return (
    <input
      ref={inputRef}
      type="text"
      className="filter-composer-input"
      placeholder="value…"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  );
}

// ---- SortControl ----

interface SortControlProps {
  properties: Property[];
  settings: ViewSettings;
  saving?: boolean;
  onChange: (sort: Sort | null) => void | Promise<void>;
}

export function SortControl({
  properties,
  settings,
  saving,
  onChange,
}: SortControlProps) {
  const active = settings.sort;
  const [open, setOpen] = useState(false);
  const [draftProp, setDraftProp] = useState<string | null>(
    active?.propertyId ?? null,
  );
  const [draftDir, setDraftDir] = useState<SortDirection>(
    active?.direction ?? "asc",
  );

  useEffect(() => {
    setDraftProp(active?.propertyId ?? null);
    setDraftDir(active?.direction ?? "asc");
  }, [active?.propertyId, active?.direction]);

  const commit = () => {
    if (!draftProp) {
      void onChange(null);
    } else {
      void onChange({ propertyId: draftProp, direction: draftDir });
    }
  };

  const activeProp = properties.find((p) => p.id === active?.propertyId);

  return (
    <div className="sort-control">
      <Popover
        align="below-right"
        trigger={(openPopover, ref) => (
          <button
            ref={ref as React.Ref<HTMLButtonElement>}
            type="button"
            className="sort-trigger"
            onClick={() => {
              if (!open) setOpen(true);
              openPopover();
            }}
            disabled={saving || properties.length === 0}
            data-testid="sort-trigger"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d={
                  active?.direction === "desc"
                    ? "M4 3 V13 M4 13 L2 11 M4 13 L6 11 M9 4 H14 M9 8 H12 M9 12 H10"
                    : "M4 3 V13 M4 13 L2 11 M4 13 L6 11 M9 12 H14 M9 8 H12 M9 4 H10"
                }
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>
              {active && activeProp
                ? `Sort: ${activeProp.name} ${active.direction === "asc" ? "↑" : "↓"}`
                : "Sort"}
            </span>
          </button>
        )}
      >
        {(close) => (
          <div className="sort-panel">
            <div className="sort-panel-title">Sort by</div>
            <select
              className="sort-panel-select"
              value={draftProp ?? ""}
              onChange={(e) => setDraftProp(e.target.value || null)}
            >
              <option value="">No sort</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="sort-panel-direction">
              <button
                type="button"
                className="sort-direction-btn"
                data-active={draftDir === "asc"}
                onClick={() => setDraftDir("asc")}
                disabled={!draftProp}
              >
                Ascending
              </button>
              <button
                type="button"
                className="sort-direction-btn"
                data-active={draftDir === "desc"}
                onClick={() => setDraftDir("desc")}
                disabled={!draftProp}
              >
                Descending
              </button>
            </div>
            <div className="sort-panel-actions">
              <button
                type="button"
                className="btn btn-secondary btn-tiny"
                onClick={() => {
                  setOpen(false);
                  close();
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-tiny"
                onClick={() => {
                  commit();
                  setOpen(false);
                  close();
                }}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}

// ---- GroupByControl (board only) ----

interface GroupByControlProps {
  properties: Property[];
  groupBy: string | null;
  saving?: boolean;
  onChange: (propertyId: string | null) => void | Promise<void>;
}

export function GroupByControl({
  properties,
  groupBy,
  saving,
  onChange,
}: GroupByControlProps) {
  const options = selectProperties(properties);
  const active = properties.find((p) => p.id === groupBy);
  return (
    <div className="group-by-control">
      <Popover
        align="below-right"
        trigger={(open, ref) => (
          <button
            ref={ref as React.Ref<HTMLButtonElement>}
            type="button"
            className="sort-trigger"
            onClick={() => open()}
            disabled={saving || options.length === 0}
            data-testid="group-by-trigger"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <rect
                x="2"
                y="3"
                width="4.5"
                height="10"
                rx="1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <rect
                x="9.5"
                y="3"
                width="4.5"
                height="10"
                rx="1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            <span>{active ? `Group by: ${active.name}` : "Group by…"}</span>
          </button>
        )}
      >
        {(close) => (
          <div className="sort-panel">
            <div className="sort-panel-title">Group by</div>
            {options.length === 0 ? (
              <div className="sort-panel-empty">
                Add a Select or Multi-select property to group rows on the
                board.
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="sort-panel-option"
                  data-active={groupBy === null}
                  onClick={() => {
                    void onChange(null);
                    close();
                  }}
                >
                  No grouping
                </button>
                {options.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="sort-panel-option"
                    data-active={p.id === groupBy}
                    onClick={() => {
                      void onChange(p.id);
                      close();
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </Popover>
    </div>
  );
}

// ---- PropertiesPicker (list only) ----

interface PropertiesPickerProps {
  properties: Property[];
  selected: string[];
  saving?: boolean;
  onChange: (ids: string[]) => void | Promise<void>;
}

export function PropertiesPicker({
  properties,
  selected,
  saving,
  onChange,
}: PropertiesPickerProps) {
  const effective = selected.length > 0 ? selected : defaultListProps(properties);

  const toggle = (id: string) => {
    const next = effective.includes(id)
      ? effective.filter((x) => x !== id)
      : [...effective, id];
    void onChange(next.slice(0, 2));
  };

  return (
    <div className="props-picker">
      <Popover
        align="below-right"
        trigger={(open, ref) => (
          <button
            ref={ref as React.Ref<HTMLButtonElement>}
            type="button"
            className="sort-trigger"
            onClick={() => open()}
            disabled={saving || properties.length === 0}
            data-testid="props-picker-trigger"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <rect
                x="2"
                y="3"
                width="12"
                height="10"
                rx="1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M5 6 H11 M5 9 H9"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            <span>Properties</span>
          </button>
        )}
      >
        {(close) => (
          <div className="sort-panel sort-panel-wide">
            <div className="sort-panel-title">Show on cards</div>
            <div className="sort-panel-sub">Pick up to two</div>
            {properties.map((p) => {
              const checked = effective.includes(p.id);
              return (
                <label key={p.id} className="props-picker-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(p.id)}
                    disabled={!checked && effective.length >= 2}
                  />
                  <span className="props-picker-row-name">{p.name}</span>
                  <span className="props-picker-row-type">{p.type}</span>
                </label>
              );
            })}
            <div className="sort-panel-actions">
              <button
                type="button"
                className="btn btn-primary btn-tiny"
                onClick={() => close()}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}
