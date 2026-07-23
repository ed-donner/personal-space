// QuickFind: a Cmd/Ctrl-K palette that searches pages, databases and rows
// as the user types.
//
// Behaviour:
//   - Opens with Cmd+K / Ctrl+K (registered globally in main.tsx) or via the
//     visible "Search" control in the sidebar.
//   - The "/" key is intentionally NOT bound here -- the BlockNote editor
//     uses "/" to open its slash menu and we must not steal that.
//   - Centered modal with a large autofocused input; results render live as
//     the user types, debounced ~200ms per fetch.
//   - Results are grouped by type (Pages, Databases, Rows), in the order the
//     backend returns them; up/down arrows move across ALL results (a flat
//     index), Enter jumps, Escape closes. Mouse hover + click works too.
//   - Choosing a result navigates via the pages store (usePages.select) and,
//     for a row, registers it as a navigable page (row pages are not in the
//     sidebar tree, so we have to inject them). The modal closes.
//   - Empty query: empty state with a "Search pages, databases and rows…"
//     hint. Non-matching query: "No results for '<q>'". Network error:
//     "Couldn't search. <message>".
//
// The keyboard handler runs on `window` while the modal is open so the user
// can hit arrows/Enter from anywhere in the dialog without focusing the
// result list explicitly.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type SearchResult } from "../api";
import { usePages } from "../store";
import { useDatabase } from "../databaseStore";
import type { Page } from "../types";

type SearchStatus = "idle" | "loading" | "ready" | "error";

interface Group {
  label: string;
  results: SearchResult[];
}

const DEBOUNCE_MS = 200;

function groupResults(results: SearchResult[]): Group[] {
  const pages: SearchResult[] = [];
  const databases: SearchResult[] = [];
  const rows: SearchResult[] = [];
  for (const r of results) {
    if (r.type === "page") pages.push(r);
    else if (r.type === "database") databases.push(r);
    else if (r.type === "row") rows.push(r);
  }
  const groups: Group[] = [];
  if (databases.length) groups.push({ label: "Databases", results: databases });
  if (pages.length) groups.push({ label: "Pages", results: pages });
  if (rows.length) groups.push({ label: "Rows", results: rows });
  return groups;
}

function highlightTitle(title: string, query: string): React.ReactNode {
  const q = query.trim();
  if (q.length === 0) return title;
  // Case-insensitive substring highlight; preserves original casing.
  const lower = title.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx === -1) return title;
  const before = title.slice(0, idx);
  const match = title.slice(idx, idx + needle.length);
  const after = title.slice(idx + needle.length);
  return (
    <>
      {before}
      <mark className="qf-mark">{match}</mark>
      {after}
    </>
  );
}

interface Props {
  /** Called when the modal closes itself (escape, click on backdrop, after pick). */
  onClose: () => void;
}

/**
 * The open QuickFind modal. Mount via <QuickFind /> inside a portal; render
 * this only while `open` is true.
 */
export function QuickFind({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);

  // The active flat index across all groups (pages / databases / rows).
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- Debounce the query ----
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  // ---- Fetch when the debounced query changes ----
  useEffect(() => {
    const q = debounced.trim();
    let cancelled = false;
    if (q.length === 0) {
      setResults([]);
      setStatus("idle");
      setError(null);
      return;
    }
    setStatus("loading");
    setError(null);
    api
      .search(q)
      .then((r) => {
        if (cancelled) return;
        setResults(r);
        setActive(0);
        setStatus("ready");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setResults([]);
        setError(err.message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  // ---- Keep `active` in bounds whenever the result list changes shape ----
  const groups = useMemo(() => groupResults(results), [results]);
  const flat = useMemo(() => groups.flatMap((g) => g.results), [groups]);
  useEffect(() => {
    if (flat.length === 0) setActive(0);
    else if (active >= flat.length) setActive(flat.length - 1);
  }, [flat.length, active]);

  // ---- Global key handlers while open ----
  // Use refs for the values the handler needs so we can keep the listener
  // attached for the lifetime of the modal without re-binding on every
  // result change. The handler reads the latest values from the refs.
  const flatRef = useRef<SearchResult[]>([]);
  const activeRef = useRef(0);
  useEffect(() => {
    flatRef.current = flat;
  }, [flat]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const f = flatRef.current;
        if (f.length === 0) return;
        setActive((i) => {
          const next = (i + 1) % f.length;
          activeRef.current = next;
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const f = flatRef.current;
        if (f.length === 0) return;
        setActive((i) => {
          const next = (i - 1 + f.length) % f.length;
          activeRef.current = next;
          return next;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const r = flatRef.current[activeRef.current];
        if (r) pick(r);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // ---- Focus the input on mount ----
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  function pick(r: SearchResult) {
    onPick(r);
    onClose();
  }

  return createPortal(
    <div
      className="qf-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="qf-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Quick find"
      >
        <div className="qf-input-wrap">
          <span className="qf-icon" aria-hidden="true">
            {/* magnifier */}
            <svg width="16" height="16" viewBox="0 0 16 16">
              <circle
                cx="7"
                cy="7"
                r="4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M10.5 10.5 L13.5 13.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            className="qf-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, databases and rows…"
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="qf-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              ×
            </button>
          )}
          <kbd className="qf-kbd">esc</kbd>
        </div>

        <div className="qf-results" role="listbox" aria-label="Results">
          {debounced.trim().length === 0 && (
            <div className="qf-empty">
              Type to search across pages, databases and rows.
            </div>
          )}
          {debounced.trim().length > 0 && status === "loading" && flat.length === 0 && (
            <div className="qf-empty">Searching…</div>
          )}
          {status === "error" && (
            <div className="qf-error" role="alert">
              Couldn’t search. {error}
            </div>
          )}
          {debounced.trim().length > 0 &&
            status !== "error" &&
            flat.length === 0 && <NoResults query={debounced} />}
          {flat.length > 0 && (
            <ResultGroups
              groups={groups}
              activeIndex={active}
              query={debounced}
              onHover={setActive}
              onPick={pick}
              flatStartIndex={(group) => {
                // Compute the flat start index of a given group using current
                // groups layout. Done by recomputing order; cheap for ~20 max.
                let n = 0;
                for (const g of groups) {
                  if (g === group) return n;
                  n += g.results.length;
                }
                return n;
              }}
            />
          )}
        </div>

        <div className="qf-footer">
          <span className="qf-hint">
            <kbd className="qf-kbd">↑</kbd>
            <kbd className="qf-kbd">↓</kbd> navigate
          </span>
          <span className="qf-hint">
            <kbd className="qf-kbd">↵</kbd> jump
          </span>
          <span className="qf-hint">
            <kbd className="qf-kbd">esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="qf-empty">
      No results for &ldquo;{query.trim()}&rdquo;
    </div>
  );
}

function ResultGroups({
  groups,
  activeIndex,
  query,
  onHover,
  onPick,
  flatStartIndex,
}: {
  groups: Group[];
  activeIndex: number;
  query: string;
  onHover: (i: number) => void;
  onPick: (r: SearchResult) => void;
  flatStartIndex: (g: Group) => number;
}) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.label} className="qf-group">
          <div className="qf-group-label">{g.label}</div>
          {g.results.map((r) => {
            const idx = flatStartIndex(g) + g.results.indexOf(r);
            const isActive = idx === activeIndex;
            return (
              <ResultRow
                key={`${r.type}:${r.id}`}
                result={r}
                query={query}
                isActive={isActive}
                onHover={() => onHover(idx)}
                onPick={onPick}
              />
            );
          })}
        </div>
      ))}
    </>
  );
}

function ResultRow({
  result,
  query,
  isActive,
  onHover,
  onPick,
}: {
  result: SearchResult;
  query: string;
  isActive: boolean;
  onHover: () => void;
  onPick: (r: SearchResult) => void;
}) {
  return (
    <button
      type="button"
      className="qf-row"
      role="option"
      aria-selected={isActive}
      data-active={isActive}
      onMouseEnter={onHover}
      onClick={() => onPick(result)}
    >
      <span className="qf-row-icon" aria-hidden="true">
        {result.icon || DEFAULT_ICONS[result.type]}
      </span>
      <span className="qf-row-body">
        <span className="qf-row-title">
          {highlightTitle(result.title || "Untitled", query)}
        </span>
        {result.parentTitle && (
          <span className="qf-row-crumb" aria-hidden="true">
            {result.parentTitle}
          </span>
        )}
      </span>
      <span className="qf-row-tag">{TYPE_LABEL[result.type]}</span>
    </button>
  );
}

const DEFAULT_ICONS: Record<SearchResult["type"], string> = {
  page: "📄",
  database: "🗃️",
  row: "📃",
};

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  page: "page",
  database: "database",
  row: "row",
};

/**
 * Wire up the global Cmd+K / Ctrl+K handler and render <QuickFind /> at the
 * document root when `open` is true. Mount this once near the top of the
 * app so the keyboard shortcut works on every screen.
 */
export function QuickFindHost() {
  const [open, setOpen] = useState(false);

  // Register the keyboard shortcut globally. The "/" key is intentionally
  // not bound: the BlockNote editor uses it for the slash menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return open ? <QuickFind onClose={() => setOpen(false)} /> : null;
}

/**
 * Visible "open QuickFind" button used in the sidebar header. Clicking it
 * (or hitting Enter / Space on a focused instance) opens the modal.
 */
export function QuickFindButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="qf-button"
        aria-label="Open quick find"
        onClick={() => setOpen(true)}
      >
        <span className="qf-button-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16">
            <circle
              cx="7"
              cy="7"
              r="4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M10.5 10.5 L13.5 13.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="qf-button-label">Search</span>
        <span className="qf-button-kbd" aria-hidden="true">
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </span>
      </button>
      {open && <QuickFind onClose={() => setOpen(false)} />}
    </>
  );
}

function onPick(r: SearchResult): void {
  const { select, pages } = usePages.getState();
  if (r.type === "row") {
    // Row pages do not live in the sidebar tree, so we register the row
    // as a navigable page in the pages store. We try the database store
    // first (so we keep any existing icon/position from the loaded
    // database); otherwise we synthesize a row page from the search
    // result fields (the API already returns id, title, icon, parentId).
    let page = useDatabase.getState().ensureRowInPages(r.id);
    if (!page) {
      const existing = pages.find((p) => p.id === r.id);
      if (existing) {
        page = existing;
      } else {
        const synthesized: Page = {
          id: r.id,
          parentId: r.parentId,
          title: r.title,
          icon: r.icon || "\u{1F4C4}",
          type: "row",
          position: 0,
        };
        usePages.setState((s) => ({
          pages: [...s.pages, synthesized],
        }));
        page = synthesized;
      }
    }
    if (r.parentId) {
      usePages.getState().setExpanded(r.parentId, true);
    }
    select(page.id);
    return;
  }
  if (r.parentId) {
    usePages.getState().setExpanded(r.parentId, true);
  }
  select(r.id);
}
