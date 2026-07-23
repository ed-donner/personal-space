// Small popover helper. Anchors content to a button; dismisses on outside
// click or Escape. Used by the table column-header menu and the select
// dropdowns. Kept tiny so we don't pull in a UI library.

import { useEffect, useRef, useState } from "react";

interface Props {
  trigger: (open: () => void, ref: React.Ref<HTMLElement>) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  /** Optional className for the panel (e.g. "popover-wide"). */
  className?: string;
  /** Side of the trigger to render on. Default "below-left". */
  align?: "below-left" | "below-right";
  /** Whether the popover should close when the trigger is clicked again. */
  closeOnTriggerClick?: boolean;
}

export function Popover({
  trigger,
  children,
  className,
  align = "below-left",
  closeOnTriggerClick = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="popover-root" ref={rootRef}>
      {trigger(() => {
        if (open && closeOnTriggerClick) setOpen(false);
        else setOpen(true);
      }, triggerRef)}
      {open && (
        <div
          className={`popover-panel popover-${align}${className ? " " + className : ""}`}
          role="dialog"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
