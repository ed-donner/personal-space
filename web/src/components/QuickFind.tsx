import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Page, type SearchResult } from '../lib/api';
import { databaseTitle, flatSearchResults, groupSearchResults, moveSearchIndex } from '../lib/search';

interface QuickFindProps {
  open: boolean;
  pages: Page[];
  onClose: () => void;
}

export function QuickFind({ open, pages, onClose }: QuickFindProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const flat = useMemo(() => flatSearchResults(results), [results]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([]);
      setActive(-1);
      setSearching(false);
      return;
    }
    let current = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api.search(query.trim()).then(({ results: next }) => {
        if (!current) return;
        setResults(next);
        setActive(next.length ? 0 : -1);
        setSearching(false);
      }).catch(() => {
        if (!current) return;
        setResults([]);
        setActive(-1);
        setSearching(false);
      });
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const close = () => {
    setQuery('');
    setResults([]);
    setActive(-1);
    onClose();
  };

  const jump = (result: SearchResult) => {
    navigate(`/page/${result.id}`);
    close();
  };

  if (!open) return null;

  return (
    <div className="quick-find-backdrop" data-testid="quick-find-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div className="quick-find" role="dialog" aria-modal="true" aria-label="Search workspace" onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setActive((value) => moveSearchIndex(value, event.key === 'ArrowDown' ? 1 : -1, flat.length));
        } else if (event.key === 'Enter' && active >= 0 && flat[active]) {
          event.preventDefault();
          jump(flat[active]);
        }
      }}>
        <div className="quick-find-input-row">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your workspace..." aria-label="Search pages, databases and rows" autoComplete="off" />
          <kbd>Esc</kbd>
        </div>
        <div className="quick-find-results" role="listbox">
          {!query.trim() ? (
            <div className="quick-find-empty">Search pages, databases and rows</div>
          ) : searching ? (
            <div className="quick-find-empty">Searching...</div>
          ) : flat.length === 0 ? (
            <div className="quick-find-empty"><strong>No results</strong><span>Try another title</span></div>
          ) : groupSearchResults(results).map((group) => (
            <section className="quick-find-group" key={group.kind}>
              <h2>{group.label}</h2>
              {group.results.map((result) => {
                const index = flat.findIndex((item) => item.id === result.id);
                const parent = result.kind === 'row' ? databaseTitle(result.databaseId, pages) : undefined;
                return (
                  <button key={result.id} type="button" role="option" aria-selected={index === active} data-testid={`quick-find-result-${result.id}`} className={`quick-find-result${index === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => jump(result)}>
                    <span className={`quick-find-icon${result.icon ? '' : ' is-default'}`}>{result.icon ?? (result.kind === 'database' ? 'DB' : result.kind === 'row' ? 'R' : 'P')}</span>
                    <span className="quick-find-result-title">{result.title}</span>
                    {parent && <span className="quick-find-parent">In {parent}</span>}
                    <span className="quick-find-enter" aria-hidden="true">↵</span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
