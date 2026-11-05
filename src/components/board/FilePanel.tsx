import { useEffect, useRef, useState } from "react";
import { Menu, useMenu, type MenuEntry } from "./Menu";
import { AppLogo, ChevronDown, DotsIcon, PanelIcon, PlusIcon } from "./icons";

export type PageMeta = { id: string; name: string };

type Props = {
  boardName: string;
  location: string;
  pages: PageMeta[];
  currentPageId: string;
  mainMenu: MenuEntry[];
  renameBoardSignal: number;
  onRenameBoard: (name: string) => void;
  onSelectPage: (id: string) => void;
  onAddPage: () => void;
  onRenamePage: (id: string, name: string) => void;
  onDeletePage: (id: string) => void;
};

const EXPANDED_KEY = "mfa.pagesPanel";

/** Top-left: app menu, board name and (expanded) the list of pages. */
export function FilePanel(props: Props) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(EXPANDED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const logoMenu = useMenu();

  const toggle = () => {
    setExpanded((x) => {
      try {
        localStorage.setItem(EXPANDED_KEY, x ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !x;
    });
  };

  const logoButton = (
    <button
      type="button"
      className="fx-logo-button"
      data-open={!!logoMenu.anchor || undefined}
      aria-label="Main menu"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => logoMenu.toggle(e.currentTarget)}
    >
      <AppLogo />
      <ChevronDown />
    </button>
  );

  const panelButton = (
    <button
      type="button"
      className="fx-icon-button"
      data-tip={expanded ? "Hide pages" : "Show pages"}
      aria-label={expanded ? "Hide pages" : "Show pages"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
    >
      <PanelIcon />
    </button>
  );

  return (
    <>
      {expanded ? (
        <div className="fx-panel fx-file-panel" data-expanded>
          <div className="fx-file-row">
            {logoButton}
            <span className="fx-spacer" />
            {panelButton}
          </div>
          <div className="fx-file-title">
            <EditableText
              value={props.boardName}
              className="fx-board-name"
              startSignal={props.renameBoardSignal}
              onCommit={props.onRenameBoard}
            />
            <div className="fx-file-location">{props.location}</div>
          </div>
          <div className="fx-pages-head">
            <span>Pages</span>
            <button
              type="button"
              className="fx-icon-button fx-icon-button--small"
              data-tip="Add page"
              aria-label="Add page"
              onMouseDown={(e) => e.preventDefault()}
              onClick={props.onAddPage}
            >
              <PlusIcon />
            </button>
          </div>
          <ul className="fx-pages" role="listbox" aria-label="Pages">
            {props.pages.map((page) => (
              <PageRow
                key={page.id}
                page={page}
                active={page.id === props.currentPageId}
                canDelete={props.pages.length > 1}
                onSelect={() => props.onSelectPage(page.id)}
                onRename={(name) => props.onRenamePage(page.id, name)}
                onDelete={() => props.onDeletePage(page.id)}
              />
            ))}
          </ul>
        </div>
      ) : (
        <div className="fx-panel fx-file-panel">
          {logoButton}
          <EditableText
            value={props.boardName}
            className="fx-board-name"
            startSignal={props.renameBoardSignal}
            onCommit={props.onRenameBoard}
          />
          <span className="fx-panel-divider" />
          {panelButton}
        </div>
      )}
      {logoMenu.anchor && <Menu anchor={logoMenu.anchor} entries={props.mainMenu} onClose={logoMenu.close} />}
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
    <li
      className="fx-page"
      role="option"
      aria-selected={active}
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
        className="fx-icon-button fx-icon-button--small fx-page-menu"
        aria-label={`Options for ${page.name}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          menu.toggle(e.currentTarget);
        }}
      >
        <DotsIcon />
      </button>
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
  onCommit,
  passive,
}: {
  value: string;
  className: string;
  startSignal: number;
  onCommit: (value: string) => void;
  passive?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const seenSignal = useRef(startSignal);

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
      title={passive ? undefined : "Rename"}
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
