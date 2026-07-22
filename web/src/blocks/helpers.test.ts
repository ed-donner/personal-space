import { describe, it, expect } from 'vitest';
import {
  BLOCK_LABELS,
  BLOCK_TYPES,
  blockText,
  filterBlockTypes,
  numberedRunNumber,
  reorderBlocks,
} from './helpers';
import type { Block, BlockType } from '../lib/api';

function makeBlock(id: string, type: BlockType, position: number, content: Record<string, unknown> = {}): Block {
  return { id, pageId: 'p1', type, content, position };
}

describe('block helpers', () => {
  it('exposes labels for all 11 block types', () => {
    expect(BLOCK_TYPES).toHaveLength(11);
    for (const type of BLOCK_TYPES) {
      expect(BLOCK_LABELS[type]).toBeTruthy();
    }
  });

  it('filterBlockTypes returns everything for an empty query', () => {
    expect(filterBlockTypes('')).toEqual(BLOCK_TYPES);
    expect(filterBlockTypes('   ')).toEqual(BLOCK_TYPES);
  });

  it('filterBlockTypes matches by label substring', () => {
    const matches = filterBlockTypes('head');
    expect(matches).toContain('h1');
    expect(matches).toContain('h2');
    expect(matches).toContain('h3');
    expect(matches).not.toContain('quote');
  });

  it('filterBlockTypes matches by type id substring', () => {
    expect(filterBlockTypes('call')).toEqual(['callout']);
  });

  it('filterBlockTypes returns empty when nothing matches', () => {
    expect(filterBlockTypes('zzz')).toEqual([]);
  });

  it('numberedRunNumber counts consecutive numbered blocks', () => {
    const blocks = [
      makeBlock('a', 'paragraph', 0),
      makeBlock('b', 'numbered', 1),
      makeBlock('c', 'numbered', 2),
      makeBlock('d', 'paragraph', 3),
      makeBlock('e', 'numbered', 4),
      makeBlock('f', 'numbered', 5),
      makeBlock('g', 'numbered', 6),
    ];
    expect(numberedRunNumber(blocks, 0)).toBe(0);
    expect(numberedRunNumber(blocks, 1)).toBe(1);
    expect(numberedRunNumber(blocks, 2)).toBe(2);
    expect(numberedRunNumber(blocks, 3)).toBe(0);
    expect(numberedRunNumber(blocks, 4)).toBe(1);
    expect(numberedRunNumber(blocks, 5)).toBe(2);
    expect(numberedRunNumber(blocks, 6)).toBe(3);
  });

  it('numberedRunNumber returns 0 for non-numbered blocks', () => {
    const blocks = [makeBlock('a', 'paragraph', 0)];
    expect(numberedRunNumber(blocks, 0)).toBe(0);
  });

  it('reorderBlocks moves an item and rewrites positions', () => {
    const blocks = [
      makeBlock('a', 'paragraph', 0),
      makeBlock('b', 'paragraph', 1),
      makeBlock('c', 'paragraph', 2),
    ];
    const next = reorderBlocks(blocks, 'a', 'c');
    // "Insert before" semantics: dragging a over c puts a where c was, pushing
    // c down.
    expect(next.map((b) => b.id)).toEqual(['b', 'a', 'c']);
    expect(next.map((b) => b.position)).toEqual([0, 1, 2]);
  });

  it('reorderBlocks is a no-op when ids are the same', () => {
    const blocks = [makeBlock('a', 'paragraph', 0)];
    expect(reorderBlocks(blocks, 'a', 'a')).toBe(blocks);
  });

  it('reorderBlocks is a no-op when an id is missing', () => {
    const blocks = [makeBlock('a', 'paragraph', 0)];
    expect(reorderBlocks(blocks, 'a', 'missing')).toBe(blocks);
    expect(reorderBlocks(blocks, 'missing', 'a')).toBe(blocks);
  });

  it('blockText returns the text field, empty string when missing', () => {
    expect(blockText(makeBlock('a', 'paragraph', 0, { text: 'hi' }))).toBe('hi');
    expect(blockText(makeBlock('a', 'paragraph', 0, {}))).toBe('');
    expect(blockText(makeBlock('a', 'divider', 0, {}))).toBe('');
  });
});
