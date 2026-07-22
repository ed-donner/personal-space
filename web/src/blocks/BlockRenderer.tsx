import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { Block, BlockType } from '../lib/api';
import { blockText, numberedRunNumber } from './helpers';

export interface BlockRendererProps {
  block: Block;
  index: number;
  blocks: Block[];
  textRef: RefObject<HTMLDivElement | null>;
  onInput: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onBlur: () => void;
  onFocus: () => void;
  onToggleTodo: (checked: boolean) => void;
}

function CalloutGlyph() {
  return (
    <svg className="block-callout-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.5 20 7v5.7c0 4.1-3.4 7.3-8 8.8-4.6-1.5-8-4.7-8-8.8V7l8-3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M12 8v5M12 16.5v.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function EditableText({
  block,
  textRef,
  onInput,
  onKeyDown,
  onBlur,
  onFocus,
  className,
}: Omit<BlockRendererProps, 'index' | 'blocks' | 'onToggleTodo'> & { className: string }) {
  const text = blockText(block);
  const localRef = useRef<HTMLDivElement | null>(null);

  const setRefs = (el: HTMLDivElement | null) => {
    localRef.current = el;
    textRef.current = el;
  };

  // The contenteditable's DOM is the source of truth while the user types:
  // onInput pushes the text into state, so prop and DOM agree and nothing is
  // written back. Only when the text changed from OUTSIDE (initial load,
  // slash conversion, an external update) do we write it into the DOM.
  // Writing it back on every keystroke would replace the text node and reset
  // the caret to position 0 — which produced reversed typing ("/hea" -> "aeh/").
  useEffect(() => {
    const el = localRef.current;
    if (el && el.textContent !== text) {
      el.textContent = text;
    }
  }, [text]);

  return (
    <div
      ref={setRefs}
      className={className}
      contentEditable
      suppressContentEditableWarning
      tabIndex={-1}
      role="textbox"
      aria-label={`${block.type} block`}
      data-testid={`block-text-${block.id}`}
      onInput={(event) => onInput(event.currentTarget.textContent ?? '')}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onFocus={onFocus}
    />
  );
}

export function BlockRenderer(props: BlockRendererProps) {
  const { block, index, blocks, textRef, onToggleTodo } = props;
  const textClasses = `block-text block-text-${block.type}`;
  const editableProps: Omit<BlockRendererProps, 'index' | 'blocks' | 'onToggleTodo'> = {
    block: props.block,
    textRef,
    onInput: props.onInput,
    onKeyDown: props.onKeyDown,
    onBlur: props.onBlur,
    onFocus: props.onFocus,
  };

  switch (block.type as BlockType) {
    case 'h1':
    case 'h2':
    case 'h3':
      return <EditableText {...editableProps} className={textClasses} />;
    case 'bulleted':
      return (
        <div className="block-list-line block-list-bulleted">
          <span className="block-bullet-marker" aria-hidden="true">•</span>
          <EditableText {...editableProps} className={textClasses} />
        </div>
      );
    case 'numbered':
      return (
        <div className="block-list-line block-list-numbered">
          <span className="block-number-marker" aria-hidden="true">{numberedRunNumber(blocks, index)}.</span>
          <EditableText {...editableProps} className={textClasses} />
        </div>
      );
    case 'todo':
      return (
        <div className={`block-todo-line ${block.content.checked ? 'is-checked' : ''}`}>
          <input
            className="block-todo-checkbox"
            type="checkbox"
            checked={Boolean(block.content.checked)}
            onChange={(event) => onToggleTodo(event.target.checked)}
            aria-label="Mark to-do complete"
          />
          <EditableText {...editableProps} className={textClasses} />
        </div>
      );
    case 'quote':
      return (
        <div className="block-quote-line">
          <span className="block-quote-mark" aria-hidden="true">“</span>
          <EditableText {...editableProps} className={textClasses} />
        </div>
      );
    case 'divider':
      return (
        <hr
          className="block-divider-rule"
          data-testid={`block-divider-${block.id}`}
          aria-hidden="false"
        />
      );
    case 'code':
      return <EditableText {...editableProps} className={textClasses} />;
    case 'callout':
      return (
        <div className="block-callout-panel">
          <CalloutGlyph />
          <EditableText {...editableProps} className={textClasses} />
        </div>
      );
    case 'paragraph':
    default:
      return <EditableText {...editableProps} className={textClasses} />;
  }
}
