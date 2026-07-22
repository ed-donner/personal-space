import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import {
  buildTree,
  defaultExpandedIds,
  type PageNode,
  type TreeNode,
} from '../lib/tree';
import { loadJSON, saveJSON } from '../lib/storage';
import { PageRow } from './PageRow';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { ThemeToggle } from './ThemeToggle';

const EXPAND_KEY = 'sidebar.expanded';

interface SidebarProps {
  pages: PageNode[];
  activeId: string | null;
  onTreeChanged: () => void;
  onSearch?: () => void;
}

export function Sidebar({ pages, activeId, onTreeChanged, onSearch = () => undefined }: SidebarProps) {
  const navigate = useNavigate();
  const tree = buildTree(pages);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const saved = loadJSON<string[] | null>(EXPAND_KEY, null);
    return new Set(Array.isArray(saved) ? saved : []);
  });
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // First load: open the top-level containers so the seed is browsable.
  // After that, prefer the user's saved expand state.
  useEffect(() => {
    const saved = loadJSON<string[]>(EXPAND_KEY, [] as string[]);
    if (saved.length === 0 && tree.length > 0) {
      setExpanded(defaultExpandedIds(tree));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist whenever it changes.
  useEffect(() => {
    saveJSON(EXPAND_KEY, Array.from(expanded));
  }, [expanded]);

  const onToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onSelect = useCallback(
    (id: string) => {
      navigate(`/page/${id}`);
    },
    [navigate]
  );

  const onAddChild = useCallback(
    async (parentId: string) => {
      const created = await api.createPage({ parentId });
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(parentId);
        return next;
      });
      onTreeChanged();
      navigate(`/page/${created.id}`);
    },
    [navigate, onTreeChanged]
  );

  const onCreateTopLevel = useCallback(async () => {
    const created = await api.createPage({});
    onTreeChanged();
    navigate(`/page/${created.id}`);
  }, [navigate, onTreeChanged]);

  const onRename = useCallback(
    async (id: string, title: string) => {
      await api.updatePage(id, { title });
      onTreeChanged();
    },
    [onTreeChanged]
  );

  const onRequestDelete = useCallback((id: string) => {
    setDeleteTarget({ id, title: findTitle(tree, id) ?? 'Untitled' });
  }, [tree]);

  const onConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    // If the active page is the deleted one OR a descendant of it, we'll
    // need to navigate the user somewhere sensible after the refresh.
    const shouldRedirect =
      activeId === targetId || isDescendant(tree, targetId, activeId ?? '');
    setDeleting(true);
    try {
      await api.deletePage(targetId);
      setDeleteTarget(null);
      onTreeChanged();
      if (shouldRedirect) {
        // After the refresh above runs, the new tree will be in `pages`
        // on the next render. We don't have it here yet, so we use the
        // current pages minus the deleted subtree as a best-effort guess,
        // and let the route component handle the 404 if we end up
        // navigating to a vanished id.
        const remaining = pages.filter(
          (p) => p.id !== targetId && !isDescendant(tree, targetId, p.id)
        );
        const next = remaining[0];
        if (next) {
          navigate(`/page/${next.id}`);
        }
        // else: workspace is empty, RootRedirect will show empty state.
      }
    } catch (err) {
      // Surface error to console; user can retry. Modal stays open would be
      // friendlier, but a refresh + retry is acceptable for Phase 1.
      console.error('Failed to delete page', err);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, onTreeChanged, activeId, tree, pages, navigate]);

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

      <button
        type="button"
        className="sidebar-search"
        onClick={onSearch}
        data-testid="sidebar-search"
      >
        <svg className="sidebar-search-glyph" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m16 16 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>Search</span>
        <kbd className="sidebar-search-kbd">{navigator.platform.includes('Mac') ? 'Cmd+K' : 'Ctrl+K'}</kbd>
      </button>

      <button
        type="button"
        className="sidebar-new-page"
        onClick={() => void onCreateTopLevel()}
        data-testid="new-page-top"
      >
        <span className="icon-plus" aria-hidden="true">
          +
        </span>
        <span>New page</span>
      </button>

      <nav className="sidebar-tree" aria-label="Pages">
        {tree.length === 0 ? (
          <div className="sidebar-tree-empty">No pages yet.</div>
        ) : (
          tree.map((node) => (
            <PageRow
              key={node.id}
              node={node}
              expanded={expanded}
              onToggle={onToggle}
              activeId={activeId}
              onSelect={onSelect}
              onAddChild={(id) => void onAddChild(id)}
              onRename={(id, t) => onRename(id, t)}
              onDelete={onRequestDelete}
            />
          ))
        )}
      </nav>

      {deleteTarget && (
        <ConfirmDeleteModal
          pageTitle={deleteTarget.title}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void onConfirmDelete()}
          isPending={deleting}
        />
      )}

      <div className="sidebar-footer">
        <ThemeToggle />
      </div>
    </aside>
  );
}

function findTitle(roots: TreeNode[], id: string): string | null {
  for (const r of roots) {
    if (r.id === id) return r.title;
    const inner = findTitle(r.children, id);
    if (inner != null) return inner;
  }
  return null;
}

/** Returns true if `descendantId` appears in the subtree rooted at `rootId`. */
function isDescendant(roots: TreeNode[], rootId: string, descendantId: string): boolean {
  if (!descendantId) return false;
  const walk = (nodes: TreeNode[]): boolean => {
    for (const n of nodes) {
      if (n.id === descendantId) return true;
      if (walk(n.children)) return true;
    }
    return false;
  };
  // Find the root of the subtree first, then walk.
  const findSubtree = (nodes: TreeNode[]): TreeNode | null => {
    for (const n of nodes) {
      if (n.id === rootId) return n;
      const inner = findSubtree(n.children);
      if (inner) return inner;
    }
    return null;
  };
  const subtree = findSubtree(roots);
  if (!subtree) return false;
  return walk([subtree]);
}
