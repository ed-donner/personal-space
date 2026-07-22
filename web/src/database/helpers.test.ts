import { describe, it, expect } from 'vitest';
import type { PropertyOption } from '../lib/api';
import {
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_CUES,
  coerceCellValue,
  findOption,
  nextOptionColor,
  OPTION_COLORS,
} from './helpers';

function opt(id: string, color = '#000000'): PropertyOption {
  return { id, label: id, color };
}

describe('database helpers', () => {
  it('exposes all seven property types with labels and cues', () => {
    expect(PROPERTY_TYPES).toEqual([
      'text',
      'number',
      'select',
      'multi_select',
      'date',
      'checkbox',
      'url',
    ]);
    for (const type of PROPERTY_TYPES) {
      expect(PROPERTY_TYPE_LABELS[type]).toBeTruthy();
      expect(PROPERTY_TYPE_CUES[type]).toBeTruthy();
    }
  });

  it('option color palette has exactly eight colors and starts with brand colors', () => {
    expect(OPTION_COLORS).toHaveLength(8);
    // Brand colors come first so the first options match the rest of the app.
    expect(OPTION_COLORS.slice(0, 3)).toEqual(['#ecad0a', '#209dd7', '#753991']);
  });

  it('nextOptionColor cycles through the palette for successive options', () => {
    expect(nextOptionColor([])).toBe(OPTION_COLORS[0]);
    const one = nextOptionColor([opt('a')]);
    expect(one).toBe(OPTION_COLORS[1]);
    const seven = nextOptionColor([
      opt('a'),
      opt('b'),
      opt('c'),
      opt('d'),
      opt('e'),
      opt('f'),
      opt('g'),
    ]);
    expect(seven).toBe(OPTION_COLORS[7]);
    // Wraps back to the start.
    const eight = nextOptionColor([
      opt('a'),
      opt('b'),
      opt('c'),
      opt('d'),
      opt('e'),
      opt('f'),
      opt('g'),
      opt('h'),
    ]);
    expect(eight).toBe(OPTION_COLORS[0]);
  });

  it('findOption returns the matching option or undefined', () => {
    const opts = [opt('a', '#ff0000'), opt('b', '#00ff00')];
    expect(findOption(opts, 'a')?.color).toBe('#ff0000');
    expect(findOption(opts, 'missing')).toBeUndefined();
    expect(findOption(null, 'a')).toBeUndefined();
  });

  describe('coerceCellValue', () => {
    it('returns null for empty / nullish input regardless of type', () => {
      for (const type of PROPERTY_TYPES) {
        expect(coerceCellValue(type, null)).toBeNull();
        expect(coerceCellValue(type, undefined)).toBeNull();
        expect(coerceCellValue(type, '')).toBeNull();
      }
    });

    it('passes through text/url/date strings', () => {
      expect(coerceCellValue('text', 'hello')).toBe('hello');
      expect(coerceCellValue('url', 'https://example.com')).toBe('https://example.com');
      expect(coerceCellValue('date', '2026-07-21')).toBe('2026-07-21');
    });

    it('parses numbers and rejects non-finite junk', () => {
      expect(coerceCellValue('number', '42')).toBe(42);
      expect(coerceCellValue('number', '3.14')).toBeCloseTo(3.14);
      expect(coerceCellValue('number', 7)).toBe(7);
      expect(coerceCellValue('number', 'abc')).toBeNull();
    });

    it('forces checkbox to a boolean', () => {
      expect(coerceCellValue('checkbox', true)).toBe(true);
      expect(coerceCellValue('checkbox', false)).toBe(false);
      expect(coerceCellValue('checkbox', 'yes')).toBe(true);
      expect(coerceCellValue('checkbox', null)).toBeNull();
    });

    it('keeps a select option id or null', () => {
      expect(coerceCellValue('select', 'opt-1')).toBe('opt-1');
      expect(coerceCellValue('select', 5)).toBeNull();
    });

    it('filters multi_select to an array of strings', () => {
      expect(coerceCellValue('multi_select', ['a', 'b'])).toEqual(['a', 'b']);
      expect(coerceCellValue('multi_select', ['a', 2, 'b'])).toEqual(['a', 'b']);
      expect(coerceCellValue('multi_select', 'a')).toBeNull();
    });
  });
});
