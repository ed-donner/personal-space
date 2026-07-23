import { usePages } from "../store";
import { useTheme } from "../theme";

export function Topbar() {
  const { selectedId, pages, create, select } = usePages();
  const selected = pages.find((p) => p.id === selectedId) ?? null;
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);

  const handleNewRoot = async () => {
    try {
      const created = await create({ title: "Untitled" });
      select(created.id);
    } catch {
      // ignored
    }
  };

  return (
    <header className="topbar" role="banner">
      <div className="topbar-brand">
        <span className="topbar-mark" aria-hidden="true" />
        <span>Personal Space</span>
      </div>
      <div className="topbar-spacer" />
      <button
        type="button"
        className="topbar-action"
        onClick={handleNewRoot}
        aria-label="New page"
      >
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
          +
        </span>
        New page
      </button>
      {selected && (
        <button
          type="button"
          className="topbar-action"
          aria-label="Breadcrumb"
          title={selected.title}
        >
          <span aria-hidden="true" style={{ fontSize: 14 }}>
            {selected.icon || "\u{1F4C4}"}
          </span>
          <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selected.title}
          </span>
        </button>
      )}
      <ThemeToggle theme={theme} onToggle={toggle} />
    </header>
  );
}

interface ThemeToggleProps {
  theme: "light" | "dark";
  onToggle: () => void;
}

function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      className="topbar-theme-toggle"
      onClick={onToggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      data-theme-target={isDark ? "light" : "dark"}
    >
      {isDark ? (
        // Sun icon when in dark mode (action is "switch to light")
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle
            cx="8"
            cy="8"
            r="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M8 1.5 V3" />
            <path d="M8 13 V14.5" />
            <path d="M1.5 8 H3" />
            <path d="M13 8 H14.5" />
            <path d="M3 3 L4 4" />
            <path d="M12 12 L13 13" />
            <path d="M12 4 L13 3" />
            <path d="M3 13 L4 12" />
          </g>
        </svg>
      ) : (
        // Moon icon when in light mode (action is "switch to dark")
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M13 9.5 A5.5 5.5 0 0 1 6.5 3 A5.5 5.5 0 1 0 13 9.5 Z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
}
