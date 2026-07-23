import { useState } from "react";
import type { PageNode } from "../types";
import { usePages } from "../store";
import { useDatabase } from "../databaseStore";
import { InlineRename } from "./InlineRename";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  node: PageNode;
  hasChildren: boolean;
}

export function PageRow({ node, hasChildren }: Props) {
  const {
    selectedId,
    select,
    expanded,
    toggleExpanded,
    update,
    remove,
    create,
  } = usePages();
  const addRow = useDatabase((s) => s.addRow);
  const ensureRowInPages = useDatabase((s) => s.ensureRowInPages);

  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isOpen = !!expanded[node.page.id];
  const isActive = selectedId === node.page.id;

  const startRename = (e: React.MouseEvent | React.MouseEvent) => {
    e.stopPropagation();
    setRenaming(true);
  };

  const handleCommitRename = async (next: string) => {
    setRenaming(false);
    if (next !== node.page.title) {
      try {
        await update(node.page.id, { title: next });
      } catch {
        // store keeps the existing page; the dialog error would be redundant here.
      }
    }
  };

  const handleAddChild = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Open the parent so the new child is visible.
    if (!isOpen) toggleExpanded(node.page.id);
    // The "+" affordance on a database creates a ROW in that database, not a
    // child page — POST /api/pages with a database parent + type "page" 400s
    // once the server enforces the parent/child invariant (DEF-010). We POST
    // /api/databases/:id/rows, then register the new row as a navigable page
    // and select it so the user lands on the row page.
    if (node.page.type === "database") {
      try {
        const row = await addRow(node.page.id, "Untitled");
        const page = ensureRowInPages(row);
        if (page) select(page.id);
      } catch {
        // store exposes an error field if we want to surface it.
      }
      return;
    }
    try {
      const created = await create({
        parentId: node.page.id,
        title: "Untitled",
      });
      // The newly created page should be selected, but the user is currently
      // focused on the parent's row. After creation, we re-open the rename
      // affordance for the new child by switching the selection. The naming
      // happens on double-click; the user can rename from there.
      // A small improvement: auto-select and rename.
      setTimeout(() => {
        select(created.id);
        const el = document.querySelector<HTMLElement>(
          `[data-row-id="${created.id}"] .row-title`,
        );
        if (el) el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      }, 0);
    } catch {
      // ignored — store exposes an error field if we want to surface it.
    }
  };

  const handleDelete = async () => {
    setConfirmingDelete(false);
    try {
      await remove(node.page.id);
    } catch {
      // ignored
    }
  };

  return (
    <div
      className="row"
      data-row-id={node.page.id}
      data-active={isActive}
      data-open={isOpen}
      style={{ paddingLeft: 6 + node.depth * 14 }}
      onClick={() => select(node.page.id)}
      onDoubleClick={startRename}
    >
      <button
        type="button"
        className="row-disclosure"
        data-empty={!hasChildren}
        aria-label={isOpen ? "Collapse" : "Expand"}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) toggleExpanded(node.page.id);
        }}
      >
        {/* chevron */}
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path
            d="M2 1 L6 4 L2 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span className="row-icon" aria-hidden="true">
        {node.page.icon || "\u{1F4C4}"}
      </span>
      {renaming ? (
        <InlineRename
          initialValue={node.page.title}
          onCommit={handleCommitRename}
          onCancel={() => setRenaming(false)}
          ariaLabel={`Rename ${node.page.title}`}
        />
      ) : (
        <span className="row-title" title={node.page.title}>
          {node.page.title}
        </span>
      )}
      <span className="row-actions" data-actions={isActive}>
        <button
          type="button"
          className="row-action"
          aria-label={`Add child page to ${node.page.title}`}
          onClick={handleAddChild}
        >
          +
        </button>
        <button
          type="button"
          className="row-action"
          aria-label={`Rename ${node.page.title}`}
          onClick={startRename}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M11.5 2.5 L13.5 4.5 L5 13 L3 13 L3 11 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="row-action"
          data-danger="true"
          aria-label={`Delete ${node.page.title}`}
          onClick={(e) => {
            e.stopPropagation();
            setConfirmingDelete(true);
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3 4 H13 M6 4 V2.5 H10 V4 M5 4 L5.5 13 H10.5 L11 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </span>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete page"
          body={
            <>
              Delete <strong>{node.page.title}</strong> and everything inside
              it? This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          destructive
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
