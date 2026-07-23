// ListView: a compact list of rows. Each row shows the row's title and
// up to two property values rendered compactly (chips for select /
// multiSelect, formatted dates, check icons, plain text for the rest).
//
// The properties shown are taken from `settings.listProps`. If none is
// set, the view falls back to a sensible default from viewLogic.

import { useMemo } from "react";
import type { CellValue, Property, Row } from "../types";
import { useDatabase } from "../databaseStore";
import { usePages } from "../store";
import { defaultListProps, renderCellValue, visibleRows } from "../viewLogic";

interface ListViewProps {
  databaseId: string;
  properties: Property[];
  rows: Row[];
  listProps: string[];
}

export function ListView({
  databaseId,
  properties,
  rows,
  listProps,
}: ListViewProps) {
  const settings = useDatabase((s) => s.views.list);
  const visible = useMemo(
    () => visibleRows(rows, settings, properties),
    [rows, settings, properties],
  );
  const propsToShow = useMemo(() => {
    if (listProps.length > 0) {
      return listProps
        .map((id) => properties.find((p) => p.id === id))
        .filter((p): p is Property => !!p);
    }
    return defaultListProps(properties)
      .map((id) => properties.find((p) => p.id === id))
      .filter((p): p is Property => !!p);
  }, [properties, listProps]);

  if (visible.length === 0) {
    return (
      <div className="list-empty">
        <div className="list-empty-icon" aria-hidden="true">📃</div>
        <h2 className="list-empty-title">No rows here</h2>
        <p className="list-empty-sub">
          {rows.length === 0
            ? "Add a row in the table view to see it here."
            : "Adjust your filters or sort to see more."}
        </p>
      </div>
    );
  }

  return (
    <div className="list-view" data-database-id={databaseId}>
      <ul className="list-rows">
        {visible.map((r) => (
          <ListRow
            key={r.id}
            row={r}
            properties={propsToShow}
            onOpen={() => openRow(r.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function openRow(rowId: string) {
  const row = useDatabase.getState().rows.find((r) => r.id === rowId);
  if (!row) return;
  const page = useDatabase.getState().ensureRowInPages(row);
  if (page) usePages.getState().select(page.id);
}

function ListRow({
  row,
  properties,
  onOpen,
}: {
  row: Row;
  properties: Property[];
  onOpen: () => void;
}) {
  return (
    <li className="list-row" data-row-id={row.id}>
      <button type="button" className="list-row-title" onClick={onOpen}>
        <span className="list-row-bullet" aria-hidden="true">
          •
        </span>
        <span className="list-row-title-text">{row.title || "Untitled"}</span>
      </button>
      {properties.length > 0 && (
        <div className="list-row-props">
          {properties.map((p) => {
            const v = row.values[p.id] ?? null;
            return (
              <ListCellValue
                key={p.id}
                property={p}
                value={v}
              />
            );
          })}
        </div>
      )}
    </li>
  );
}

function ListCellValue({ property, value }: { property: Property; value: CellValue }) {
  const rendered = renderCellValue(property, value);
  if (!rendered) {
    return (
      <span className="list-row-prop list-row-prop-empty" title={property.name}>
        —
      </span>
    );
  }
  if (rendered.kind === "chip" && property.type === "select") {
    const opt = property.options.find((o) => o.label === rendered.text);
    if (opt) {
      return (
        <span
          className="opt-chip"
          style={{
            background: `var(--chip-${opt.color}-bg)`,
            color: `var(--chip-${opt.color}-fg)`,
          }}
          title={property.name}
        >
          <span
            className="opt-chip-dot"
            style={{
              background: `var(--chip-${opt.color}-fg)`,
              opacity: 0.5,
            }}
          />
          {rendered.text}
        </span>
      );
    }
  }
  if (rendered.kind === "chip" && property.type === "multiSelect") {
    // Render multiSelect as joined text — already pretty short.
    return (
      <span className="list-row-prop list-row-prop-text" title={property.name}>
        {rendered.text}
      </span>
    );
  }
  if (rendered.kind === "check") {
    return (
      <span
        className="list-row-prop list-row-prop-check"
        title={property.name}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3 8.5 L6.5 12 L13 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {property.name}
      </span>
    );
  }
  if (rendered.kind === "date") {
    return (
      <span className="list-row-prop list-row-prop-date" title={property.name}>
        {rendered.text}
      </span>
    );
  }
  return (
    <span className="list-row-prop list-row-prop-text" title={property.name}>
      {rendered.text}
    </span>
  );
}
