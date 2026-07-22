// Database view: shared chrome (header, view switcher, toolbar) that
// renders the Table, Board, or List view underneath. Manages which
// view is active (persisted per database in localStorage) and
// delegates mutation handling to a single refetch.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type DatabaseResponse, type DatabaseViewSettings, type Page, type ViewType } from '../lib/api';
import { loadJSON, saveJSON } from '../lib/storage';
import { TableView } from './TableView';
import { BoardView } from './BoardView';
import { ListView } from './ListView';
import { ViewToolbar } from './ViewToolbar';
import { applyFilters } from './views';

interface DatabaseViewProps {
  page: Page;
  onPageChanged: () => void;
}

const VIEW_TYPES: ViewType[] = ['table', 'board', 'list'];

function viewStorageKey(databaseId: string): string {
  return `view:${databaseId}`;
}

function loadActiveView(databaseId: string): ViewType {
  const v = loadJSON<ViewType>(viewStorageKey(databaseId), 'table');
  if (v === 'table' || v === 'board' || v === 'list') return v;
  return 'table';
}

/** Page-view wrapper for a database page. Owns the database fetch,
 *  the active view, and the per-view settings debounce. The toolbar
 *  is shared between views; it PATCHes the active view's settings. */
export function DatabaseView({ page, onPageChanged }: DatabaseViewProps) {
  const [data, setData] = useState<DatabaseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewType>(() =>
    loadActiveView(page.id)
  );
  // local-settings override the server while a PATCH is in flight or
  // before the next refetch reflects the change. Keyed by viewType.
  const [localOverrides, setLocalOverrides] = useState<
    Partial<Record<ViewType, DatabaseViewSettings>>
  >({});
  const [settingsBusy, setSettingsBusy] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const next = await api.getDatabase(page.id);
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load database');
    } finally {
      setLoading(false);
    }
  }, [page.id]);

  useEffect(() => {
    setLoading(true);
    void refetch();
  }, [refetch]);

  // Persist the active view per database.
  useEffect(() => {
    saveJSON(viewStorageKey(page.id), activeView);
  }, [page.id, activeView]);

  // Reset overrides when the database reloads.
  useEffect(() => {
    setLocalOverrides({});
  }, [data?.page.id, data?.views]);

  const debounceRef = useRef<{
    view: ViewType;
    settings: DatabaseViewSettings;
    handle: number;
  } | null>(null);

  const flushSettings = useCallback(
    async (view: ViewType, settings: DatabaseViewSettings) => {
      setSettingsBusy(true);
      try {
        const updated = await api.updateViewSettings(page.id, view, settings);
        setData((prev) =>
          prev
            ? { ...prev, views: { ...prev.views, ...updated } }
            : prev
        );
        setLocalOverrides((prev) => {
          const next = { ...prev };
          delete next[view];
          return next;
        });
      } catch {
        // Revert by refetching on the next render.
        void refetch();
      } finally {
        setSettingsBusy(false);
      }
    },
    [page.id, refetch]
  );

  const updateSettings = useCallback(
    (next: DatabaseViewSettings) => {
      // Optimistically apply locally for instant feedback.
      setLocalOverrides((prev) => ({ ...prev, [activeView]: next }));
      setData((prev) =>
        prev
          ? {
              ...prev,
              views: { ...prev.views, [activeView]: next },
            }
          : prev
      );
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current.handle);
      }
      const handle = window.setTimeout(() => {
        debounceRef.current = null;
        void flushSettings(activeView, next);
      }, 250);
      debounceRef.current = { view: activeView, settings: next, handle };
    },
    [activeView, flushSettings]
  );

  // Flush any pending debounce on unmount / view switch.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current.handle);
        const { view, settings } = debounceRef.current;
        void flushSettings(view, settings);
        debounceRef.current = null;
      }
    };
  }, [flushSettings]);

  // Flush immediately when the user switches views so settings do not get
  // attributed to the wrong view.
  const switchView = useCallback(
    (next: ViewType) => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current.handle);
        const { view, settings } = debounceRef.current;
        if (view !== next) {
          void flushSettings(view, settings);
        }
        debounceRef.current = null;
      }
      setActiveView(next);
    },
    [flushSettings]
  );

  const settings = useMemo<DatabaseViewSettings>(() => {
    if (!data) return {};
    return data.views[activeView] ?? {};
  }, [data, activeView]);

  const visibleRows = useMemo(() => {
    if (!data) return [];
    return applyFilters(data.rows, settings.filters, data.properties);
  }, [data, settings.filters]);

  return (
    <div className="page-view page-view-database" data-testid="database-view">
      <header className="page-header">
        <div
          className={
            'page-icon ' + (page.icon ? '' : 'is-database')
          }
          aria-hidden="true"
        >
          {page.icon ?? 'DB'}
        </div>
        <div className="page-titles">
          <div className="page-kind" data-testid="db-page-kind">
            <span className="page-kind-dot" />
            Database
          </div>
          <h1 className="page-title" data-testid="db-page-title">
            {page.title || 'Untitled'}
          </h1>
          <p className="db-page-meta" data-testid="db-page-meta">
            {data
              ? `${visibleRows.length} ${visibleRows.length === 1 ? 'row' : 'rows'}${
                  visibleRows.length !== data.rows.length
                    ? ` of ${data.rows.length}`
                    : ''
                } · ${data.properties.length} ${
                  data.properties.length === 1 ? 'property' : 'properties'
                }`
              : 'Loading...'}
          </p>
        </div>
      </header>

      {data ? (
        <div className="db-view-switcher" role="tablist" data-testid="db-view-switcher">
          {VIEW_TYPES.map((vt) => (
            <button
              key={vt}
              type="button"
              role="tab"
              aria-selected={activeView === vt}
              className={`db-view-switcher-tab ${activeView === vt ? 'is-active' : ''}`}
              onClick={() => switchView(vt)}
              data-testid={`db-view-tab-${vt}`}
            >
              {vt.charAt(0).toUpperCase() + vt.slice(1)}
            </button>
          ))}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="db-loading" role="status" data-testid="db-loading">
          Loading database...
        </div>
      ) : error ? (
        <div className="db-error" role="alert" data-testid="db-error">
          {error}
        </div>
      ) : data ? (
        <>
          <ViewToolbar
            viewType={activeView}
            properties={data.properties}
            settings={settings}
            showGroupBy={activeView === 'board'}
            onChange={updateSettings}
            busy={settingsBusy}
          />
          {activeView === 'table' ? (
            <TableView database={data} onMutated={() => { void refetch(); onPageChanged(); }} />
          ) : null}
          {activeView === 'board' ? (
            <BoardView database={data} onMutated={() => { void refetch(); onPageChanged(); }} />
          ) : null}
          {activeView === 'list' ? (
            <ListView database={data} onMutated={() => { void refetch(); onPageChanged(); }} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
