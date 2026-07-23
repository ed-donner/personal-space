// Add-property menu: a name input + a type picker. The type is shown with a
// little label so the user knows it will be fixed once chosen.

import { useState } from "react";
import type { PropertyDraft, PropertyType } from "../types";
import { Popover } from "./Popover";

interface Props {
  onAdd: (draft: PropertyDraft) => void | Promise<unknown>;
}

const TYPES: { type: PropertyType; label: string; hint: string }[] = [
  { type: "text", label: "Text", hint: "Free-form text" },
  { type: "number", label: "Number", hint: "Numeric value" },
  { type: "select", label: "Select", hint: "One of a list" },
  { type: "multiSelect", label: "Multi-select", hint: "Many of a list" },
  { type: "date", label: "Date", hint: "Calendar date" },
  { type: "checkbox", label: "Checkbox", hint: "On / off" },
  { type: "url", label: "URL", hint: "Web link" },
];

export function AddPropertyMenu({ onAdd }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");

  const submit = async (close: () => void) => {
    const n = name.trim();
    if (!n) return;
    await onAdd({ name: n, type });
    setName("");
    setType("text");
    close();
  };

  return (
    <Popover
      className="popover-wide"
      trigger={(open, ref) => (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          className="col-add"
          aria-label="New property"
          title="Add a property"
          onClick={open}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 3 V13 M3 8 H13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    >
      {(close) => (
        <form
          className="add-prop-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(close);
          }}
        >
          <div className="add-prop-row">
            <label className="add-prop-label" htmlFor="add-prop-name">
              Name
            </label>
            <input
              id="add-prop-name"
              type="text"
              autoFocus
              className="add-prop-name-input"
              value={name}
              placeholder="Property"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="add-prop-label">Type</div>
          <div className="add-prop-types">
            {TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                className="add-prop-type"
                data-selected={type === t.type}
                onClick={() => setType(t.type)}
              >
                <span className="add-prop-type-label">{t.label}</span>
                <span className="add-prop-type-hint">{t.hint}</span>
              </button>
            ))}
          </div>
          <div className="add-prop-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim()}
            >
              Add property
            </button>
          </div>
        </form>
      )}
    </Popover>
  );
}
