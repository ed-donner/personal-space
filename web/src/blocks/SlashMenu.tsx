import type { BlockType } from '../lib/api';
import { BLOCK_LABELS, filterBlockTypes } from './helpers';

interface SlashMenuProps {
  query: string;
  activeIndex: number;
  onChoose: (type: BlockType) => void;
  onHover: (index: number) => void;
}

function TypeCue({ type }: { type: BlockType }) {
  if (type === 'divider') return <span className="slash-cue slash-cue-rule" aria-hidden="true" />;
  if (type === 'quote') return <span className="slash-cue slash-cue-quote" aria-hidden="true">“</span>;
  if (type === 'code') return <span className="slash-cue slash-cue-code" aria-hidden="true">&lt;/&gt;</span>;
  if (type === 'callout') return <span className="slash-cue slash-cue-callout" aria-hidden="true">!</span>;
  if (type === 'todo') return <span className="slash-cue slash-cue-todo" aria-hidden="true">✓</span>;
  if (type === 'bulleted') return <span className="slash-cue slash-cue-list" aria-hidden="true">•</span>;
  if (type === 'numbered') return <span className="slash-cue slash-cue-list" aria-hidden="true">1.</span>;
  if (type === 'paragraph') return <span className="slash-cue slash-cue-text" aria-hidden="true">T</span>;
  return <span className="slash-cue slash-cue-heading" aria-hidden="true">{type.toUpperCase()}</span>;
}

export function SlashMenu({ query, activeIndex, onChoose, onHover }: SlashMenuProps) {
  const types = filterBlockTypes(query);
  return (
    <div className="slash-menu" role="listbox" aria-label="Block types">
      <div className="slash-menu-heading">Turn into</div>
      {types.length === 0 ? (
        <div className="slash-menu-empty">No matching blocks</div>
      ) : (
        types.map((type, index) => (
          <button
            key={type}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={`slash-menu-item ${index === activeIndex ? 'is-active' : ''}`}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(type)}
          >
            <TypeCue type={type} />
            <span>{BLOCK_LABELS[type]}</span>
          </button>
        ))
      )}
      <div className="slash-menu-footer">Arrow keys to move · Enter to select</div>
    </div>
  );
}
