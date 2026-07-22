export type Theme = 'light' | 'dark';
export const THEME_KEY = 'ps:theme';

export function resolveInitialTheme(storage: Pick<Storage, 'getItem'>): Theme {
  return storage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
