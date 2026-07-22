import { useState, useRef, useEffect, useCallback } from 'react';
import type { TreeNode } from '../lib/tree';

interface PageRowProps {
  node: TreeNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onRename: (id: string, title: string) => void | Promise<void>;
  onDelete: (id: string) => void;
}

/** Inline glyph for pages without an icon. The first letter, when present. */
function defaultIcon(node: TreeNode): string {
  if (node.icon) return '';
  if (node.title.trim().length > 0) {
    return node.title.trim().charAt(0).toUpperCase();
  }
  return node.kind === 'database' ? 'DB' : '*';
}

export function PageRow({
  node,
  expanded,
  onToggle,
  activeId,
  onSelect,
  onAddChild,
  onRename,
  onDelete,
}: PageRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isActive = activeId === node.id;

  // When renaming begins, pre-select the text so a fresh title replaces it.
  useEffect(() => {
    if (isRenaming) {
      setDraft(node.title);
      // focus + select on next tick
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [isRenaming, node.title]);

  const startRename = useCallback(() => {
    setIsRenaming(true);
  }, []);

  const cancelRename = useCallback(() => {
    setIsRenaming(false);
    setDraft(node.title);
  }, [node.title]);

  const commitRename = useCallback(async () => {
    const next = draft.trim();
    setIsRenaming(false);
    if (next === '' || next === node.title) {
      setDraft(node.title);
      return;
    }
    try {
      await onRename(node.id, next);
    } catch {
      setDraft(node.title);
    }
  }, [draft, node.id, node.title, onRename]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  };

  const onChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(node.id);
  };

  const onClick = () => {
    if (!isRenaming) onSelect(node.id);
  };

  const onAddChildClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddChild(node.id);
  };

  const onDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(node.id);
  };

  const onRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    startRename();
  };

  const classes = [
    'tree-row',
    isActive ? 'is-active' : '',
    isRenaming ? 'is-renaming' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div
        className={classes}
        style={{ paddingLeft: 6 + node.depth * 14 }}
        onClick={onClick}
        data-testid={`page-row-${node.id}`}
        data-page-id={node.id}
        data-active={isActive ? 'true' : 'false'}
        role="treeitem"
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-selected={isActive}
      >
        <span
          className={
            'tree-chevron ' +
            (hasChildren ? (isOpen ? 'is-open' : '') : 'is-spacer')
          }
          onClick={hasChildren ? onChevronClick : undefined}
          data-testid={hasChildren ? `chevron-${node.id}` : undefined}
          aria-hidden={!hasChildren}
        >
          {hasChildren ? '\u25B8' : ''}
        </span>

        <span
          className={
            'tree-icon ' +
            (node.icon
              ? ''
              : node.kind === 'database'
                ? 'is-database'
                : 'is-default')
          }
          aria-hidden="true"
        >
          {node.icon ? node.icon : defaultIcon(node)}
        </span>

        {node.kind === 'database' && !isRenaming && (
          <span
            className="tree-database-cue"
            aria-label="Database"
            title="Database"
            data-testid={`db-cue-${node.id}`}
          >
            <span className="tree-database-bar" aria-hidden="true" />
            <span className="tree-database-bar" aria-hidden="true" />
            <span className="tree-database-bar" aria-hidden="true" />
          </span>
        )}

        {isRenaming ? (
          <input
            ref={inputRef}
            className="tree-rename-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void commitRename()}
            onClick={(e) => e.stopPropagation()}
            data-testid={`rename-input-${node.id}`}
            aria-label="Rename page"
          />
        ) : (
          <span className="tree-title" title={node.title}>
            {node.title || 'Untitled'}
          </span>
        )}

        {!isRenaming && (
          <span className="tree-row-actions">
            <button
              type="button"
              className="tree-action"
              onClick={onAddChildClick}
              aria-label="Add child page"
              title="Add child page"
              data-testid={`add-child-${node.id}`}
            >
              +
            </button>
            <button
              type="button"
              className="tree-action"
              onClick={onRenameClick}
              aria-label="Rename page"
              title="Rename"
              data-testid={`rename-${node.id}`}
            >
              {'\u270E'}
            </button>
            <button
              type="button"
              className="tree-action is-danger"
              onClick={onDeleteClick}
              aria-label="Delete page"
              title="Delete"
              data-testid={`delete-${node.id}`}
            >
              {'\u2715'}
            </button>
          </span>
        )}
      </div>

      {hasChildren && isOpen && (
        <div role="group">
          {node.children.map((child) => (
            <PageRow
              key={child.id}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              activeId={activeId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </>
  );
}
