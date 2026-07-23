// CellEditor: a type-appropriate in-place editor for a single property cell.
//
// One component, seven types. Each type is a small subcomponent. The parent
// (DatabaseView / RowPageView) owns the Property + value and the save logic;
// we just emit `onCommit` with the new value. The cell shows the live value
// while a save is pending so the user gets immediate feedback.

import { useEffect, useState } from "react";
import type { CellValue, Property } from "../types";
import { SelectDropdown } from "./SelectDropdown";

interface Props {
  property: Property;
  value: CellValue;
  /** Render in read-only mode (e.g. closed state inside a multi-select cell). */
  readOnly?: boolean;
  saving?: boolean;
  onCommit: (next: CellValue | null) => void;
  /** When true, the cell auto-enters edit mode (used by row page property panel). */
  autoFocus?: boolean;
  /** Optional class for the wrapper (e.g. "cell-title" for the title column). */
  className?: string;
}

export function CellEditor(props: Props) {
  const { property, value, onCommit, readOnly, saving } = props;
  switch (property.type) {
    case "text":
      return <TextCell {...props} />;
    case "number":
      return <NumberCell {...props} />;
    case "url":
      return <UrlCell {...props} />;
    case "date":
      return <DateCell {...props} />;
    case "checkbox":
      return <CheckboxCell {...props} />;
    case "select":
      return (
        <SelectCell
          property={property}
          value={typeof value === "string" ? value : null}
          onCommit={(v) => onCommit(v)}
          readOnly={readOnly}
          saving={saving}
        />
      );
    case "multiSelect":
      return (
        <MultiSelectCell
          property={property}
          value={
            Array.isArray(value)
              ? (value as string[])
              : typeof value === "string" && value
                ? [value]
                : []
          }
          onCommit={(v) => onCommit(v)}
          readOnly={readOnly}
          saving={saving}
        />
      );
  }
}

// ---- text ----

function TextCell({ value, onCommit, readOnly, className }: Props) {
  const [local, setLocal] = useState(stringValue(value));
  useEffect(() => {
    setLocal(stringValue(value));
  }, [value]);
  return (
    <input
      type="text"
      className={`cell-input cell-input-text ${className ?? ""}`}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setLocal(stringValue(value));
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      readOnly={readOnly}
      placeholder=""
    />
  );
}

// ---- number ----

function NumberCell({ value, onCommit, readOnly, className }: Props) {
  const [local, setLocal] = useState(numberToString(value));
  useEffect(() => {
    setLocal(numberToString(value));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      className={`cell-input cell-input-number ${className ?? ""}`}
      value={local}
      onChange={(e) => {
        const next = e.target.value;
        // Allow empty / minus / decimal typing.
        if (next === "" || /^-?\d*\.?\d*$/.test(next)) {
          setLocal(next);
        }
      }}
      onBlur={() => {
        const parsed = local === "" ? null : Number(local);
        if (parsed !== value) onCommit(parsed);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setLocal(numberToString(value));
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      readOnly={readOnly}
    />
  );
}

// ---- url ----

/**
 * True iff `s` is a non-empty absolute http:// or https:// URL. Anything
 * else — `javascript:`, `data:`, relative paths, bare words — is treated as
 * not a link target so it can never render as a clickable navigation
 * (DEF-005).
 *
 * Exported so tests and other modules can share the same definition.
 */
export function isHttpUrl(s: string): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  return /^https?:\/\//i.test(trimmed);
}

function UrlCell({ value, onCommit, readOnly, className }: Props) {
  const v = stringValue(value);
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(v);
  // Tracks a non-http(s) draft so the input can show an inline hint while the
  // user is still typing. Cleared on Escape / successful commit.
  const [showInvalidHint, setShowInvalidHint] = useState(false);

  useEffect(() => {
    setLocal(v);
    setShowInvalidHint(false);
  }, [v]);

  if (readOnly) {
    return <span className="cell-readonly">{v}</span>;
  }

  if (!editing) {
    const linkable = isHttpUrl(v);
    return (
      <div className={`cell-url-wrap ${className ?? ""}`}>
        {v ? (
          <>
            {linkable ? (
              <button
                type="button"
                className="cell-url-text"
                onClick={() => setEditing(true)}
                title={v}
              >
                {v}
              </button>
            ) : (
              // Legacy / invalid URL: render the raw value as plain text.
              // Never expose it as a clickable link target (DEF-005).
              <span
                className="cell-url-text cell-url-text-invalid"
                title={v}
                data-testid="cell-url-text"
              >
                {v}
              </span>
            )}
            {linkable && (
              <a
                className="cell-url-open"
                href={v}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Open link"
                onClick={(e) => e.stopPropagation()}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M6 3 H3 V13 H13 V10 M9 3 H13 V7 M8 8 L13 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            )}
          </>
        ) : (
          <button
            type="button"
            className="cell-url-add"
            onClick={() => setEditing(true)}
            aria-label="Add link"
          >
            + Add link
          </button>
        )}
      </div>
    );
  }

  // Editing mode. Live-validate the draft so we can show a hint and block
  // the commit on bad input (DEF-005).
  const draftInvalid = local.length > 0 && !isHttpUrl(local);

  return (
    <div className="cell-url-edit">
      <input
        autoFocus
        type="text"
        className={`cell-input cell-input-url ${className ?? ""} ${
          draftInvalid ? "cell-input-invalid" : ""
        }`}
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          setShowInvalidHint(e.target.value.length > 0 && !isHttpUrl(e.target.value));
        }}
        onBlur={() => {
          setEditing(false);
          setShowInvalidHint(false);
          // Empty draft is a clear; invalid draft is dropped (null) so the
          // cell never persists a non-http(s) value. The user can re-enter
          // the cell with a corrected URL.
          let next: string | null;
          if (local === "" || isHttpUrl(local)) next = local;
          else next = null;
          if (next !== v) onCommit(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setLocal(v);
            setShowInvalidHint(false);
            setEditing(false);
          }
        }}
        placeholder="https://"
        aria-invalid={draftInvalid}
      />
      {showInvalidHint && (
        <span className="cell-url-hint" role="status">
          Use a full https:// link
        </span>
      )}
    </div>
  );
}

// ---- date ----

function formatDate(iso: string | null): string {
  if (!iso) return "";
  // iso is 'YYYY-MM-DD'; render '12 Mar 2026'.
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

function DateCell({ value, onCommit, readOnly, className }: Props) {
  const v = typeof value === "string" ? value : null;
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(v ?? "");

  useEffect(() => {
    setLocal(v ?? "");
  }, [v]);

  if (readOnly) {
    return <span className="cell-readonly">{formatDate(v)}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`cell-date-display ${className ?? ""}`}
        data-empty={!v}
        onClick={() => setEditing(true)}
      >
        {v ? formatDate(v) : <span className="cell-empty">Empty</span>}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="date"
      className={`cell-input cell-input-date ${className ?? ""}`}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const next = local === "" ? null : local;
        if (next !== v) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setLocal(v ?? "");
          setEditing(false);
        }
      }}
    />
  );
}

// ---- checkbox ----

function CheckboxCell({ value, onCommit, readOnly, saving }: Props) {
  const checked = value === true;
  return (
    <button
      type="button"
      className="cell-checkbox"
      data-checked={checked}
      data-saving={saving}
      onClick={() => !readOnly && onCommit(!checked)}
      aria-pressed={checked}
      aria-label={checked ? "Checked" : "Unchecked"}
      disabled={readOnly}
    >
      <span className="cell-checkbox-box" aria-hidden="true">
        {checked && (
          <svg width="10" height="10" viewBox="0 0 16 16">
            <path
              d="M3 8.5 L6.5 12 L13 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
}

// ---- select ----

function SelectCell({
  property,
  value,
  onCommit,
  readOnly,
  saving: _saving,
}: {
  property: Property;
  value: string | null;
  onCommit: (next: string | null) => void;
  readOnly?: boolean;
  saving?: boolean;
}) {
  return (
    <SelectDropdown
      property={property}
      value={value}
      readOnlyChips={readOnly}
      onChange={(v) => onCommit(v)}
    />
  );
}

// ---- multiSelect ----

function MultiSelectCell({
  property,
  value,
  onCommit,
  readOnly,
  saving: _saving,
}: {
  property: Property;
  value: string[];
  onCommit: (next: string[]) => void;
  readOnly?: boolean;
  saving?: boolean;
}) {
  return (
    <SelectDropdown
      property={property}
      multi
      value={value}
      readOnlyChips={readOnly}
      onChange={(v) => onCommit(v)}
    />
  );
}

// ---- helpers ----

function stringValue(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.join(", ");
  return "";
}

function numberToString(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (Number.isFinite(v)) return String(v);
    return "";
  }
  if (typeof v === "string") {
    // accept existing numeric string
    if (/^-?\d*\.?\d*$/.test(v)) return v;
  }
  return "";
}
