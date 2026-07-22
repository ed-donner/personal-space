// Helpers and constants for the database feature. Pure functions where
// possible, kept here so the components stay focused on layout.

import type { PropertyOption, PropertyType } from '../lib/api';

/**
 * Eight-color palette for select / multi-select options. Derived from the
 * brand palette (amber, blue, purple) plus a warm red, sage green, teal
 * and two grays so options can sit on a white surface without shouting.
 * The cycle uses the existing option count so newly created options
 * rotate through the palette predictably.
 */
export const OPTION_COLORS: readonly string[] = [
  '#ecad0a', // amber
  '#209dd7', // blue
  '#753991', // purple
  '#c4392a', // red
  '#4a7a1f', // green
  '#0e7c6e', // teal
  '#8a8f98', // gray
  '#5b4636', // brown
];

/** Color the next new option should use, given the count of existing options. */
export function nextOptionColor(existing: PropertyOption[]): string {
  if (existing.length === 0) return OPTION_COLORS[0];
  const idx = existing.length % OPTION_COLORS.length;
  return OPTION_COLORS[idx];
}

/** Returns the Option whose id matches, or undefined. */
export function findOption(
  options: PropertyOption[] | null,
  id: string | null | undefined
): PropertyOption | undefined {
  if (!id || !options) return undefined;
  return options.find((opt) => opt.id === id);
}

/** A short, human label for a property type (used in header cues). */
export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'URL',
};

/** All property types in display order, used by the property creator. */
export const PROPERTY_TYPES: PropertyType[] = [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
];

/** A short cue describing each type for the creator / header cells. */
export const PROPERTY_TYPE_CUES: Record<PropertyType, string> = {
  text: 'Free-form text',
  number: 'Numeric value',
  select: 'One option',
  multi_select: 'One or more options',
  date: 'A calendar date',
  checkbox: 'Yes / no toggle',
  url: 'Web link',
};

/** Coerces a user-typed string into a row value of the given type, or
 *  returns the original value if it already has the right shape. Used by
 *  the cell editor commit handlers. */
export function coerceCellValue(
  type: PropertyType,
  raw: unknown
): unknown {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  switch (type) {
    case 'text':
    case 'url':
    case 'date':
      return String(raw);
    case 'number': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      return Boolean(raw);
    case 'select':
      return typeof raw === 'string' ? raw : null;
    case 'multi_select': {
      if (!Array.isArray(raw)) return null;
      return raw.filter((v): v is string => typeof v === 'string');
    }
    default:
      return null;
  }
}
