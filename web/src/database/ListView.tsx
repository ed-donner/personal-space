// List view: compact rows, row title plus up to two property values
// rendered as small chips. Filters and sort come from the toolbar.

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { OptionChip } from './CellEditor';
import { api, type DatabaseResponse, type Property, type RowPage } from '../lib/api';
import { applyFilters, applySort } from './views';

interface ListViewProps {
  database: DatabaseResponse;
  onMutated: () => void;
}

export function ListView({ database, onMutated }: ListViewProps) {
  const navigate = useNavigate();
  const settings = database.views.list ?? {};
  const properties = database.properties;

  const rows = useMemo(() => {
    const filtered = applyFilters(database.rows, settings.filters, properties);
    return applySort(filtered, settings.sort, properties);
  }, [database.rows, settings.filters, settings.sort, properties]);

  const [deleting, setDeleting] = useState<RowPage | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [creatingRow, setCreatingRow] = useState(false);

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.deleteRow(deleting.id);
      setDeleting(null);
      onMutated();
    } catch {
      setDeleting(null);
    } finally {
      setDeletingBusy(false);
    }
  };

  const addRow = async () => {
    setCreatingRow(true);
    try {
      const created = await api.createRow(database.page.id, { title: 'Untitled' });
      onMutated();
      navigate(`/page/${created.id}`);
    } catch {
      onMutated();
    } finally {
      setCreatingRow(false);
    }
  };

  return (
    <div className="list-view" data-testid="list-view">
      {rows.length === 0 ? (
        <div className="list-empty" data-testid="list-empty">
          No rows match the current filters.
        </div>
      ) : (
        <ul className="list-rows" data-testid="list-rows">
          {rows.map((row) => (
            <ListRow
              key={row.id}
              row={row}
              properties={properties}
              onOpen={() => navigate(`/page/${row.id}`)}
              onDelete={() => setDeleting(row)}
            />
          ))}
        </ul>
      )}
      <div className="list-add-row-bar">
        <button
          type="button"
          className="list-add-row-button"
          onClick={() => void addRow()}
          disabled={creatingRow}
          data-testid="list-add-row"
        >
          <span aria-hidden="true" className="list-add-row-plus">+</span>
          {creatingRow ? 'Adding row...' : 'New row'}
        </button>
      </div>
      {deleting ? (
        <ConfirmDeleteModal
          pageTitle={deleting.title || 'Untitled'}
          noun="row"
          message={`The row "${deleting.title || 'Untitled'}" will be permanently removed from this database.`}
          warning="The row and any blocks written under it are deleted. This cannot be undone."
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
          isPending={deletingBusy}
        />
      ) : null}
    </div>
  );
}

function ListRow({
  row,
  properties,
  onOpen,
  onDelete,
}: {
  row: RowPage;
  properties: Property[];
  onOpen: () => void;
  onDelete: () => void;
}) {
  const chips = useMemo(() => listRowChips(row, properties), [row, properties]);
  return (
    <li className="list-row" data-testid={`list-row-${row.id}`}>
      <Link
        to={`/page/${row.id}`}
        className="list-row-title"
        onClick={(e) => {
          // The card uses navigate so the same handler works; we still
          // want the link to be a real <a> for accessibility.
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          onOpen();
        }}
        data-testid={`list-row-title-${row.id}`}
      >
        {row.title || 'Untitled'}
      </Link>
      <div className="list-row-chips" data-testid={`list-row-chips-${row.id}`}>
        {chips.map((c, i) => (
          <span
            key={i}
            className="list-row-chip"
            data-testid={`list-row-chip-${row.id}-${i}`}
          >
            {c}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="list-row-action is-danger"
        onClick={onDelete}
        aria-label="Delete row"
        data-testid={`list-row-delete-${row.id}`}
      >
        x
      </button>
    </li>
  );
}

/** Build up to two property chips for a list row. */
function listRowChips(row: RowPage, properties: Property[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  for (const p of properties) {
    if (out.length >= 2) break;
    const v = (row.values ?? {})[p.id];
    if (v == null || v === '' || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (p.type === 'select') {
      const opt = (p.options ?? []).find((o) => o.id === v);
      if (opt) out.push(<OptionChip key={`${p.id}-${opt.id}`} option={opt} />);
    } else if (p.type === 'multi_select' && Array.isArray(v)) {
      for (const id of v.slice(0, 2 - out.length)) {
        const opt = (p.options ?? []).find((o) => o.id === id);
        if (opt) out.push(<OptionChip key={`${p.id}-${opt.id}`} option={opt} />);
      }
    } else if (p.type === 'date' && typeof v === 'string') {
      out.push(
        <span key={p.id} className="list-row-chip-text">
          {v.slice(0, 10)}
        </span>
      );
    } else if (typeof v === 'string' || typeof v === 'number') {
      out.push(
        <span key={p.id} className="list-row-chip-text">
          {String(v)}
        </span>
      );
    }
  }
  return out;
}
