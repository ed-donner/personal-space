// Select / multi-select dropdown for property cells.
//
// Features:
//   - type-to-filter existing options
//   - "Create '<typed>'" affordance to add a new option on the fly
//   - assigned color comes from a rotating palette (the rotating logic lives
//     in databaseStore.addOption — we just pass the user's typed label)
//   - "no value" for single-select
//   - chip multi-select with removable tags
//
// Cell-level editing is driven from the parent (DatabaseView) which owns
// the property and row; we just render the UI and emit change events.

import { useMemo, useRef, useState } from "react";
import type { OptionColor, Property, PropertyOption } from "../types";
import { OPTION_PALETTE } from "../databaseStore";
import { Popover } from "./Popover";

interface BaseProps {
  property: Property;
  disabled?: boolean;
  className?: string;
  /** Display-only chips (used in the table cell for the closed state). */
  readOnlyChips?: boolean;
  /** Trigger label, e.g. "Select" / "Choose". Defaults to the property name. */
  placeholder?: string;
}

interface SingleProps extends BaseProps {
  multi?: false;
  value: string | null;
  onChange: (optionId: string | null) => void;
  onCreateOption?: (label: string) => Promise<PropertyOption> | PropertyOption;
}

interface MultiProps extends BaseProps {
  multi: true;
  value: string[];
  onChange: (optionIds: string[]) => void;
  onCreateOption?: (label: string) => Promise<PropertyOption> | PropertyOption;
}

type Props = SingleProps | MultiProps;

function colorVar(c: OptionColor): { bg: string; fg: string } {
  // The swatches are defined in CSS via CSS variables.
  return {
    bg: `var(--chip-${c}-bg)`,
    fg: `var(--chip-${c}-fg)`,
  };
}

function OptionChip({ option }: { option: PropertyOption }) {
  const { bg, fg } = colorVar(option.color);
  return (
    <span className="opt-chip" style={{ background: bg, color: fg }}>
      <span className="opt-chip-dot" style={{ background: fg, opacity: 0.5 }} />
      {option.label}
    </span>
  );
}

export function SelectDropdown(props: Props) {
  const isMulti = props.multi === true;
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = props.property.options;
  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // (No special open hook; the parent Popover calls renderTrigger when opening
  // and the input is auto-focused inside renderPanel.)

  const onSelect = (optionId: string) => {
    if (isMulti) {
      const current = (props as MultiProps).value;
      const next = current.includes(optionId)
        ? current.filter((x) => x !== optionId)
        : [...current, optionId];
      (props as MultiProps).onChange(next);
    } else {
      (props as SingleProps).onChange(optionId);
    }
  };

  const onCreate = async (label: string) => {
    if (!props.onCreateOption) return;
    setCreating(true);
    try {
      const opt = await props.onCreateOption(label.trim());
      // After creating, pick it.
      if (isMulti) {
        const current = (props as MultiProps).value;
        (props as MultiProps).onChange([...current, opt.id]);
      } else {
        (props as SingleProps).onChange(opt.id);
      }
      setQuery("");
    } finally {
      setCreating(false);
    }
  };

  // ----- Renders the closed trigger (the cell value) -----
  const renderTrigger = (open: () => void, ref: React.Ref<HTMLElement>) => {
    const selectedOpts = isMulti
      ? options.filter((o) => (props as MultiProps).value.includes(o.id))
      : options.filter((o) => (props as SingleProps).value === o.id);
    const empty = selectedOpts.length === 0;
    const placeholder = props.placeholder ?? (empty ? "Empty" : "");
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        className={`cell-trigger cell-trigger-select ${props.className ?? ""}`}
        data-empty={empty}
        disabled={props.disabled}
        onClick={open}
      >
        {empty ? (
          <span className="cell-empty">{placeholder}</span>
        ) : isMulti ? (
          <span className="opt-chip-group">
            {selectedOpts.map((o) => (
              <OptionChip key={o.id} option={o} />
            ))}
          </span>
        ) : (
          <OptionChip option={selectedOpts[0]} />
        )}
      </button>
    );
  };

  // ----- Renders the popover body -----
  const renderPanel = (close: () => void) => {
    const selectedIds = isMulti
      ? new Set((props as MultiProps).value)
      : new Set<string>(((props as SingleProps).value ?? "").split(",").filter(Boolean));
    const showCreate =
      props.onCreateOption &&
      query.trim().length > 0 &&
      !options.some(
        (o) => o.label.toLowerCase() === query.trim().toLowerCase(),
      );
    return (
      <div className="select-panel">
        <div className="select-input-wrap">
          <input
            ref={inputRef}
            type="text"
            className="select-input"
            value={query}
            placeholder="Find or create…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (showCreate) {
                  void onCreate(query.trim());
                } else if (filtered.length === 1) {
                  onSelect(filtered[0].id);
                  if (!isMulti) close();
                }
              } else if (e.key === "Backspace" && query === "" && isMulti) {
                // Backspace on empty query drops the last chip in multi mode.
                const current = (props as MultiProps).value;
                if (current.length > 0) {
                  (props as MultiProps).onChange(current.slice(0, -1));
                }
              }
            }}
          />
        </div>
        <div className="select-list" role="listbox">
          {filtered.length === 0 && !showCreate && (
            <div className="select-empty">No matches</div>
          )}
          {filtered.map((o) => {
            const selected = selectedIds.has(o.id);
            return (
              <button
                key={o.id}
                type="button"
                className="select-row"
                data-selected={selected}
                onClick={() => {
                  onSelect(o.id);
                  if (!isMulti) close();
                }}
              >
                <OptionChip option={o} />
                {isMulti && selected && (
                  <span className="select-check" aria-hidden="true">
                    &#10003;
                  </span>
                )}
              </button>
            );
          })}
          {showCreate && (
            <button
              type="button"
              className="select-row select-create"
              onClick={() => void onCreate(query.trim())}
              disabled={creating}
            >
              <span className="select-create-label">
                Create <strong>“{query.trim()}”</strong>
              </span>
              <span
                className="opt-chip opt-chip-swatch"
                style={(() => {
                  const c =
                    OPTION_PALETTE[
                      options.length % OPTION_PALETTE.length
                    ];
                  return { background: `var(--chip-${c}-bg)`, color: `var(--chip-${c}-fg)` };
                })()}
              >
                {query.trim()}
              </span>
            </button>
          )}
        </div>
        {!isMulti && (
          <div className="select-footer">
            <button
              type="button"
              className="select-clear"
              onClick={() => {
                (props as SingleProps).onChange(null);
                close();
              }}
            >
              Clear value
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Popover trigger={renderTrigger}>{renderPanel}</Popover>
  );
}
