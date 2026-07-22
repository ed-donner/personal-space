import { describe, it, expect } from 'vitest';
import type { DatabaseFilter, Property, PropertyOption, RowPage } from '../lib/api';
import {
  TITLE_PROPERTY_ID,
  applyFilters,
  applySort,
  emptyFilterFor,
  groupRowsByProperty,
  matchesFilter,
  opsForType,
} from './views';

function opt(id: string, label: string, color = '#000000'): PropertyOption {
  return { id, label, color };
}

function prop(
  id: string,
  type: Property['type'],
  name: string,
  position: number,
  options: PropertyOption[] | null = null
): Property {
  return { id, databaseId: 'db1', name, type, options, position };
}

function row(
  id: string,
  title: string,
  values: Record<string, unknown> = {},
  position = 0
): RowPage {
  return {
    id,
    parentId: 'db1',
    title,
    icon: null,
    kind: 'row',
    position,
    values,
  };
}

const properties: Property[] = [
  prop('pAuthor', 'text', 'Author', 0),
  prop('pPages', 'number', 'Pages', 1),
  prop('pStatus', 'select', 'Status', 2, [
    opt('sReading', 'Reading'),
    opt('sDone', 'Done'),
    opt('sWishlist', 'Wishlist'),
  ]),
  prop('pGenre', 'multi_select', 'Genre', 3, [
    opt('gFiction', 'Fiction'),
    opt('gNonfic', 'Non-fiction'),
    opt('gSciFi', 'Sci-Fi'),
  ]),
  prop('pDate', 'date', 'Date', 4),
  prop('pCheck', 'checkbox', 'Done', 5),
  prop('pUrl', 'url', 'Link', 6),
];

const rows: RowPage[] = [
  row('r1', 'Dune', {
    pAuthor: 'Frank Herbert',
    pPages: 688,
    pStatus: 'sReading',
    pGenre: ['gSciFi', 'gFiction'],
    pDate: '2026-05-01',
    pCheck: false,
    pUrl: 'https://example.com/dune',
  }, 0),
  row('r2', 'Educated', {
    pAuthor: 'Tara Westover',
    pPages: 352,
    pStatus: 'sDone',
    pGenre: ['gNonfic'],
    pDate: '2026-01-20',
    pCheck: true,
    pUrl: 'https://example.com/educated',
  }, 1),
  row('r3', 'Sapiens', {
    pAuthor: 'Yuval Harari',
    pPages: 512,
    pStatus: 'sWishlist',
    pGenre: ['gNonfic'],
    pDate: null,
    pCheck: false,
    pUrl: 'https://example.com/sapiens',
  }, 2),
  row('r4', 'Untitled No-Date', {
    pAuthor: 'Anonymous',
    pPages: null,
    pStatus: null,
    pGenre: null,
    pDate: null,
    pCheck: true,
    pUrl: null,
  }, 3),
];

describe('views helpers', () => {
  describe('opsForType', () => {
    it('returns the expected ops per property type', () => {
      expect(opsForType('text')).toEqual(['contains']);
      expect(opsForType('url')).toEqual(['contains']);
      expect(opsForType('select')).toEqual(['is', 'is_not']);
      expect(opsForType('multi_select')).toEqual(['is', 'is_not']);
      expect(opsForType('date')).toEqual(['before', 'after']);
      expect(opsForType('checkbox')).toEqual(['is_checked', 'is_not_checked']);
      expect(opsForType('number')).toEqual([]);
    });
  });

  describe('emptyFilterFor', () => {
    it('selects a default op that fits the property', () => {
      expect(emptyFilterFor(prop('a', 'text', 'T', 0))).toMatchObject({
        propertyId: 'a',
        op: 'contains',
        value: '',
      });
      expect(emptyFilterFor(prop('b', 'checkbox', 'C', 0))).toMatchObject({
        propertyId: 'b',
        op: 'is_checked',
        value: null,
      });
      expect(emptyFilterFor(prop('c', 'date', 'D', 0))).toMatchObject({
        propertyId: 'c',
        op: 'before',
        value: '',
      });
    });
  });

  describe('applyFilters', () => {
    it('returns the rows unchanged when there are no filters', () => {
      expect(applyFilters(rows, [], properties)).toBe(rows);
      expect(applyFilters(rows, undefined, properties)).toBe(rows);
    });

    it('text contains is case-insensitive and matches substring', () => {
      const filter: DatabaseFilter = {
        propertyId: 'pAuthor',
        op: 'contains',
        value: 'TARA',
      };
      const out = applyFilters(rows, [filter], properties);
      expect(out.map((r) => r.id)).toEqual(['r2']);
    });

    it('url contains matches on the link', () => {
      const filter: DatabaseFilter = {
        propertyId: 'pUrl',
        op: 'contains',
        value: 'dune',
      };
      const out = applyFilters(rows, [filter], properties);
      expect(out.map((r) => r.id)).toEqual(['r1']);
    });

    it('text contains with empty value matches any non-empty value', () => {
      const filter: DatabaseFilter = {
        propertyId: 'pAuthor',
        op: 'contains',
        value: '',
      };
      const out = applyFilters(rows, [filter], properties);
      // All four rows have an author, so all match.
      expect(out.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    });

    it('select is matches the option label', () => {
      const filter: DatabaseFilter = {
        propertyId: 'pStatus',
        op: 'is',
        value: 'Done',
      };
      const out = applyFilters(rows, [filter], properties);
      expect(out.map((r) => r.id)).toEqual(['r2']);
    });

    it('select is with no value matches only rows with no value', () => {
      const filter: DatabaseFilter = {
        propertyId: 'pStatus',
        op: 'is',
        value: '',
      };
      const out = applyFilters(rows, [filter], properties);
      expect(out.map((r) => r.id)).toEqual(['r4']);
    });

    it('select is_not matches everything except the option label', () => {
      const filter: DatabaseFilter = {
        propertyId: 'pStatus',
        op: 'is_not',
        value: 'Reading',
      };
      const out = applyFilters(rows, [filter], properties);
      expect(out.map((r) => r.id)).toEqual(['r2', 'r3', 'r4']);
    });

    it('select is/is_not accept either the option label or the option id', () => {
      // Backend-seeded filters sometimes carry the option id; the
      // helpers should accept both representations.
      const byLabel: DatabaseFilter = {
        propertyId: 'pStatus',
        op: 'is',
        value: 'Done',
      };
      const byId: DatabaseFilter = {
        propertyId: 'pStatus',
        op: 'is',
        value: 'sDone',
      };
      const byLabelOut = applyFilters(rows, [byLabel], properties);
      const byIdOut = applyFilters(rows, [byId], properties);
      expect(byLabelOut.map((r) => r.id)).toEqual(['r2']);
      expect(byIdOut.map((r) => r.id)).toEqual(['r2']);
      const notLabel: DatabaseFilter = {
        propertyId: 'pStatus',
        op: 'is_not',
        value: 'Reading',
      };
      const notId: DatabaseFilter = {
        propertyId: 'pStatus',
        op: 'is_not',
        value: 'sReading',
      };
      expect(applyFilters(rows, [notLabel], properties).map((r) => r.id)).toEqual([
        'r2',
        'r3',
        'r4',
      ]);
      expect(applyFilters(rows, [notId], properties).map((r) => r.id)).toEqual([
        'r2',
        'r3',
        'r4',
      ]);
    });

    it('multi_select is matches when the option label is in the list', () => {
      const filter: DatabaseFilter = {
        propertyId: 'pGenre',
        op: 'is',
        value: 'Fiction',
      };
      const out = applyFilters(rows, [filter], properties);
      expect(out.map((r) => r.id)).toEqual(['r1']);
    });

    it('date before/after compare the stored string', () => {
      const before: DatabaseFilter = {
        propertyId: 'pDate',
        op: 'before',
        value: '2026-02-01',
      };
      expect(applyFilters(rows, [before], properties).map((r) => r.id)).toEqual([
        'r2',
      ]);
      const after: DatabaseFilter = {
        propertyId: 'pDate',
        op: 'after',
        value: '2026-02-01',
      };
      expect(applyFilters(rows, [after], properties).map((r) => r.id)).toEqual([
        'r1',
      ]);
    });

    it('date before/after drop rows with no date', () => {
      const filter: DatabaseFilter = {
        propertyId: 'pDate',
        op: 'before',
        value: '2030-01-01',
      };
      const out = applyFilters(rows, [filter], properties);
      expect(out.map((r) => r.id)).toEqual(['r1', 'r2']);
    });

    it('checkbox is_checked and is_not_checked match the boolean', () => {
      const checked: DatabaseFilter = {
        propertyId: 'pCheck',
        op: 'is_checked',
      };
      expect(applyFilters(rows, [checked], properties).map((r) => r.id)).toEqual([
        'r2',
        'r4',
      ]);
      const unchecked: DatabaseFilter = {
        propertyId: 'pCheck',
        op: 'is_not_checked',
      };
      expect(applyFilters(rows, [unchecked], properties).map((r) => r.id)).toEqual([
        'r1',
        'r3',
      ]);
    });

    it('combines filters with AND', () => {
      const filters: DatabaseFilter[] = [
        { propertyId: 'pStatus', op: 'is', value: 'Done' },
        { propertyId: 'pCheck', op: 'is_checked' },
      ];
      const out = applyFilters(rows, filters, properties);
      expect(out.map((r) => r.id)).toEqual(['r2']);
    });

    it('unknown property in a filter is ignored (does not drop rows)', () => {
      const filter: DatabaseFilter = {
        propertyId: 'does-not-exist',
        op: 'contains',
        value: 'whatever',
      };
      const out = applyFilters(rows, [filter], properties);
      expect(out).toEqual(rows);
    });

    it('matchesFilter handles the empty / unknown edges', () => {
      // No filter case
      const row0 = row('rx', 'Hello', { pAuthor: 'Hi' });
      expect(matchesFilter(row0, { propertyId: 'missing', op: 'contains', value: 'x' }, properties)).toBe(true);
      // Wrong op for type
      expect(matchesFilter(row0, { propertyId: 'pAuthor', op: 'before', value: 'x' }, properties)).toBe(true);
    });
  });

  describe('applySort', () => {
    it('returns the rows unchanged when sort is null/undefined', () => {
      expect(applySort(rows, null, properties)).toBe(rows);
      expect(applySort(rows, undefined, properties)).toBe(rows);
    });

    it('sorts by title when propertyId is "title"', () => {
      const sorted = applySort(
        rows,
        { propertyId: TITLE_PROPERTY_ID, direction: 'asc' },
        properties
      );
      // Titles (alphabetical): Dune, Educated, Sapiens, Untitled No-Date.
      expect(sorted.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    });

    it('sorts text with localeCompare, nulls last', () => {
      const sorted = applySort(
        rows,
        { propertyId: 'pAuthor', direction: 'asc' },
        properties
      );
      // r4 has Author "Anonymous", others are set; r3 has "Yuval Harari".
      expect(sorted[0].id).toBe('r4');
      expect(sorted[sorted.length - 1].id).toBe('r3');
    });

    it('sorts numbers with nulls last', () => {
      const asc = applySort(
        rows,
        { propertyId: 'pPages', direction: 'asc' },
        properties
      );
      // Nulls last -> r4 last.
      expect(asc[asc.length - 1].id).toBe('r4');
      expect(asc.slice(0, 3).map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
      const desc = applySort(
        rows,
        { propertyId: 'pPages', direction: 'desc' },
        properties
      );
      expect(desc[0].id).toBe('r1');
      expect(desc[desc.length - 1].id).toBe('r4');
    });

    it('sorts dates as strings with nulls last', () => {
      const asc = applySort(
        rows,
        { propertyId: 'pDate', direction: 'asc' },
        properties
      );
      // The two with dates first, in chronological order, then nulls.
      expect(asc.map((r) => r.id)).toEqual(['r2', 'r1', 'r3', 'r4']);
    });

    it('sorts checkboxes as false < true in both directions', () => {
      const asc = applySort(
        rows,
        { propertyId: 'pCheck', direction: 'asc' },
        properties
      );
      // r1 and r3 are false, then r2 and r4 are true. Within each group
      // the order should be stable.
      expect(asc.filter((r) => r.values?.pCheck !== true).map((r) => r.id)).toEqual([
        'r1',
        'r3',
      ]);
      expect(asc.filter((r) => r.values?.pCheck === true).map((r) => r.id)).toEqual([
        'r2',
        'r4',
      ]);
      const desc = applySort(
        rows,
        { propertyId: 'pCheck', direction: 'desc' },
        properties
      );
      expect(desc[0].values?.pCheck).toBe(true);
    });

    it('sorts select by option label', () => {
      const asc = applySort(
        rows,
        { propertyId: 'pStatus', direction: 'asc' },
        properties
      );
      // Labels (case-insensitive): Done, Reading, Wishlist, null. Nulls last.
      expect(asc.map((r) => r.id)).toEqual(['r2', 'r1', 'r3', 'r4']);
    });

    it('falls back to title for unknown property id', () => {
      const sorted = applySort(
        rows,
        { propertyId: 'missing', direction: 'asc' },
        properties
      );
      // All titles are set, so this is a plain title sort.
      expect(sorted[0].id).toBe('r1'); // Dune
    });
  });

  describe('groupRowsByProperty', () => {
    it('builds a No value column first, then one column per option', () => {
      const statusProp = properties.find((p) => p.id === 'pStatus')!;
      const cols = groupRowsByProperty(rows, statusProp);
      expect(cols[0].optionId).toBeNull();
      expect(cols[0].label).toBe('No value');
      expect(cols[0].rows.map((r) => r.id)).toEqual(['r4']);
      // Remaining columns follow option order: sReading, sDone, sWishlist.
      expect(cols.slice(1).map((c) => c.optionId)).toEqual([
        'sReading',
        'sDone',
        'sWishlist',
      ]);
      const reading = cols.find((c) => c.optionId === 'sReading')!;
      expect(reading.rows.map((r) => r.id)).toEqual(['r1']);
      const done = cols.find((c) => c.optionId === 'sDone')!;
      expect(done.rows.map((r) => r.id)).toEqual(['r2']);
      const wishlist = cols.find((c) => c.optionId === 'sWishlist')!;
      expect(wishlist.rows.map((r) => r.id)).toEqual(['r3']);
    });

    it('returns a single No value column when no property is given', () => {
      const cols = groupRowsByProperty(rows, null);
      expect(cols).toHaveLength(1);
      expect(cols[0].optionId).toBeNull();
      expect(cols[0].rows).toEqual(rows);
    });

    it('puts multi_select rows in the No value column', () => {
      const genreProp = properties.find((p) => p.id === 'pGenre')!;
      const cols = groupRowsByProperty(rows, genreProp);
      // All rows in the No value column because they are multi_select.
      const noValue = cols[0];
      expect(noValue.optionId).toBeNull();
      expect(noValue.rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
      // The other columns are still present and empty.
      const otherRows = cols.slice(1).reduce<number>(
        (sum, c) => sum + c.rows.length,
        0
      );
      expect(otherRows).toBe(0);
    });

    it('keeps the row order inside each column as it came in', () => {
      const statusProp = properties.find((p) => p.id === 'pStatus')!;
      // Reverse the rows so order matters.
      const reversed = [...rows].reverse();
      const cols = groupRowsByProperty(reversed, statusProp);
      const wishlist = cols.find((c) => c.optionId === 'sWishlist')!;
      // r3 was first in the reversed list, so it appears first.
      expect(wishlist.rows[0].id).toBe('r3');
    });
  });
});
