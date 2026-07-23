// Segmented control for switching between Table / Board / List views of a
// database. The active segment shows the amber pill; the others are flat.
// Switching fires the parent's onChange, which the parent PUTs to the
// server.

import type { ViewKind } from "../viewLogic";

interface Props {
  active: ViewKind;
  onChange: (kind: ViewKind) => void;
  disabled?: boolean;
}

const ITEMS: { kind: ViewKind; label: string; icon: React.ReactNode }[] = [
  {
    kind: "table",
    label: "Table",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2 6.5 H14 M6 6.5 V13 M10 6.5 V13" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    kind: "board",
    label: "Board",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="3" width="3.5" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="6.25" y="3" width="3.5" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="10.5" y="3" width="3.5" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    kind: "list",
    label: "List",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4 H14 M4 8 H14 M4 12 H14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="2.5" cy="4" r="0.9" fill="currentColor" />
        <circle cx="2.5" cy="8" r="0.9" fill="currentColor" />
        <circle cx="2.5" cy="12" r="0.9" fill="currentColor" />
      </svg>
    ),
  },
];

export function ViewSwitcher({ active, onChange, disabled }: Props) {
  return (
    <div
      className="view-switcher"
      role="tablist"
      aria-label="Database view"
    >
      {ITEMS.map((it) => {
        const isActive = it.kind === active;
        return (
          <button
            key={it.kind}
            type="button"
            role="tab"
            aria-selected={isActive}
            className="view-switcher-item"
            data-active={isActive}
            disabled={disabled}
            onClick={() => {
              if (!isActive && !disabled) onChange(it.kind);
            }}
          >
            <span className="view-switcher-icon" aria-hidden="true">
              {it.icon}
            </span>
            <span className="view-switcher-label">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
