import { useEffect, useState, useRef, useCallback } from 'react';
import { api, type Page, type RowPage, ApiError } from '../lib/api';
import { BlockEditor } from '../blocks/BlockEditor';
import { DatabaseView } from '../database/DatabaseView';
import { RowPageView } from '../database/RowPageView';

interface PageViewProps {
  page: Page;
  onPageChanged: () => void;
}

export function PageView({ page, onPageChanged }: PageViewProps) {
  const [draftPage, setDraftPage] = useState<Page>(page);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync the local view state when the parent hands us a new page object
  // (e.g. after the sidebar renames the page or the tree refreshes).
  useEffect(() => {
    setDraftPage(page);
    if (!isEditingTitle) {
      setTitleDraft(page.title);
    }
  }, [page, isEditingTitle]);

  // When entering edit mode, focus and select the input.
  useEffect(() => {
    if (isEditingTitle) {
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [isEditingTitle]);

  const startEditingTitle = () => {
    setTitleDraft(draftPage.title);
    setIsEditingTitle(true);
  };

  const commitTitle = useCallback(async () => {
    const next = titleDraft.trim();
    setIsEditingTitle(false);
    if (next === '' || next === draftPage.title) {
      setTitleDraft(draftPage.title);
      return;
    }
    setSavingTitle(true);
    try {
      const updated = await api.updatePage(draftPage.id, { title: next });
      setDraftPage(updated);
      onPageChanged();
    } catch {
      setTitleDraft(draftPage.title);
    } finally {
      setSavingTitle(false);
    }
  }, [titleDraft, draftPage, onPageChanged]);

  if (draftPage.kind === 'database') {
    return <DatabaseView page={draftPage} onPageChanged={onPageChanged} />;
  }

  if (draftPage.kind === 'row') {
    return <RowPageView page={draftPage as RowPage} onPageChanged={onPageChanged} />;
  }

  return (
    <div className="page-view">
      <header className="page-header">
        <div
          className={
            'page-icon ' + (draftPage.icon ? '' : 'is-default')
          }
          aria-hidden="true"
        >
          {draftPage.icon ?? ((draftPage.title ?? '').charAt(0).toUpperCase() || '*')}
        </div>
        <div className="page-titles">
          <div className="page-kind">
            <span className="page-kind-dot" />
            Page
          </div>
          {isEditingTitle ? (
            <input
              ref={inputRef}
              className="page-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commitTitle();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setIsEditingTitle(false);
                  setTitleDraft(draftPage.title);
                }
              }}
              onBlur={() => {
                void commitTitle();
              }}
              data-testid="page-title-input"
              aria-label="Page title"
            />
          ) : (
            <h1
              className="page-title"
              data-testid="page-title"
              onClick={startEditingTitle}
              role="textbox"
              aria-label="Page title"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  startEditingTitle();
                }
              }}
            >
              {draftPage.title || 'Untitled'}
            </h1>
          )}
          {savingTitle && (
            <div
              style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
              aria-live="polite"
              data-testid="title-saving"
            >
              Saving...
            </div>
          )}
        </div>
      </header>

      <BlockEditor pageId={draftPage.id} />
    </div>
  );
}

// Helper for the parent: the kind label that should appear above the title.
// Re-exported so other components can use the same logic.
export function pageKindLabel(page: Page): string {
  return page.kind === 'database' ? 'Database' : 'Page';
}

// Re-exported so the route can tell users about fetch errors.
export { ApiError };
