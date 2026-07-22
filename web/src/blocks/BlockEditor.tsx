import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Block, BlockType } from '../lib/api';
import { BlockRenderer } from './BlockRenderer';
import { SlashMenu } from './SlashMenu';
import { BLOCK_LABELS, BLOCK_TYPES } from './helpers';
import { useBlockEditor } from './useBlockEditor';

function focusAtEnd(node: HTMLDivElement | null) {
  if (!node) return;
  node.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function SortableBlock({
  block,
  index,
  blocks,
  textRef,
  onInput,
  onKeyDown,
  onBlur,
  onFocus,
  onToggleTodo,
}: {
  block: Block;
  index: number;
  blocks: Block[];
  textRef: { current: HTMLDivElement | null };
  onInput: (text: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onBlur: () => void;
  onFocus: () => void;
  onToggleTodo: (checked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  return (
    <div
      ref={setNodeRef}
      className={`editor-block editor-block-${block.type} ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`block-${block.id}`}
      data-block-type={block.type}
    >
      <button
        className="block-drag-handle"
        type="button"
        aria-label={`Drag ${block.type} block`}
        data-testid={`block-drag-${block.id}`}
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <BlockRenderer
        block={block}
        index={index}
        blocks={blocks}
        textRef={textRef}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onFocus={onFocus}
        onToggleTodo={onToggleTodo}
      />
    </div>
  );
}

interface BlockEditorProps {
  pageId: string;
}

interface SlashState {
  id: string;
  query: string;
  activeIndex: number;
}

function getSlashMatches(query: string): BlockType[] {
  const normalized = query.toLowerCase();
  return BLOCK_TYPES.filter((type) => {
    const label = BLOCK_LABELS[type].toLowerCase();
    return label.includes(normalized) || type.includes(normalized);
  });
}

export function BlockEditor({ pageId }: BlockEditorProps) {
  const editor = useBlockEditor(pageId);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  // Ref to the wrapper element that contains the block whose slash menu
  // is open. We use this to detect "outside" clicks for DEF-001: a click
  // anywhere not contained by this wrapper should dismiss the menu.
  const slashOwnerRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Per-block refs must be created once per render of a given block id; we
  // keep them in a Map keyed by id so focus helpers and keyboard handlers can
  // reach the contenteditable element of any block at any time.
  const textRefs = useRef(new Map<string, { current: HTMLDivElement | null }>());
  const refFor = useCallback((id: string) => {
    let bag = textRefs.current.get(id);
    if (!bag) {
      bag = { current: null };
      textRefs.current.set(id, bag);
    }
    return bag;
  }, []);

  useEffect(() => {
    const live = new Set(editor.blocks.map((block) => block.id));
    for (const id of Array.from(textRefs.current.keys())) {
      if (!live.has(id)) textRefs.current.delete(id);
    }
  }, [editor.blocks]);

  useEffect(() => {
    if (slash && !editor.blocks.some((block) => block.id === slash.id)) setSlash(null);
  }, [editor.blocks, slash]);

  // DEF-001: dismiss the slash menu on a pointerdown outside the menu and
  // its owning block. The menu lives inside the same wrapper element as
  // its block, so a single "is this click inside the owner wrapper?"
  // check covers both the menu and the block in one go.
  useEffect(() => {
    if (!slash) return undefined;
    const owner = slashOwnerRef.current;
    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (owner && owner.contains(target)) return;
      setSlash(null);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
    };
  }, [slash]);

  const focusBlock = useCallback((id: string) => {
    // A newly created block's contenteditable is not mounted yet when this is
    // first called (the create request resolves, then React renders). Retry
    // briefly so the caret actually lands — without this the user must click
    // a second time to start typing on a fresh page.
    let attempts = 0;
    const tryFocus = () => {
      const bag = textRefs.current.get(id);
      if (bag?.current) {
        focusAtEnd(bag.current);
        return;
      }
      attempts += 1;
      if (attempts < 15) window.setTimeout(tryFocus, 20);
    };
    window.setTimeout(tryFocus, 0);
  }, []);

  const chooseSlashType = useCallback(
    async (type: BlockType) => {
      const current = slashRef.current;
      if (!current) return;
      setSlash(null);
      const bag = textRefs.current.get(current.id);
      if (bag?.current) bag.current.textContent = '';
      editor.patchBlock(current.id, { text: '' });
      await editor.convertBlock(current.id, type);
      focusBlock(current.id);
    },
    [editor, focusBlock]
  );

  const onBlockInput = useCallback(
    (block: Block, text: string) => {
      editor.patchBlock(block.id, { text });
      const slashMatch = text.match(/^\/([^\s]*)$/);
      if (slashMatch) {
        const query = slashMatch[1];
        setSlash((current) => {
          const activeIndex = current?.id === block.id ? current.activeIndex : 0;
          return { id: block.id, query, activeIndex };
        });
      } else if (slashRef.current?.id === block.id) {
        setSlash(null);
      }
    },
    [editor]
  );

  const onBlockKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, block: Block, index: number) => {
      const currentSlash = slashRef.current;
      const inSlash = currentSlash?.id === block.id;
      const options = inSlash ? getSlashMatches(currentSlash!.query) : [];

      if (inSlash && options.length) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSlash({ ...currentSlash!, activeIndex: (currentSlash!.activeIndex + 1) % options.length });
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSlash({ ...currentSlash!, activeIndex: (currentSlash!.activeIndex - 1 + options.length) % options.length });
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          void chooseSlashType(options[currentSlash!.activeIndex] ?? options[0]);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          const bag = textRefs.current.get(block.id);
          if (bag?.current) bag.current.textContent = '';
          editor.patchBlock(block.id, { text: '' });
          setSlash(null);
          return;
        }
      }

      if (event.key === 'Enter' && block.type !== 'divider') {
        event.preventDefault();
        const nextType: BlockType =
          block.type === 'bulleted' || block.type === 'numbered' || block.type === 'todo'
            ? block.type
            : 'paragraph';
        void editor.createBlockAfter(block, nextType).then((created) => focusBlock(created.id));
        return;
      }

      if (event.key === 'Backspace' && (block.content.text ?? '') === '') {
        const previous = editor.blocks[index - 1];
        if (!previous) return;
        event.preventDefault();
        void editor.removeBlock(block.id).then(() => focusBlock(previous.id));
      }
    },
    [chooseSlashType, editor, focusBlock]
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (event.over && event.active.id !== event.over.id) {
        void editor.reorder(String(event.active.id), String(event.over.id));
      }
    },
    [editor]
  );

  const focusLastOrCreate = useCallback(async () => {
    const last = editor.blocks[editor.blocks.length - 1];
    if (last) {
      focusBlock(last.id);
    } else {
      const created = await editor.createFirstBlock();
      focusBlock(created.id);
    }
  }, [editor, focusBlock]);

  if (editor.loading) {
    return (
      <div className="block-editor-loading" role="status">
        Loading blocks…
      </div>
    );
  }

  return (
    <div
      className="block-editor-shell"
      data-testid="block-editor"
      onClick={(event) => {
        if (event.target === event.currentTarget) void focusLastOrCreate();
      }}
    >
      {editor.blocks.length === 0 ? (
        <button
          className="block-editor-empty"
          type="button"
          data-testid="block-editor-empty"
          onClick={() => void focusLastOrCreate()}
        >
          <span className="block-editor-empty-mark" aria-hidden="true">+</span>
          <span>Type / for blocks, or just start writing.</span>
        </button>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={editor.blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
            {editor.blocks.map((block, index) => (
              <div
                className="editor-block-with-menu"
                key={block.id}
                ref={slash?.id === block.id ? slashOwnerRef : undefined}
              >
                <SortableBlock
                  block={block}
                  index={index}
                  blocks={editor.blocks}
                  textRef={refFor(block.id)}
                  onInput={(text) => onBlockInput(block, text)}
                  onKeyDown={(event) => onBlockKeyDown(event, block, index)}
                  onBlur={() => editor.flushBlock(block.id)}
                  onFocus={() => editor.setEditing(block.id, true)}
                  onToggleTodo={(checked) => editor.patchBlock(block.id, { checked })}
                />
                {slash?.id === block.id && (
                  <SlashMenu
                    query={slash.query}
                    activeIndex={slash.activeIndex}
                    onChoose={(type) => void chooseSlashType(type)}
                    onHover={(activeIndex) =>
                      setSlash((current) => (current ? { ...current, activeIndex } : current))
                    }
                  />
                )}
              </div>
            ))}
          </SortableContext>
        </DndContext>
      )}
      {editor.blocks.length > 0 && (
        <div
          className="block-editor-bottom"
          onClick={() => void focusLastOrCreate()}
          aria-label="Focus editor"
          data-testid="block-editor-bottom"
        />
      )}
    </div>
  );
}
