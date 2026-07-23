import { useMemo } from "react";
import { usePages } from "../store";
import { buildTree } from "../tree";
import { PageRow } from "./PageRow";
import { QuickFindButton } from "./QuickFind";
import type { PageNode } from "../types";

interface FlatRow {
  node: PageNode;
  parent: FlatRow | null;
}

function flattenForRender(roots: PageNode[]): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (nodes: PageNode[], parent: FlatRow | null): void => {
    for (const n of nodes) {
      const row: FlatRow = { node: n, parent };
      out.push(row);
      walk(n.children, row);
    }
  };
  walk(roots, null);
  return out;
}

export function Sidebar() {
  const { pages, loading, error, select, create, load, expanded } = usePages();

  const tree = useMemo(() => buildTree(pages), [pages]);
  // The header counter shows pages and databases only. Rows are stored in the
  // same pages table but never appear in the sidebar tree, so they must not
  // inflate the count (DEF-006).
  const sidebarCount = useMemo(
    () => pages.filter((p) => p.type === "page" || p.type === "database").length,
    [pages],
  );
  const visible = useMemo(() => {
    const all = flattenForRender(tree);
    return all.filter((r) => {
      // A row is visible if every ancestor is expanded.
      let cur = r.parent;
      while (cur) {
        if (!expanded[cur.node.page.id]) return false;
        cur = cur.parent;
      }
      return true;
    });
  }, [tree, expanded]);

  const handleNewRoot = async () => {
    try {
      const created = await create({ title: "Untitled" });
      select(created.id);
    } catch {
      // ignored
    }
  };

  const handleNewDatabase = async () => {
    try {
      const created = await create({
        title: "Untitled database",
        type: "database",
        icon: "🗃️",
      });
      select(created.id);
    } catch {
      // ignored
    }
  };

  return (
    <aside className="sidebar" aria-label="Page tree">
      <div className="sidebar-header">
        <span className="sidebar-title">Workspace</span>
        <span className="sidebar-subtitle">{sidebarCount} pages</span>
      </div>
      <QuickFindButton />
      <div className="sidebar-actions">
        <button
          type="button"
          className="sidebar-new"
          onClick={handleNewRoot}
          aria-label="New page"
        >
          <span className="sidebar-new-icon" aria-hidden="true">
            +
          </span>
          New page
        </button>
        <button
          type="button"
          className="sidebar-new sidebar-new-secondary"
          onClick={handleNewDatabase}
          aria-label="New database"
        >
          <span className="sidebar-new-icon" aria-hidden="true">
            🗃
          </span>
          New database
        </button>
      </div>
      {error && (
        <div className="sidebar-error" role="alert">
          {error}{" "}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ height: 22, padding: "0 8px", fontSize: 11 }}
            onClick={() => load()}
          >
            Retry
          </button>
        </div>
      )}
      <div className="sidebar-section">Pages</div>
      <div className="sidebar-tree" data-testid="sidebar-tree">
        {loading && pages.length === 0 ? (
          <div className="sidebar-loading">Loading pages…</div>
        ) : visible.length === 0 ? (
          <div className="sidebar-empty">
            No pages yet. Click <strong>New page</strong> to start.
          </div>
        ) : (
          visible.map(({ node }) => (
            <PageRow
              key={node.page.id}
              node={node}
              hasChildren={node.children.length > 0}
            />
          ))
        )}
      </div>
    </aside>
  );
}
