import { useState } from 'react';
import { applyTheme, resolveInitialTheme, THEME_KEY, type Theme } from '../lib/theme';

function ThemeIcon({ theme }: { theme: Theme }) {
  return theme === 'light' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42m0-12.72-1.42 1.42M7.06 16.94l-1.42 1.42"/><circle cx="12" cy="12" r="4"/></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z"/></svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => resolveInitialTheme(window.localStorage));
  const nextTheme = theme === 'light' ? 'dark' : 'light';

  const toggle = () => {
    setTheme(nextTheme);
    window.localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
  };

  return (
    <button className="theme-toggle" type="button" onClick={toggle} aria-label={`Switch to ${nextTheme} theme`}>
      <ThemeIcon theme={theme} />
      <span>{theme === 'light' ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}
