import { describe, it, expect } from 'vitest';
import { applyTheme, resolveInitialTheme, THEME_KEY } from './theme';

describe('theme', () => {
  it('resolveInitialTheme prefers a stored dark value', () => {
    const storage = { getItem: (key: string) => (key === THEME_KEY ? 'dark' : null) } as Pick<Storage, 'getItem'>;
    expect(resolveInitialTheme(storage)).toBe('dark');
  });

  it('resolveInitialTheme falls back to light when nothing is stored', () => {
    const storage = { getItem: () => null } as Pick<Storage, 'getItem'>;
    expect(resolveInitialTheme(storage)).toBe('light');
  });

  it('applyTheme writes data-theme and colorScheme on the document root', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});
