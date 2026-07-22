// Tiny localStorage helpers. We isolate the JSON parsing and the
// try/catch so callers can stay simple. Returns the fallback if the
// key is missing, malformed, or storage is unavailable (private mode).

const STORAGE_PREFIX = 'ps:';

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage may be full or unavailable; non-fatal.
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // ignore
  }
}
