import { useEffect, useRef, useState } from "react";

interface Props {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  ariaLabel: string;
}

/**
 * Inline rename input.
 * - Enter commits (trimmed, falling back to original if empty).
 * - Escape cancels without committing.
 * - Blur commits (so click-elsewhere works the way users expect).
 */
export function InlineRename({ initialValue, onCommit, onCancel, ariaLabel }: Props) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className="row-title-input"
      type="text"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const next = value.trim();
          if (next.length > 0) onCommit(next);
          else onCancel();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelledRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (cancelledRef.current) return;
        const next = value.trim();
        if (next.length > 0 && next !== initialValue) onCommit(next);
        else onCancel();
      }}
    />
  );
}
