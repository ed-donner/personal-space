// Column header menu for the database table.
//
// The header shows the property name (click to rename inline), a subtle
// label for the type (since type is fixed), and a small popover trigger
// that opens a popover with Rename / Delete actions.

import { useEffect, useRef, useState } from "react";
import type { Property, PropertyType } from "../types";
import { Popover } from "./Popover";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  property: Property;
  onRename: (name: string) => void | Promise<unknown>;
  onDelete: () => void | Promise<unknown>;
}

const TYPE_LABELS: Record<PropertyType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multiSelect: "Multi-select",
  date: "Date",
  checkbox: "Checkbox",
  url: "URL",
};

export function PropertyHeaderMenu({ property, onRename, onDelete }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  if (renaming) {
    return (
      <input
        ref={inputRef}
        type="text"
        autoFocus
        className="prop-name-input"
        defaultValue={property.name}
        onBlur={(e) => {
          const next = e.currentTarget.value.trim();
          if (next && next !== property.name) void onRename(next);
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
    );
  }

  return (
    <>
      <button
        type="button"
        className="col-name"
        onClick={() => setRenaming(true)}
        title={`${property.name} (${TYPE_LABELS[property.type]})`}
      >
        {property.name}
        <span className="col-type">{TYPE_LABELS[property.type]}</span>
      </button>
      <Popover
        trigger={(open, ref) => (
          <button
            ref={ref as React.Ref<HTMLButtonElement>}
            type="button"
            className="col-menu-btn"
            aria-label={`${property.name} options`}
            onClick={open}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3" cy="8" r="1.3" />
              <circle cx="8" cy="8" r="1.3" />
              <circle cx="13" cy="8" r="1.3" />
            </svg>
          </button>
        )}
      >
        {(close) => (
          <div className="col-menu">
            <button
              type="button"
              className="col-menu-item"
              onClick={() => {
                close();
                setRenaming(true);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="col-menu-item col-menu-danger"
              onClick={() => {
                close();
                setConfirmingDelete(true);
              }}
            >
              Delete property
            </button>
          </div>
        )}
      </Popover>
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete property"
          body={
            <>
              Delete the <strong>{property.name}</strong> property? All values
              for it across this database will be removed.
            </>
          }
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmingDelete(false);
            void onDelete();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  );
}
