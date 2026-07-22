import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type DatabaseResponse, type Property, type PropertyType, type PropertyOption } from '../lib/api';
import { PROPERTY_TYPE_CUES, PROPERTY_TYPE_LABELS, PROPERTY_TYPES } from './helpers';
import { CellEditor } from './CellEditor';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { applyFilters, applySort } from './views';
import { TITLE_PROPERTY_ID } from './views';

interface TableViewProps {
  database: DatabaseResponse;
  /** Called when the data changes; the parent should refetch. */
  onMutated: () => void;
}

type PropertyHeaderMenuState =
  | { kind: 'closed' }
  | { kind: 'open'; propertyId: string }
  | { kind: 'renaming'; propertyId: string; draft: string };

type NewPropertyState =
  | { kind: 'closed' }
  | { kind: 'open' }
  | { kind: 'submitting' };

type RowDeleteState =
  | { kind: 'closed' }
  | { kind: 'open'; rowId: string; title: string };

/** The Phase 3 table view. Renders the database rows as a designed data
 *  table with in-place cell editors, plus property and row management. */
export function TableView({ database, onMutated }: TableViewProps) {
  const navigate = useNavigate();
  const [propertyMenu, setPropertyMenu] = useState<PropertyHeaderMenuState>({ kind: 'closed' });
  const [newProperty, setNewProperty] = useState<NewPropertyState>({ kind: 'closed' });
  const [newPropertyName, setNewPropertyName] = useState('');
  const [newPropertyType, setNewPropertyType] = useState<PropertyType>('text');
  const [deletingProperty, setDeletingProperty] = useState<Property | null>(null);
  const [deletingPropertyBusy, setDeletingPropertyBusy] = useState(false);
  const [rowDelete, setRowDelete] = useState<RowDeleteState>({ kind: 'closed' });
  const [rowDeleteBusy, setRowDeleteBusy] = useState(false);
  const [creatingRow, setCreatingRow] = useState(false);

  const properties = database.properties;
  const settings = database.views.table ?? {};
  const rows = useMemo(() => {
    const filtered = applyFilters(database.rows, settings.filters, properties);
    return applySort(filtered, settings.sort, properties);
  }, [database.rows, settings.filters, settings.sort, properties]);
  const sortedPropertyId =
    settings.sort?.propertyId === TITLE_PROPERTY_ID
      ? null
      : settings.sort?.propertyId ?? null;

  // Close the property header menu on outside click.
  useEffect(() => {
    if (propertyMenu.kind !== 'open') return undefined;
    const handler = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest('[data-property-menu-host]')) return;
      setPropertyMenu({ kind: 'closed' });
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [propertyMenu.kind]);

  // Close the new property creator on outside click.
  useEffect(() => {
    if (newProperty.kind !== 'open') return undefined;
    const handler = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest('[data-new-property-host]')) return;
      setNewProperty({ kind: 'closed' });
      setNewPropertyName('');
      setNewPropertyType('text');
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [newProperty.kind]);

  const commitPropertyRename = useCallback(
    async (property: Property, next: string) => {
      const trimmed = next.trim();
      setPropertyMenu({ kind: 'closed' });
      if (trimmed === '' || trimmed === property.name) return;
      try {
        await api.updateProperty(property.id, { name: trimmed });
        onMutated();
      } catch {
        // ignored; UI stays on the old name until the next refetch.
      }
    },
    [onMutated]
  );

  const commitNewProperty = useCallback(async () => {
    if (newProperty.kind !== 'open') return;
    const name = newPropertyName.trim();
    if (name === '') return;
    setNewProperty({ kind: 'submitting' });
    try {
      const initialOptions: PropertyOption[] = [];
      // The backend will normalize option ids; we only need to provide
      // an empty array for select/multi_select, plus a color the user
      // can't see yet (the creator is one-shot per type).
      const body: { name: string; type: PropertyType; options?: PropertyOption[] } = {
        name,
        type: newPropertyType,
      };
      if (newPropertyType === 'select' || newPropertyType === 'multi_select') {
        body.options = initialOptions;
      }
      await api.createProperty(database.page.id, body);
      setNewProperty({ kind: 'closed' });
      setNewPropertyName('');
      setNewPropertyType('text');
      onMutated();
    } catch {
      setNewProperty({ kind: 'open' });
    }
  }, [newProperty, newPropertyName, newPropertyType, database.page.id, onMutated]);

  const confirmDeleteProperty = useCallback(async () => {
    if (!deletingProperty) return;
    setDeletingPropertyBusy(true);
    try {
      await api.deleteProperty(deletingProperty.id);
      setDeletingProperty(null);
      onMutated();
    } catch {
      // ignored; the modal stays open on failure so the user can retry.
    } finally {
      setDeletingPropertyBusy(false);
    }
  }, [deletingProperty, onMutated]);

  const confirmDeleteRow = useCallback(async () => {
    if (rowDelete.kind !== 'open') return;
    setRowDeleteBusy(true);
    try {
      await api.deleteRow(rowDelete.rowId);
      setRowDelete({ kind: 'closed' });
      onMutated();
    } catch {
      setRowDelete({ kind: 'closed' });
    } finally {
      setRowDeleteBusy(false);
    }
  }, [rowDelete, onMutated]);

  const addRow = useCallback(async () => {
    setCreatingRow(true);
    try {
      const created = await api.createRow(database.page.id, { title: 'Untitled' });
      onMutated();
      navigate(`/page/${created.id}`);
    } catch {
      // ignored
    } finally {
      setCreatingRow(false);
    }
  }, [database.page.id, onMutated, navigate]);

  const commitCell = useCallback(
    async (rowId: string, propertyId: string, value: unknown) => {
      try {
        await api.updateRow(rowId, { values: { [propertyId]: value } });
        onMutated();
      } catch {
        // ignored: revert by refetching.
        onMutated();
      }
    },
    [onMutated]
  );

  return (
    <div className="db-table-host" data-testid="db-table-host">
      <div className="db-table-card">
        <div className="db-table-scroll">
          <table className="db-table" data-testid="db-table">
            <thead>
              <tr>
                <th className="db-th db-th-title">
                  <div className="db-th-inner">Title</div>
                </th>
                {properties.map((property) => (
                  <th key={property.id} className="db-th" data-testid={`db-th-${property.id}`}>
                    <div className="db-th-inner" data-property-menu-host>
                      <button
                        type="button"
                        className={`db-th-name ${sortedPropertyId === property.id ? 'is-sorted' : ''}`}
                        onClick={() =>
                          setPropertyMenu((current) =>
                            current.kind === 'open' && current.propertyId === property.id
                              ? { kind: 'closed' }
                              : { kind: 'open', propertyId: property.id }
                          )
                        }
                        data-testid={`db-th-menu-${property.id}`}
                        aria-haspopup="menu"
                        aria-expanded={propertyMenu.kind === 'open' && propertyMenu.propertyId === property.id}
                      >
                        <span className="db-th-name-text">{property.name}</span>
                        {sortedPropertyId === property.id ? (
                          <span
                            className="db-th-sort-indicator"
                            data-testid={`db-th-sort-${property.id}`}
                            aria-label={`Sorted ${settings.sort?.direction === 'desc' ? 'descending' : 'ascending'}`}
                          >
                            {settings.sort?.direction === 'desc' ? 'v' : '^'}
                          </span>
                        ) : null}
                        <span
                          className={`db-th-type db-th-type-${property.type}`}
                          aria-hidden="true"
                          title={PROPERTY_TYPE_LABELS[property.type]}
                        >
                          {typeCue(property.type)}
                        </span>
                        <span className="db-th-caret" aria-hidden="true">
                          v
                        </span>
                      </button>
                      {propertyMenu.kind === 'open' && propertyMenu.propertyId === property.id && (
                        <div
                          className="db-th-menu"
                          role="menu"
                          data-testid={`db-th-menu-${property.id}-menu`}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="db-th-menu-item"
                            onClick={() =>
                              setPropertyMenu({ kind: 'renaming', propertyId: property.id, draft: property.name })
                            }
                            data-testid={`db-th-rename-${property.id}`}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="db-th-menu-item is-danger"
                            onClick={() => setDeletingProperty(property)}
                            data-testid={`db-th-delete-${property.id}`}
                          >
                            Delete property
                          </button>
                        </div>
                      )}
                      {propertyMenu.kind === 'renaming' && propertyMenu.propertyId === property.id && (
                        <input
                          autoFocus
                          className="db-th-rename-input"
                          value={propertyMenu.draft}
                          onChange={(e) =>
                            setPropertyMenu({ kind: 'renaming', propertyId: property.id, draft: e.target.value })
                          }
                          onBlur={() => void commitPropertyRename(property, propertyMenu.draft)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void commitPropertyRename(property, propertyMenu.draft);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setPropertyMenu({ kind: 'closed' });
                            }
                          }}
                          data-testid={`db-th-rename-input-${property.id}`}
                          aria-label="Rename property"
                        />
                      )}
                    </div>
                  </th>
                ))}
                <th className="db-th db-th-new" data-new-property-host>
                  {newProperty.kind === 'open' ? (
                    <div className="db-new-property" data-testid="db-new-property">
                      <input
                        autoFocus
                        className="db-new-property-name"
                        value={newPropertyName}
                        onChange={(e) => setNewPropertyName(e.target.value)}
                        placeholder="Property name"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void commitNewProperty();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setNewProperty({ kind: 'closed' });
                            setNewPropertyName('');
                          }
                        }}
                        data-testid="db-new-property-name"
                      />
                      <div className="db-new-property-types" role="radiogroup" aria-label="Property type">
                        {PROPERTY_TYPES.map((type) => (
                          <button
                            key={type}
                            type="button"
                            role="radio"
                            aria-checked={newPropertyType === type}
                            className={`db-new-property-type ${newPropertyType === type ? 'is-selected' : ''}`}
                            onClick={() => setNewPropertyType(type)}
                            data-testid={`db-new-property-type-${type}`}
                          >
                            <span className={`db-new-property-type-name db-new-property-type-name-${type}`}>
                              {PROPERTY_TYPE_LABELS[type]}
                            </span>
                            <span className="db-new-property-type-cue">
                              {PROPERTY_TYPE_CUES[type]}
                            </span>
                          </button>
                        ))}
                      </div>
                      <p className="db-new-property-note">
                        A property&rsquo;s type is fixed once you create it.
                      </p>
                      <div className="db-new-property-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setNewProperty({ kind: 'closed' });
                            setNewPropertyName('');
                          }}
                          data-testid="db-new-property-cancel"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => void commitNewProperty()}
                          disabled={newPropertyName.trim() === ''}
                          data-testid="db-new-property-create"
                        >
                          Create
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="db-th-new-button"
                      onClick={() => setNewProperty({ kind: 'open' })}
                      data-testid="db-new-property-button"
                    >
                      <span className="db-th-new-plus" aria-hidden="true">+</span>
                      New property
                    </button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="db-empty" colSpan={properties.length + 2}>
                    No rows yet. Add your first row to get started.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="db-row" data-testid={`db-row-${row.id}`}>
                    <td className="db-td db-td-title">
                      <div className="db-row-title-host">
                        <Link
                          to={`/page/${row.id}`}
                          className="db-row-title"
                          data-testid={`db-row-title-${row.id}`}
                        >
                          {row.title || 'Untitled'}
                        </Link>
                        <div className="db-row-actions">
                          <Link
                            to={`/page/${row.id}`}
                            className="db-row-action"
                            aria-label="Open row"
                            title="Open"
                            data-testid={`db-row-open-${row.id}`}
                          >
                            <OpenGlyph />
                          </Link>
                          <button
                            type="button"
                            className="db-row-action is-danger"
                            aria-label="Delete row"
                            title="Delete"
                            onClick={() =>
                              setRowDelete({ kind: 'open', rowId: row.id, title: row.title || 'Untitled' })
                            }
                            data-testid={`db-row-delete-${row.id}`}
                          >
                            <TrashGlyph />
                          </button>
                        </div>
                      </div>
                    </td>
                    {properties.map((property) => {
                      const value = (row.values ?? {})[property.id];
                      return (
                        <td
                          key={property.id}
                          className={`db-td db-td-${property.type}`}
                          data-testid={`db-td-${row.id}-${property.id}`}
                        >
                          <CellEditor
                            property={property}
                            value={value}
                            rowId={row.id}
                            onCommit={(v) => void commitCell(row.id, property.id, v)}
                            onCancel={() => undefined}
                            onDatabaseMutated={onMutated}
                          />
                        </td>
                      );
                    })}
                    <td className="db-td db-td-spacer" aria-hidden="true" />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="db-add-row-bar">
          <button
            type="button"
            className="db-add-row-button"
            onClick={() => void addRow()}
            disabled={creatingRow}
            data-testid="db-add-row"
          >
            <span className="db-add-row-plus" aria-hidden="true">+</span>
            {creatingRow ? 'Adding row...' : 'New row'}
          </button>
        </div>
      </div>

      {deletingProperty && (
        <ConfirmDeleteModal
          pageTitle={deletingProperty.name}
          noun="property"
          message={`The "${deletingProperty.name}" property will be removed from every row of this database.`}
          warning="Every row loses its value for this property. This cannot be undone."
          onCancel={() => setDeletingProperty(null)}
          onConfirm={() => void confirmDeleteProperty()}
          isPending={deletingPropertyBusy}
        />
      )}

      {rowDelete.kind === 'open' && (
        <ConfirmDeleteModal
          pageTitle={rowDelete.title}
          noun="row"
          message={`The row "${rowDelete.title || 'Untitled'}" will be permanently removed from this database.`}
          warning="The row and any blocks written under it are deleted. This cannot be undone."
          onCancel={() => setRowDelete({ kind: 'closed' })}
          onConfirm={() => void confirmDeleteRow()}
          isPending={rowDeleteBusy}
        />
      )}
    </div>
  );
}

/** Compact glyph for the property type in the header cell. */
function typeCue(type: PropertyType): string {
  switch (type) {
    case 'text':
      return 'T';
    case 'number':
      return '#';
    case 'select':
      return '1';
    case 'multi_select':
      return '*';
    case 'date':
      return '@';
    case 'checkbox':
      return 'v';
    case 'url':
      return '~';
  }
}

function OpenGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M5 3h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 1.5A.5.5 0 0 0 4.5 5v6a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5H5z"
        fill="currentColor"
      />
      <path d="M7 6h4v1H8v3H7V6z" fill="currentColor" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M6 2.5h4l.5 1H13v1.5H3V3.5h2.5l.5-1zM4 6h8l-.5 7a1.5 1.5 0 0 1-1.5 1.4H6A1.5 1.5 0 0 1 4.5 13L4 6z"
        fill="currentColor"
      />
    </svg>
  );
}
