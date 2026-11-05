import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "./icons";

export type MenuEntry =
  | {
      label: string;
      shortcut?: string;
      onSelect: () => void;
      disabled?: boolean;
      checked?: boolean;
      danger?: boolean;
    }
  | { separator: true }
  | { heading: string };

type Props = {
  /** Where to open: the trigger's rectangle. */
  anchor: DOMRect;
  entries: MenuEntry[];
  onClose: () => void;
  align?: "start" | "end";
  side?: "below" | "above";
};

const isItem = (e: MenuEntry): e is Extract<MenuEntry, { label: string }> => "label" in e;

/** Dark dropdown menu, placed next to its trigger and kept on screen. */
export function Menu({ anchor, entries, onClose, align = "start", side = "below" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  const [active, setActive] = useState(-1);
  const items = entries.map((e, i) => (isItem(e) && !e.disabled ? i : -1)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    let left = align === "start" ? anchor.left : anchor.right - width;
    let top = side === "below" ? anchor.bottom + 4 : anchor.top - height - 4;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    if (top + height > window.innerHeight - 8) top = anchor.top - height - 4;
    if (top < 8) top = anchor.bottom + 4;
    setPos({ left, top });
  }, [anchor, align, side]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const at = items.indexOf(active);
        const next = e.key === "ArrowDown" ? at + 1 : at - 1;
        setActive(items[(next + items.length) % items.length] ?? -1);
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const entry = entries[active];
        if (isItem(entry)) {
          onClose();
          entry.onSelect();
        }
      }
    };
    // Capture phase, so the canvas doesn't also react to these keys.
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active, entries, items, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fx-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) => {
        if ("separator" in entry) return <div key={i} className="fx-menu-sep" role="separator" />;
        if ("heading" in entry)
          return (
            <div key={i} className="fx-menu-heading">
              {entry.heading}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className="fx-menu-item"
            data-active={i === active || undefined}
            data-danger={entry.danger || undefined}
            disabled={entry.disabled}
            onMouseDown={(e) => e.preventDefault()}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(-1)}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
          >
            <span className="fx-menu-check">{entry.checked && <CheckIcon size={14} />}</span>
            <span className="fx-menu-label">{entry.label}</span>
            {entry.shortcut && <span className="fx-menu-shortcut">{entry.shortcut}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Small hook: open/close state plus the anchor rectangle. */
export function useMenu() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  // Clicking the trigger of an open menu closes it (outside click) — don't reopen right away.
  const closedAt = useRef(0);
  return {
    anchor,
    open: (el: HTMLElement) => setAnchor(el.getBoundingClientRect()),
    toggle: (el: HTMLElement) => {
      if (Date.now() - closedAt.current < 250) return;
      setAnchor((a) => (a ? null : el.getBoundingClientRect()));
    },
    close: () => {
      closedAt.current = Date.now();
      setAnchor(null);
    },
  };
}
