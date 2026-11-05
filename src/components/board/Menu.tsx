import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronRight } from "./icons";

export type MenuItem = {
  label: string;
  /** Shows the label in its own look (font pickers, size pickers). */
  labelStyle?: CSSProperties;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** true/false shows a check column (pickers); leave out for plain menus. */
  checked?: boolean;
  danger?: boolean;
  /** Opens a second menu to the side. */
  submenu?: MenuEntry[];
};

export type MenuEntry = MenuItem | { separator: true } | { heading: string };

type Props = {
  /** Where to open: the trigger's rectangle. */
  anchor: DOMRect;
  entries: MenuEntry[];
  onClose: () => void;
  align?: "start" | "end";
  side?: "below" | "above";
  /** Pickers are as wide as their content; app menus are at least 200px. */
  compact?: boolean;
};

const isItem = (e: MenuEntry): e is MenuItem => "label" in e;

/** Splits entries at separators: each group is drawn with a line under it. */
function groupsOf(entries: MenuEntry[]): { entry: MenuEntry; index: number }[][] {
  const groups: { entry: MenuEntry; index: number }[][] = [[]];
  entries.forEach((entry, index) => {
    if ("separator" in entry) groups.push([]);
    else groups[groups.length - 1].push({ entry, index });
  });
  return groups.filter((g) => g.length);
}

/** Dark dropdown menu, placed next to its trigger and kept on screen. */
export function Menu({ anchor, entries, onClose, align = "start", side = "below", compact }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  const [active, setActive] = useState(-1);
  const [openSub, setOpenSub] = useState(-1);
  const items = entries.map((e, i) => (isItem(e) && !e.disabled ? i : -1)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    let left = align === "start" ? anchor.left : anchor.right - width;
    let top = side === "below" ? anchor.bottom + 4 : anchor.top - height - 4;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    if (top + height > window.innerHeight - 8) top = anchor.top - height - 4;
    if (top < 8) top = Math.min(anchor.bottom + 4, window.innerHeight - height - 8);
    setPos({ left, top: Math.max(8, top) });
  }, [anchor, align, side]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (openSub >= 0) setOpenSub(-1);
        else onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const at = items.indexOf(active);
        const next = e.key === "ArrowDown" ? at + 1 : at - 1;
        setActive(items[(next + items.length) % items.length] ?? -1);
        setOpenSub(-1);
      } else if ((e.key === "Enter" || e.key === "ArrowRight") && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const entry = entries[active];
        if (!isItem(entry)) return;
        if (entry.submenu) setOpenSub(active);
        else if (e.key === "Enter") {
          onClose();
          entry.onSelect?.();
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
  }, [active, entries, items, onClose, openSub]);

  return createPortal(
    <div
      ref={ref}
      className="fx-menu"
      data-compact={compact || undefined}
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuBody
        entries={entries}
        active={active}
        openSub={openSub}
        onActive={(i, sub) => {
          setActive(i);
          setOpenSub(sub ? i : -1);
        }}
        onClose={onClose}
      />
    </div>,
    document.body,
  );
}

function MenuBody({
  entries,
  active,
  openSub,
  onActive,
  onClose,
}: {
  entries: MenuEntry[];
  active: number;
  openSub: number;
  onActive: (index: number, openSubmenu: boolean) => void;
  onClose: () => void;
}) {
  const checks = entries.some((e) => isItem(e) && typeof e.checked === "boolean");
  const rows = useRef(new Map<number, HTMLButtonElement>());
  return (
    <>
      {groupsOf(entries).map((group, g) => (
        <div key={g} className="fx-menu-group" role="group">
          {group.map(({ entry, index }) => {
            if ("heading" in entry)
              return (
                <div key={index} className="fx-menu-heading">
                  {entry.heading}
                </div>
              );
            if (!isItem(entry)) return null;
            return (
              <div key={index} className="fx-menu-row">
                <button
                  ref={(el) => {
                    if (el) rows.current.set(index, el);
                    else rows.current.delete(index);
                  }}
                  type="button"
                  role="menuitem"
                  className="fx-menu-item"
                  data-active={index === active || index === openSub || undefined}
                  data-checks={checks || undefined}
                  disabled={entry.disabled}
                  aria-haspopup={entry.submenu ? "menu" : undefined}
                  aria-expanded={entry.submenu ? index === openSub : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerEnter={() => onActive(index, !!entry.submenu)}
                  onClick={() => {
                    if (entry.submenu) return onActive(index, true);
                    onClose();
                    entry.onSelect?.();
                  }}
                >
                  {checks && <span className="fx-menu-check">{entry.checked && <CheckIcon />}</span>}
                  <span className="fx-menu-label" style={entry.labelStyle}>
                    {entry.label}
                  </span>
                  {entry.shortcut && <span className="fx-menu-shortcut">{entry.shortcut}</span>}
                  {entry.submenu && (
                    <span className="fx-menu-arrow">
                      <ChevronRight />
                    </span>
                  )}
                </button>
                {entry.submenu && index === openSub && rows.current.get(index) && (
                  <SubMenu anchor={rows.current.get(index)!.getBoundingClientRect()} entries={entry.submenu} onClose={onClose} />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** A menu opened from a row of another menu (lives inside it, so clicks count as inside). */
function SubMenu({ anchor, entries, onClose }: { anchor: DOMRect; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.right + 8, top: anchor.top - 8 });
  const [active, setActive] = useState(-1);
  const [openSub, setOpenSub] = useState(-1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = anchor.right + 8;
    if (left + width > window.innerWidth - 8) left = anchor.left - width - 8;
    const top = Math.max(8, Math.min(anchor.top - 8, window.innerHeight - height - 8));
    setPos({ left: Math.max(8, left), top });
  }, [anchor]);
  return (
    <div ref={ref} className="fx-menu fx-submenu" role="menu" style={{ left: pos.left, top: pos.top }}>
      <MenuBody
        entries={entries}
        active={active}
        openSub={openSub}
        onActive={(i, sub) => {
          setActive(i);
          setOpenSub(sub ? i : -1);
        }}
        onClose={onClose}
      />
    </div>
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
