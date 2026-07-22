import type { Block, BlockType } from '../lib/api';

export const BLOCK_TYPES: BlockType[] = [
  'paragraph',
  'h1',
  'h2',
  'h3',
  'bulleted',
  'numbered',
  'todo',
  'quote',
  'divider',
  'code',
  'callout',
];

export const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: 'Text',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  bulleted: 'Bulleted list',
  numbered: 'Numbered list',
  todo: 'To-do',
  quote: 'Quote',
  divider: 'Divider',
  code: 'Code',
  callout: 'Callout',
};

export function numberedRunNumber(blocks: Block[], index: number): number {
  if (blocks[index]?.type !== 'numbered') return 0;
  let number = 1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (blocks[cursor].type !== 'numbered') break;
    number += 1;
  }
  return number;
}

export function filterBlockTypes(query: string): BlockType[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return BLOCK_TYPES;
  const matches: { type: BlockType; byLabel: boolean }[] = [];
  for (const type of BLOCK_TYPES) {
    const label = BLOCK_LABELS[type].toLowerCase();
    const byLabel = label.includes(normalized);
    // Type-id matching is only useful as a fallback so that a single-letter
    // query like "h" doesn't drag in unrelated ids (paragraph contains "h").
    const byId = normalized.length >= 2 && type.includes(normalized);
    if (byLabel || byId) matches.push({ type, byLabel });
  }
  matches.sort((a, b) => Number(b.byLabel) - Number(a.byLabel));
  return matches.map((m) => m.type);
}

export function reorderBlocks(blocks: Block[], activeId: string, overId: string): Block[] {
  const from = blocks.findIndex((block) => block.id === activeId);
  const to = blocks.findIndex((block) => block.id === overId);
  if (from < 0 || to < 0 || from === to) return blocks;
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  // "Insert before the over item" — matches dnd-kit's natural drop position
  // and is the more intuitive behaviour for the user.
  const adjustedTo = to > from ? to - 1 : to;
  next.splice(adjustedTo, 0, moved);
  return next.map((block, index) => ({ ...block, position: index }));
}

export function blockText(block: Block): string {
  return typeof block.content.text === 'string' ? block.content.text : '';
}

export function isTextBlock(type: BlockType): boolean {
  return type !== 'divider';
}
