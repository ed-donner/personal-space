import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadJSON, saveJSON, removeKey } from './storage';

describe('storage helpers', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the fallback when the key is missing', () => {
    expect(loadJSON<{ a: number }>('missing', { a: 1 })).toEqual({ a: 1 });
  });

  it('round-trips a value through saveJSON + loadJSON', () => {
    saveJSON('k', { a: 1, b: ['x'] });
    expect(loadJSON<{ a: number; b: string[] }>('k', { a: 0, b: [] })).toEqual({
      a: 1,
      b: ['x'],
    });
  });

  it('returns the fallback on malformed JSON', () => {
    window.localStorage.setItem('ps:bad', '{not json');
    expect(loadJSON<number>('bad', 42)).toBe(42);
  });

  it('falls back when localStorage throws (e.g. private mode)', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('Quota exceeded');
      });
    expect(() => saveJSON('k', { a: 1 })).not.toThrow();
    expect(setItem).toHaveBeenCalled();
  });

  it('removeKey does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    expect(() => removeKey('k')).not.toThrow();
  });
});
