import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type DatabaseResponse, type Page, type Property, type RowPage } from '../lib/api';
import { BlockEditor } from '../blocks/BlockEditor';
import { CellEditor } from './CellEditor';
import { PROPERTY_TYPE_LABELS } from './helpers';

interface RowPageViewProps {
  page: RowPage;
  onPageChanged: () => void;
}

/** A row opened as its own page: title, database crumb, a properties
 *  panel at the top, then the block editor. */
export function RowPageView({ page, onPageChanged }: RowPageViewProps) {
  const [database, setDatabase] = useState<DatabaseResponse | null>(null);
  const [titleDraft, setTitleDraft] = useState(page.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const databaseId = page.parentId;
  const rowId = page.id;

  const refetchDatabase = useCallback(async () => {
    if (!databaseId) return;
    try {
      const next = await api.getDatabase(databaseId);
      setDatabase(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load database');
    } finally {
      setLoading(false);
    }
  }, [databaseId]);

  useEffect(() => {
    setLoading(true);
    void refetchDatabase();
  }, [refetchDatabase]);

  useEffect(() => {
    if (!editingTitle) setTitleDraft(page.title);
  }, [page.title, editingTitle]);

  const startEditingTitle = () => {
    setTitleDraft(page.title);
    setEditingTitle(true);
  };

  const commitTitle = useCallback(async () => {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (next === '' || next === page.title) {
      setTitleDraft(page.title);
      return;
    }
    setSavingTitle(true);
    try {
      await api.updateRow(rowId, { title: next });
      onPageChanged();
    } catch {
      setTitleDraft(page.title);
    } finally {
      setSavingTitle(false);
    }
  }, [titleDraft, page.title, rowId, onPageChanged]);

  const commitCell = useCallback(
    async (propertyId: string, value: unknown) => {
      try {
        await api.updateRow(rowId, { values: { [propertyId]: value } });
        onPageChanged();
      } catch {
        onPageChanged();
      }
    },
    [rowId, onPageChanged]
  );

  const properties = database?.properties ?? [];

  return (
    <div className="page-view page-view-row" data-testid="row-page-view">
      <header className="page-header page-header-row">
        <div
          className="page-icon is-default is-row"
          aria-hidden="true"
        >
          {(page.title || 'R').charAt(0).toUpperCase()}
        </div>
        <div className="page-titles">
          <div className="page-kind" data-testid="row-page-kind">
            <span className="page-kind-dot" />
            Row
          </div>
          {editingTitle ? (
            <input
              autoFocus
              className="page-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commitTitle();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditingTitle(false);
                  setTitleDraft(page.title);
                }
              }}
              onBlur={() => void commitTitle()}
              data-testid="row-title-input"
              aria-label="Row title"
            />
          ) : (
            <h1
              className="page-title"
              data-testid="row-title"
              onClick={startEditingTitle}
              role="textbox"
              aria-label="Row title"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  startEditingTitle();
                }
              }}
            >
              {page.title || 'Untitled'}
            </h1>
          )}
          {database ? (
            <p className="row-page-crumb" data-testid="row-page-crumb">
              In{' '}
              <Link
                to={`/page/${database.page.id}`}
                className="row-page-crumb-link"
              >
                {database.page.title || 'Untitled'}
              </Link>
              {savingTitle && <span className="row-page-saving">Saving...</span>}
            </p>
          ) : null}
        </div>
      </header>

      {loading && !database ? (
        <div className="db-loading" role="status" data-testid="row-loading">
          Loading properties...
        </div>
      ) : error ? (
        <div className="db-error" role="alert" data-testid="row-error">
          {error}
        </div>
      ) : (
        <>
          <section className="row-properties-panel" data-testid="row-properties-panel" aria-label="Properties">
            <div className="row-properties-heading">Properties</div>
            {properties.length === 0 ? (
              <div className="row-properties-empty">
                This database has no properties yet.
              </div>
            ) : (
              <div className="row-properties-list">
                {properties.map((property) => (
                  <RowPropertyRow
                    key={property.id}
                    property={property}
                    value={(page.values ?? {})[property.id]}
                    rowId={rowId}
                    onCommit={(v) => void commitCell(property.id, v)}
                    onDatabaseMutated={() => void refetchDatabase()}
                  />
                ))}
              </div>
            )}
          </section>
          <section className="row-blocks" aria-label="Notes">
            <BlockEditor pageId={rowId} />
          </section>
        </>
      )}
    </div>
  );
}

function RowPropertyRow({
  property,
  value,
  rowId,
  onCommit,
  onDatabaseMutated,
}: {
  property: Property;
  value: unknown;
  rowId: string;
  onCommit: (value: unknown) => void;
  onDatabaseMutated: () => void;
}) {
  return (
    <div className="row-prop-row" data-testid={`row-prop-${property.id}`}>
      <div className="row-prop-label" data-testid={`row-prop-label-${property.id}`}>
        <span>{property.name}</span>
        <span className={`row-prop-type row-prop-type-${property.type}`}>
          {PROPERTY_TYPE_LABELS[property.type]}
        </span>
      </div>
      <div className="row-prop-value">
        <CellEditor
          property={property}
          value={value}
          rowId={rowId}
          onCommit={onCommit}
          onCancel={() => undefined}
          onDatabaseMutated={onDatabaseMutated}
        />
      </div>
    </div>
  );
}
