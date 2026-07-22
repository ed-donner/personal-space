import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { api, type Page } from './lib/api';
import { Sidebar } from './components/Sidebar';
import { PageView } from './components/PageView';
import { NotFound } from './components/NotFound';
import { QuickFind } from './components/QuickFind';
import type { PageNode } from './lib/tree';

export function App() {
  const [pages, setPages] = useState<PageNode[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const refreshTree = useCallback(async () => {
    try {
      const { pages: next } = await api.getTree();
      setPages(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isFind = (event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey);
      if (isFind) {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Derive the active id from the current location so the Sidebar can
  // highlight it without a parent re-render on every navigation.
  const location = useLocation();
  const activeId = useMemo(() => {
    const match = /^\/page\/([^/]+)/.exec(location.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  return (
    <div className="app-shell">
      {loaded ? (
        <Sidebar
          pages={pages}
          activeId={activeId}
          onTreeChanged={() => void refreshTree()}
          onSearch={() => setSearchOpen(true)}
        />
      ) : (
        <LoadingSidebar />
      )}
      <main className="app-main">
        {loadError ? (
          <ErrorView message={loadError} onRetry={() => void refreshTree()} />
        ) : !loaded ? (
          <LoadingMain />
        ) : (
          <Routes>
            <Route path="/" element={<RootRedirect pages={pages} />} />
            <Route
              path="/page/:id"
              element={
                <PageRoute
                  pages={pages}
                  onTreeChanged={() => void refreshTree()}
                />
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        )}
      </main>
      <QuickFind open={searchOpen} pages={pages.map(toPageShape)} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

/**
 * Root route: navigate to the first top-level page, or show an empty-state
 * if the workspace has no pages yet.
 */
function RootRedirect({ pages }: { pages: PageNode[] }) {
  const navigate = useNavigate();
  useEffect(() => {
    const first = pages[0];
    if (first) {
      navigate(`/page/${first.id}`, { replace: true });
    }
  }, [pages, navigate]);
  if (pages.length === 0) {
    return <EmptyWorkspace />;
  }
  return null;
}

/**
 * /page/:id route. Looks the page up in the current tree to decide if
 * it's a known id. If not, it tries to fetch it directly (handles the
 * case where the page was just created and the tree hasn't refreshed
 * yet) and falls back to <NotFound /> on 404.
 *
 * Also handles the "navigate to first remaining page after delete" rule:
 * if the id disappears from the tree we re-read the list and route
 * the user somewhere sensible.
 */
function PageRoute({
  pages,
  onTreeChanged,
}: {
  pages: PageNode[];
  onTreeChanged: () => void;
}) {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const navigate = useNavigate();

  // If the id isn't in the current tree at all, try to fetch it.
  const known = pages.find((p) => p.id === id);
  const [resolved, setResolved] = useState<Page | null>(
    known
      ? toPageShape(known)
      : null
  );
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (known) {
      setResolved(toPageShape(known));
      setNotFound(false);
      return;
    }
    if (!id) return;
    let cancelled = false;
    api
      .getPage(id)
      .then((p) => {
        if (cancelled) return;
        setResolved(p);
        setNotFound(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNotFound(true);
        setResolved(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id, known]);

  // If the active id vanishes from the tree (delete cascades or a refresh
  // arrives without it), surface NotFound.
  useEffect(() => {
    if (resolved && !known && id) {
      // give the fetch effect a chance to resolve first
      const t = window.setTimeout(() => {
        if (!known) {
          // attempt one fetch to confirm 404
          api
            .getPage(id)
            .then((p) => setResolved(p))
            .catch(() => {
              setNotFound(true);
              setResolved(null);
            });
        }
      }, 250);
      return () => window.clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, known, resolved]);

  // No auto-redirect: the spec says an unknown id should show a friendly
  // not-found state with a link back. The link in <NotFound /> handles the
  // navigation.

  if (notFound) {
    return <NotFound />;
  }
  if (!resolved) {
    return (
      <div className="loading-shell" role="status">
        <div>
          <div className="loading-mark" aria-hidden="true">
            PS
          </div>
          <div>Loading...</div>
        </div>
      </div>
    );
  }
  return <PageView page={resolved} onPageChanged={onTreeChanged} />;
}

function toPageShape(p: PageNode): Page {
  return {
    id: p.id,
    parentId: p.parentId,
    title: p.title,
    icon: p.icon,
    kind: p.kind,
    position: p.position,
  };
}

function EmptyWorkspace() {
  return (
    <div className="not-found">
      <div className="not-found-glyph" aria-hidden="true">
        +
      </div>
      <h1 className="not-found-title">Your workspace is empty</h1>
      <p className="not-found-body">
        Create a page from the sidebar to get started.
      </p>
    </div>
  );
}

function LoadingSidebar() {
  return (
    <aside className="app-sidebar" aria-label="Page tree">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark" aria-hidden="true">
            PS
          </div>
          <div>
            <div className="sidebar-brand-name">Personal Space</div>
            <div className="sidebar-brand-tag">Workspace</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function LoadingMain() {
  return (
    <div className="loading-shell" role="status">
      <div>
        <div className="loading-mark" aria-hidden="true">
          PS
        </div>
        <div>Loading workspace...</div>
      </div>
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="not-found">
      <div className="not-found-glyph" aria-hidden="true">
        !
      </div>
      <h1 className="not-found-title">Couldn&rsquo;t reach the server</h1>
      <p className="not-found-body">{message}</p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={onRetry}
        data-testid="retry-load"
      >
        Retry
      </button>
    </div>
  );
}

// Re-export so tests can use Navigate if they need to.
export { Navigate };
