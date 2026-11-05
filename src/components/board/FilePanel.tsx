import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, useMenu, type MenuEntry } from "./Menu";
import { AppLogo, ChevronDown, DotsIcon, PagesIcon, PanelIcon, PlusIcon } from "./icons";

export type PageMeta = { id: string; name: string };

type Props = {
  boardName: string;
  location: string;
  pages: PageMeta[];
  currentPageId: string;
  mainMenu: MenuEntry[];
  fileMenu: MenuEntry[];
  renameBoardSignal: number;
  onRenameBoard: (name: string) => void;
  onSelectPage: (id: string) => void;
  onAddPage: () => void;
  onRenamePage: (id: string, name: string) => void;
  onDeletePage: (id: string) => void;
};

const EXPANDED_KEY = "mfa.pagesPanel";

/** Top-left: app menu, board name and pages (in a pop-up, or in the expanded panel). */
export function FilePanel(props: Props) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(EXPANDED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const logoMenu = useMenu();
  const fileMenu = useMenu();
  const pagesPop = useMenu();
  const panel = useRef<HTMLDivElement>(null);

  const setPanel = (open: boolean) => {
    setExpanded(open);
    try {
      localStorage.setItem(EXPANDED_KEY, open ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };

  // Renaming from the main menu happens in the expanded panel (opened if needed).
  const [renameOnOpen, setRenameOnOpen] = useState(false);
  const seenRename = useRef(props.renameBoardSignal);
  useEffect(() => {
    if (props.renameBoardSignal === seenRename.current) return;
    seenRename.current = props.renameBoardSignal;
    if (!expanded) {
      setRenameOnOpen(true);
      setPanel(true);
    }
  }, [props.renameBoardSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const logoButton = (
    <button
      type="button"
      className="fx-logo-button"
      data-open={!!logoMenu.anchor || undefined}
      data-tip="Main menu"
      aria-label="Main menu"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => logoMenu.toggle(e.currentTarget)}
    >
      <AppLogo />
      <ChevronDown />
    </button>
  );

  const pages = (
    <PagesSection
      pages={props.pages}
      currentPageId={props.currentPageId}
      onSelectPage={props.onSelectPage}
      onAddPage={props.onAddPage}
      onRenamePage={props.onRenamePage}
      onDeletePage={props.onDeletePage}
    />
  );

  return (
    <>
      {expanded ? (
        <div ref={panel} className="fx-panel fx-file-panel" data-expanded>
          <div className="fx-file-head">
            {logoButton}
            <span className="fx-spacer" />
            <button
              type="button"
              className="fx-icon-button"
              data-tip="Collapse panel"
              aria-label="Collapse panel"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setPanel(false)}
            >
              <PanelIcon />
            </button>
          </div>
          <div className="fx-file-title">
            <div className="fx-file-name-row">
              <EditableText
                value={props.boardName}
                className="fx-board-name"
                startSignal={props.renameBoardSignal}
                autoStart={renameOnOpen}
                onStarted={() => setRenameOnOpen(false)}
                onCommit={props.onRenameBoard}
              />
              <button
                type="button"
                className="fx-file-caret"
                data-open={!!fileMenu.anchor || undefined}
                aria-label="Board options"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => fileMenu.toggle(e.currentTarget)}
              >
                <ChevronDown />
              </button>
            </div>
            <div className="fx-file-location">{props.location}</div>
          </div>
          {pages}
        </div>
      ) : (
        <div ref={panel} className="fx-panel fx-file-panel">
          {logoButton}
          <button
            type="button"
            className="fx-file-name"
            aria-label={`Expand panel for board named ${props.boardName}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPanel(true)}
          >
            {props.boardName}
          </button>
          <span className="fx-panel-divider" />
          <button
            type="button"
            className="fx-icon-button"
            data-open={!!pagesPop.anchor || undefined}
            data-tip="Pages"
            aria-label="Pages"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => pagesPop.toggle(e.currentTarget)}
          >
            <PagesIcon />
          </button>
        </div>
      )}
      {logoMenu.anchor && <Menu anchor={logoMenu.anchor} entries={props.mainMenu} onClose={logoMenu.close} />}
      {fileMenu.anchor && <Menu anchor={fileMenu.anchor} entries={props.fileMenu} onClose={fileMenu.close} />}
      {pagesPop.anchor && !expanded && (
        <PagesPopover anchor={pagesPop.anchor} panel={panel.current} onClose={pagesPop.close}>
          {pages}
        </PagesPopover>
      )}
    </>
  );
}

function PagesPopover({
  anchor,
  panel,
  onClose,
  children,
}: {
  anchor: DOMRect;
  panel: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 16 });
  useLayoutEffect(() => {
    const bottom = panel?.getBoundingClientRect().bottom ?? anchor.bottom + 8;
    const width = ref.current?.getBoundingClientRect().width ?? 200;
    setPos({ left: Math.min(anchor.left, window.innerWidth - width - 8), top: bottom + 8 });
  }, [anchor, panel]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // Menus opened from inside (page options) live elsewhere in the page.
      if (ref.current?.contains(t) || (t instanceof Element && t.closest(".fx-menu"))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="fx-pages-pop" style={{ left: pos.left, top: pos.top }}>
      {children}
    </div>,
    document.body,
  );
}

function PagesSection({
  pages,
  currentPageId,
  onSelectPage,
  onAddPage,
  onRenamePage,
  onDeletePage,
}: Pick<Props, "pages" | "currentPageId" | "onSelectPage" | "onAddPage" | "onRenamePage" | "onDeletePage">) {
  return (
    <>
      <div className="fx-pages-head">
        <h2>Pages</h2>
        <button
          type="button"
          className="fx-icon-button fx-icon-button--small"
          data-tip="Add new page"
          aria-label="Add new page"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onAddPage}
        >
          <PlusIcon />
        </button>
      </div>
      <ul className="fx-pages" role="listbox" aria-label="Pages">
        {pages.map((page) => (
          <PageRow
            key={page.id}
            page={page}
            active={page.id === currentPageId}
            canDelete={pages.length > 1}
            onSelect={() => onSelectPage(page.id)}
            onRename={(name) => onRenamePage(page.id, name)}
            onDelete={() => onDeletePage(page.id)}
          />
        ))}
      </ul>
    </>
  );
}

function PageRow({
  page,
  active,
  canDelete,
  onSelect,
  onRename,
  onDelete,
}: {
  page: PageMeta;
  active: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const menu = useMenu();
  const [renameSignal, setRenameSignal] = useState(0);
  return (
    <li className="fx-page-li" role="option" aria-selected={active}>
      <div
        className="fx-page"
        data-active={active || undefined}
        data-menu-open={!!menu.anchor || undefined}
        onClick={onSelect}
        onDoubleClick={() => setRenameSignal((n) => n + 1)}
        onContextMenu={(e) => {
          e.preventDefault();
          menu.open(e.currentTarget);
        }}
      >
        <EditableText value={page.name} className="fx-page-name" startSignal={renameSignal} onCommit={onRename} passive />
        <button
          type="button"
          className="fx-page-menu"
          aria-label={`${page.name} more actions`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            menu.toggle(e.currentTarget);
          }}
        >
          <DotsIcon />
        </button>
      </div>
      {menu.anchor && (
        <Menu
          anchor={menu.anchor}
          onClose={menu.close}
          entries={[
            { label: "Rename", onSelect: () => setRenameSignal((n) => n + 1) },
            { label: "Delete page", onSelect: onDelete, disabled: !canDelete },
          ]}
        />
      )}
    </li>
  );
}

/**
 * Text that turns into an input. `passive` means a single click doesn't start
 * editing (used for page rows, where click selects and double-click renames).
 */
function EditableText({
  value,
  className,
  startSignal,
  autoStart,
  onStarted,
  onCommit,
  passive,
}: {
  value: string;
  className: string;
  startSignal: number;
  /** Start editing as soon as it appears. */
  autoStart?: boolean;
  onStarted?: () => void;
  onCommit: (value: string) => void;
  passive?: boolean;
}) {
  const [editing, setEditing] = useState(!!autoStart);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const seenSignal = useRef(startSignal);

  useEffect(() => {
    if (autoStart) onStarted?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Start editing when the signal changes (e.g. "Rename" picked from a menu).
  useEffect(() => {
    if (startSignal === seenSignal.current) return;
    seenSignal.current = startSignal;
    setDraft(value);
    setEditing(true);
  }, [startSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
  };

  if (editing) {
    return (
      <input
        ref={input}
        className={`fx-inline-input ${className}`}
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <span
      className={className}
      onClick={
        passive
          ? undefined
          : () => {
              setDraft(value);
              setEditing(true);
            }
      }
    >
      {value}
    </span>
  );
}
