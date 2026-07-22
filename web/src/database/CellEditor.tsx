import { useEffect, useRef, useState } from 'react';
import type { Property, PropertyType, PropertyOption } from '../lib/api';
import { nextOptionColor, findOption } from './helpers';
import { api } from '../lib/api';

interface CellEditorBaseProps {
  property: Property;
  value: unknown;
  /** Called with the already-coerced value to commit. */
  onCommit: (value: unknown) => void;
  /** Called when the user cancels (Escape). */
  onCancel: () => void;
  /** ID of the row this cell belongs to. Used for test ids. */
  rowId: string;
  /** Auto-focus when the editor opens. Defaults to true. */
  autoFocus?: boolean;
  /** Called when the editor mutates the database (e.g. creates an option)
   *  so the parent can refetch and the new option shows on other rows. */
  onDatabaseMutated?: () => void;
}

function isInlineEditor(type: PropertyType): boolean {
  return type === 'text' || type === 'url' || type === 'number' || type === 'date';
}

// ----- Display variants (read-only) -----

/** A single colored chip for a select / multi-select option. */
export function OptionChip({ option, testId }: { option: PropertyOption; testId?: string }) {
  return (
    <span
      className="option-chip"
      style={{ '--option-color': option.color } as React.CSSProperties}
      data-testid={testId}
    >
      <span className="option-chip-dot" aria-hidden="true" />
      {option.label}
    </span>
  );
}

/** Read-only display of a cell value. */
export function CellDisplay({
  property,
  value,
  rowId,
}: {
  property: Property;
  value: unknown;
  rowId: string;
}) {
  switch (property.type) {
    case 'text': {
      const empty = value === null || value === undefined || value === '';
      return (
        <span className="cell-display cell-display-text" data-testid={`cell-text-${rowId}-${property.id}`}>
          {empty ? <span className="cell-empty">Empty</span> : String(value)}
        </span>
      );
    }
    case 'url': {
      const url = typeof value === 'string' && value ? value : null;
      if (!url) return <span className="cell-empty" data-testid={`cell-url-${rowId}-${property.id}`}>Empty</span>;
      const href = url.startsWith('http') ? url : `https://${url}`;
      return (
        <a
          className="cell-display cell-display-url"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          data-testid={`cell-url-${rowId}-${property.id}`}
        >
          {url}
        </a>
      );
    }
    case 'number': {
      const n = typeof value === 'number' ? value : null;
      if (n === null) return <span className="cell-empty" data-testid={`cell-number-${rowId}-${property.id}`}>Empty</span>;
      return (
        <span className="cell-display cell-display-number" data-testid={`cell-number-${rowId}-${property.id}`}>
          {n}
        </span>
      );
    }
    case 'date': {
      const s = typeof value === 'string' && value ? value : null;
      if (!s) return <span className="cell-empty" data-testid={`cell-date-${rowId}-${property.id}`}>Empty</span>;
      return (
        <span className="cell-display cell-display-date" data-testid={`cell-date-${rowId}-${property.id}`}>
          {s.slice(0, 10)}
        </span>
      );
    }
    case 'checkbox': {
      const checked = value === true;
      return (
        <span
          className={`cell-display cell-display-checkbox ${checked ? 'is-checked' : ''}`}
          data-testid={`cell-checkbox-${rowId}-${property.id}`}
          data-checked={checked ? 'true' : 'false'}
          aria-hidden="true"
        >
          <span className="cell-checkbox-mark" />
        </span>
      );
    }
    case 'select': {
      const opt = findOption(property.options, typeof value === 'string' ? value : null);
      if (!opt) return <span className="cell-empty" data-testid={`cell-select-${rowId}-${property.id}`}>Empty</span>;
      return <OptionChip option={opt} testId={`cell-select-${rowId}-${property.id}`} />;
    }
    case 'multi_select': {
      const ids = Array.isArray(value)
        ? (value as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      const opts = ids
        .map((id) => findOption(property.options, id))
        .filter((o): o is PropertyOption => Boolean(o));
      if (opts.length === 0) return <span className="cell-empty" data-testid={`cell-multi-${rowId}-${property.id}`}>Empty</span>;
      return (
        <span className="cell-display cell-display-multi" data-testid={`cell-multi-${rowId}-${property.id}`}>
          {opts.map((opt) => (
            <OptionChip key={opt.id} option={opt} />
          ))}
        </span>
      );
    }
    default:
      return <span className="cell-empty">Empty</span>;
  }
}

// ----- Inline editor (text/url/number/date) -----

function InlineEditor({ property, value, onCommit, onCancel, autoFocus }: CellEditorBaseProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string>(() => {
    if (value === null || value === undefined) return '';
    if (property.type === 'date') {
      const s = String(value);
      return s.length >= 10 ? s.slice(0, 10) : s;
    }
    return String(value);
  });

  useEffect(() => {
    if (autoFocus !== false) {
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [autoFocus]);

  const commit = () => {
    if (property.type === 'number') {
      const trimmed = draft.trim();
      if (trimmed === '') {
        onCommit(null);
        return;
      }
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        // Junk input: revert (no PATCH).
        onCancel();
        return;
      }
      onCommit(n);
      return;
    }
    onCommit(draft === '' ? null : draft);
  };

  return (
    <input
      ref={inputRef}
      type={
        // Use type="text" with inputMode="decimal" for number properties
        // so that non-numeric text the user types or pastes survives in
        // the input's value. The commit handler then rejects junk and
        // reverts to the previous value instead of the browser silently
        // stripping the input down to an empty string (which would be
        // misread as a legitimate clear and PATCH null to the API).
        property.type === 'number'
          ? 'text'
          : property.type === 'date'
            ? 'date'
            : property.type === 'url'
              ? 'url'
              : 'text'
      }
      inputMode={property.type === 'number' ? 'decimal' : undefined}
      className={`cell-input cell-input-${property.type}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      placeholder={property.type === 'date' ? '' : 'Empty'}
      data-testid={`cell-input-${property.id}`}
      aria-label={property.name}
    />
  );
}

// ----- Select popover (select / multi_select) -----

function SelectPopover({
  property,
  value,
  rowId,
  onCommit,
  onCancel,
  onDatabaseMutated,
}: CellEditorBaseProps) {
  const isMulti = property.type === 'multi_select';
  const options = property.options ?? [];
  const selectedIds: string[] = isMulti
    ? Array.isArray(value)
      ? (value as unknown[]).filter((v): v is string => typeof v === 'string')
      : []
    : typeof value === 'string'
      ? [value]
      : [];
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [creating]);

  const toggle = (id: string) => {
    if (isMulti) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id];
      onCommit(next);
    } else {
      onCommit(id);
    }
  };

  const clear = () => {
    onCommit(isMulti ? [] : null);
  };

  const createOption = async () => {
    const label = newLabel.trim();
    if (label === '' || busy) return;
    // DEF-003: do not allow a duplicate option label. If an option with
    // the same label (case-insensitive) already exists, just toggle the
    // existing option onto the row — never POST/PATCH the property.
    const existing = options.find(
      (o) => o.label.trim().toLowerCase() === label.toLowerCase()
    );
    if (existing) {
      if (isMulti) {
        const next = selectedIds.includes(existing.id)
          ? selectedIds.filter((x) => x !== existing.id)
          : [...selectedIds, existing.id];
        onCommit(next);
      } else {
        onCommit(existing.id);
      }
      setCreating(false);
      setNewLabel('');
      return;
    }
    setBusy(true);
    try {
      const next = nextOptionColor(options);
      const created: PropertyOption = {
        id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        color: next,
      };
      const merged = [...options, created];
      const updated = await api.updateProperty(property.id, { options: merged });
      onDatabaseMutated?.();
      if (isMulti) {
        onCommit([...selectedIds, created.id]);
      } else {
        onCommit(created.id);
      }
      // Keep the new option in sync if the parent doesn't refetch.
      property.options = updated.options ?? merged;
      setCreating(false);
      setNewLabel('');
    } catch {
      // Surface failure by leaving the popover open; user can retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="select-popover"
      data-testid={`select-popover-${rowId}-${property.id}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="select-popover-list" role="listbox">
        {options.length === 0 && !creating && (
          <div className="select-popover-empty">No options yet</div>
        )}
        {options.map((opt) => {
          const selected = selectedIds.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={`select-popover-item ${selected ? 'is-selected' : ''}`}
              onClick={() => toggle(opt.id)}
              data-testid={`select-option-${opt.id}`}
            >
              <OptionChip option={opt} />
              {selected && <span className="select-popover-check" aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
      <div className="select-popover-divider" />
      {creating ? (
        <form
          className="select-popover-create"
          onSubmit={(e) => {
            e.preventDefault();
            void createOption();
          }}
        >
          <input
            ref={inputRef}
            className="select-popover-create-input"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New option label"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setCreating(false);
                setNewLabel('');
              }
            }}
            data-testid={`select-create-input-${property.id}`}
          />
          <button
            type="submit"
            className="btn btn-primary select-popover-create-submit"
            disabled={busy || newLabel.trim() === ''}
            data-testid={`select-create-submit-${property.id}`}
          >
            Add
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="select-popover-create-toggle"
          onClick={() => setCreating(true)}
          data-testid={`select-create-toggle-${property.id}`}
        >
          <span aria-hidden="true">+</span> Create option
        </button>
      )}
      <div className="select-popover-divider" />
      <button
        type="button"
        className="select-popover-clear"
        onClick={clear}
        data-testid={`select-clear-${property.id}`}
      >
        {isMulti ? 'Clear all' : 'Clear'}
      </button>
      <div className="select-popover-footer">
        <button
          type="button"
          className="btn btn-ghost select-popover-close"
          onClick={onCancel}
          data-testid={`select-close-${property.id}`}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ----- Cell container -----

/** A clickable cell that opens the right editor for the property type.
 *  Always renders the display; opens the editor when the user clicks
 *  (or for checkbox, toggles immediately on click). */
export function CellEditor(props: CellEditorBaseProps) {
  const { property, value, onCommit, onCancel, rowId, autoFocus = true, onDatabaseMutated } = props;
  const [editing, setEditing] = useState(false);

  if (isInlineEditor(property.type)) {
    if (!editing) {
      return (
        <button
          type="button"
          className="cell cell-display-button"
          onClick={() => setEditing(true)}
          data-testid={`cell-button-${rowId}-${property.id}`}
        >
          <CellDisplay property={property} value={value} rowId={rowId} />
        </button>
      );
    }
    return (
      <InlineEditor
        property={property}
        value={value}
        rowId={rowId}
        autoFocus={autoFocus}
        onCommit={(v) => {
          onCommit(v);
          setEditing(false);
        }}
        onCancel={() => {
          setEditing(false);
          onCancel();
        }}
      />
    );
  }

  if (property.type === 'checkbox') {
    return (
      <button
        type="button"
        className={`cell-checkbox-toggle ${value === true ? 'is-checked' : ''}`}
        onClick={() => onCommit(!value)}
        aria-label={`${property.name}: toggle`}
        data-testid={`cell-checkbox-toggle-${rowId}-${property.id}`}
      >
        <CellDisplay property={property} value={value} rowId={rowId} />
      </button>
    );
  }

  // Select / multi_select: click to open a popover.
  return (
    <div className="cell-popover-host">
      <button
        type="button"
        className="cell cell-display-button"
        onClick={() => setEditing((e) => !e)}
        data-testid={`cell-button-${rowId}-${property.id}`}
      >
        <CellDisplay property={property} value={value} rowId={rowId} />
      </button>
      {editing && (
        <SelectPopover
          property={property}
          value={value}
          rowId={rowId}
          autoFocus={autoFocus}
          onCommit={(v) => {
            onCommit(v);
            if (property.type === 'select') setEditing(false);
          }}
          onCancel={() => {
            setEditing(false);
            onCancel();
          }}
          onDatabaseMutated={onDatabaseMutated}
        />
      )}
    </div>
  );
}
