// RowPageView: a row is a page with `type === "row"`. We render:
//   - a header with the row's icon and an editable title
//   - a breadcrumb / back-link to the parent database
//   - a properties panel listing each property with the same editor as in
//     the table cell
//   - the Phase 2 BlockEditor below
//
// The properties panel is "above" the editor; both persist independently.

import { useEffect, useMemo, useState } from "react";
import { usePages } from "../store";
import { useDatabase } from "../databaseStore";
import { BlockEditor } from "./BlockEditor";
import { CellEditor } from "./CellEditor";
import { SelectDropdown } from "./SelectDropdown";
import type { CellValue, Page, Property } from "../types";

interface Props {
  row: Page;
}

export function RowPageView({ row }: Props) {
  const { pages, select, update } = usePages();
  const parent = useMemo(
    () => pages.find((p) => p.id === row.parentId) ?? null,
    [pages, row.parentId],
  );
  const load = useDatabase((s) => s.load);
  const databaseId = useDatabase((s) => s.databaseId);
  const properties = useDatabase((s) => s.properties);
  const rows = useDatabase((s) => s.rows);
  const pending = useDatabase((s) => s.pending);
  const updateRowValue = useDatabase((s) => s.updateRowValue);
  const renameRow = useDatabase((s) => s.renameRow);
  const addOption = useDatabase((s) => s.addOption);

  useEffect(() => {
    if (row.parentId) {
      if (databaseId !== row.parentId) void load(row.parentId);
    }
  }, [row.parentId, databaseId, load]);

  const data = rows.find((r) => r.id === row.id);
  const [renaming, setRenaming] = useState(false);

  return (
    <article className="row-page" data-row-id={row.id}>
      <header className="page-header db-header">
        <div className="page-icon" aria-hidden="true">
          {row.icon || "📄"}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          {renaming ? (
            <input
              type="text"
              autoFocus
              className="db-title-input"
              defaultValue={row.title}
              onBlur={(e) => {
                const next = e.currentTarget.value.trim();
                if (next && next !== row.title) {
                  if (data) {
                    void renameRow(row.id, next);
                  } else {
                    void update(row.id, { title: next });
                  }
                }
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
              {row.title || "Untitled"}
            </h1>
          )}
          <div className="page-meta">
            <span className="page-meta-tag">row</span>
            {parent && (
              <button
                type="button"
                className="row-breadcrumb"
                onClick={() => select(parent.id)}
              >
                <span aria-hidden="true">←</span> {parent.icon || "🗃️"}{" "}
                {parent.title}
              </button>
            )}
          </div>
        </div>
      </header>

      {parent && properties.length > 0 && (
        <section className="row-props" aria-label="Properties">
          {properties.map((p) => {
            const key = `${row.id}:${p.id}`;
            const saving = pending.has(key);
            return (
              <div className="row-prop" key={p.id}>
                <div className="row-prop-name">{p.name}</div>
                <div className="row-prop-value" data-saving={saving}>
                  <RowPropertyCell
                    property={p}
                    value={(data?.values ?? {})[p.id] ?? null}
                    saving={saving}
                    onCommit={(next) => updateRowValue(row.id, p.id, next)}
                    onCreateOption={async (label) => {
                      const updated = await addOption(p.id, label);
                      return updated.options[updated.options.length - 1];
                    }}
                  />
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="page-body">
        <BlockEditor pageId={row.id} />
      </section>
    </article>
  );
}

function RowPropertyCell({
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
