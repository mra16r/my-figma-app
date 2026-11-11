import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatBytes } from "../format";
import { goToBoard, goToFolder, goToNotes, goToTrash } from "../router";
import { thumbnailUrl } from "../storage/boards";
import {
  countItems,
  createBoard,
  createSubfolder,
  createWorkspace,
  moveNode,
  pathTo,
  renameNode,
  totalUsage,
  trashNode,
  type Library,
  type LibraryNode,
  type Thumb,
} from "../storage/library";
import { ConfirmDialog, MoveDialog, NameDialog } from "./Dialogs";
import {
  BoardIcon,
  ChevronIcon,
  CloudIcon,
  DotsIcon,
  FolderIcon,
  MonitorIcon,
  MoonIcon,
  NoteIcon,
  PlusIcon,
  SunIcon,
  TrashIcon,
  WorkspaceIcon,
} from "./icons";
import { setThemeChoice, THEME_CHOICES, useTheme, type ThemeChoice } from "../theme";
import NotesView from "./NotesView";
import StorageDialog from "./StorageDialog";
import TrashView from "./TrashView";

type Props = {
  library: Library;
  containerId: string;
  /** Show a folder's content, the trash, or your notes. */
  section: "folder" | "trash" | "notes";
  email: string;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
  onAuthExpired: () => void;
};

type Dialog =
  | { kind: "newBoard" }
  | { kind: "newFolder" }
  | { kind: "newWorkspace" }
  | { kind: "rename"; node: LibraryNode }
  | { kind: "move"; node: LibraryNode }
  | { kind: "trash"; node: LibraryNode };

export default function HomeScreen({ library, containerId, section, email, onRefresh, onSignOut, onAuthExpired }: Props) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [showStorage, setShowStorage] = useState(false);
  // The notes page reports changes here, before Drive has the new count.
  const [noteCount, setNoteCount] = useState<number | null>(null);
  const openNotes = noteCount ?? library.openNotes;
  const container = library.nodes.get(containerId)!;
  const path = pathTo(library, containerId);
  const workspaceId = section === "folder" ? path[0]?.id : undefined;
  const items = library.children.get(containerId) ?? [];
  const onlyOneWorkspace = library.workspaces.length <= 1;
  const usedBytes = totalUsage(library.usage);

  useEffect(() => {
    if (section === "folder") document.title = `${container.name} – My Figma App`;
  }, [container.name, section]);

  const close = () => setDialog(null);
  const common = { onClose: close, onAuthExpired };

  const menuFor = (node: LibraryNode): MenuItem[] => {
    const items: MenuItem[] = [{ label: "Rename", onSelect: () => setDialog({ kind: "rename", node }) }];
    if (node.kind !== "workspace") items.push({ label: "Move to…", onSelect: () => setDialog({ kind: "move", node }) });
    items.push({
      label: "Move to trash",
      danger: true,
      disabled: node.kind === "workspace" && onlyOneWorkspace,
      title: node.kind === "workspace" && onlyOneWorkspace ? "You need at least one workspace" : undefined,
      onSelect: () => setDialog({ kind: "trash", node }),
    });
    return items;
  };

  return (
    <div className="home">
      <aside className="sidebar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={22} height={22} />
          <span>My Figma App</span>
        </div>

        <div className="sidebar-heading">
          <span>Workspaces</span>
          <button
            type="button"
            className="icon-button"
            title="New workspace"
            aria-label="New workspace"
            onClick={() => setDialog({ kind: "newWorkspace" })}
          >
            <PlusIcon size={16} />
          </button>
        </div>
        <nav className="workspace-list">
          {library.workspaces.map((ws) => (
            <div key={ws.id} className="workspace-row" data-active={ws.id === workspaceId}>
              <button type="button" className="workspace-link" onClick={() => goToFolder(ws.id)}>
                <WorkspaceIcon size={16} />
                <span>{ws.name}</span>
              </button>
              <ItemMenu items={menuFor(ws)} label={`Options for ${ws.name}`} />
            </div>
          ))}
        </nav>

        <div className="sidebar-extra">
          <div className="workspace-row" data-active={section === "notes"}>
            <button type="button" className="workspace-link" onClick={goToNotes} title="Changes to make">
              <NoteIcon size={16} />
              <span>Notes</span>
              {openNotes > 0 && (
                <span className="notes-count" aria-label={`${openNotes} to do`}>
                  {openNotes}
                </span>
              )}
            </button>
          </div>
          <div className="workspace-row" data-active={section === "trash"}>
            <button type="button" className="workspace-link" onClick={goToTrash}>
              <TrashIcon size={16} />
              <span>Trash</span>
            </button>
          </div>
          <button type="button" className="storage-meter" onClick={() => setShowStorage(true)} title="See storage details">
            <CloudIcon size={16} />
            <span>Storage</span>
            <span className="storage-meter-value">{formatBytes(usedBytes)}</span>
          </button>
        </div>

        <div className="sidebar-footer">
          <ThemeSwitch />
          <span className="email" title={email}>
            {email}
          </span>
          <button type="button" className="link" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="content">
        {section === "trash" ? (
          <TrashView library={library} onRefresh={onRefresh} onAuthExpired={onAuthExpired} />
        ) : section === "notes" ? (
          <NotesView rootId={library.rootId} onOpenCountChange={setNoteCount} onAuthExpired={onAuthExpired} />
        ) : (
        <>
        <header className="content-header">
          <nav className="breadcrumbs" aria-label="Location">
            {path.map((node, i) => (
              <span key={node.id} className="crumb">
                {i > 0 && <ChevronIcon size={14} />}
                {i < path.length - 1 ? (
                  <button type="button" onClick={() => goToFolder(node.id)}>
                    {node.name}
                  </button>
                ) : (
                  <strong>{node.name}</strong>
                )}
              </span>
            ))}
          </nav>
          <div className="header-actions">
            <button type="button" className="secondary" onClick={() => setDialog({ kind: "newFolder" })}>
              <FolderIcon size={16} /> New folder
            </button>
            <button type="button" className="primary" onClick={() => setDialog({ kind: "newBoard" })}>
              <PlusIcon size={16} /> New board
            </button>
          </div>
        </header>

        {items.length === 0 ? (
          <div className="empty">
            <BoardIcon size={36} />
            <p>Nothing here yet.</p>
            <button type="button" className="primary" onClick={() => setDialog({ kind: "newBoard" })}>
              <PlusIcon size={16} /> New board
            </button>
          </div>
        ) : (
          <div className="grid">
            {items.map((node) =>
              node.kind === "folder" ? (
                <Tile
                  key={node.id}
                  name={node.name}
                  sub={itemCount(countItems(library, node.id))}
                  preview={<FolderIcon size={40} />}
                  folder
                  menu={menuFor(node)}
                  onOpen={() => goToFolder(node.id)}
                />
              ) : (
                <Tile
                  key={node.id}
                  name={node.name}
                  sub={`Edited ${timeAgo(node.modifiedTime)}`}
                  preview={<Thumbnail thumb={library.thumbs.get(node.id)} />}
                  menu={menuFor(node)}
                  onOpen={() => goToBoard(node.id)}
                />
              ),
            )}
          </div>
        )}
        </>
        )}
      </main>

      {showStorage && (
        <StorageDialog usage={library.usage} onClose={() => setShowStorage(false)} onAuthExpired={onAuthExpired} />
      )}

      {dialog?.kind === "newBoard" && (
        <NameDialog
          {...common}
          title="New board"
          initial="Untitled board"
          confirmLabel="Create"
          onSubmit={async (name) => goToBoard(await createBoard(containerId, name))}
        />
      )}
      {dialog?.kind === "newFolder" && (
        <NameDialog
          {...common}
          title="New folder"
          initial="New folder"
          confirmLabel="Create"
          onSubmit={async (name) => {
            await createSubfolder(containerId, name);
            await onRefresh();
          }}
        />
      )}
      {dialog?.kind === "newWorkspace" && (
        <NameDialog
          {...common}
          title="New workspace"
          initial="New workspace"
          confirmLabel="Create"
          onSubmit={async (name) => {
            const id = await createWorkspace(library, name);
            await onRefresh();
            goToFolder(id);
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          {...common}
          title={`Rename ${dialog.node.kind}`}
          initial={dialog.node.name}
          confirmLabel="Rename"
          onSubmit={async (name) => {
            await renameNode(dialog.node, name);
            await onRefresh();
          }}
        />
      )}
      {dialog?.kind === "move" && (
        <MoveDialog
          {...common}
          library={library}
          node={dialog.node}
          onMove={async (toId) => {
            await moveNode(dialog.node, toId);
            await onRefresh();
          }}
        />
      )}
      {dialog?.kind === "trash" && (
        <ConfirmDialog
          {...common}
          title={`Move "${dialog.node.name}" to trash?`}
          body={
            dialog.node.kind === "board"
              ? "It goes to your Google Drive trash. You can restore it from drive.google.com for 30 days."
              : "It and everything inside it go to your Google Drive trash. You can restore them from drive.google.com for 30 days."
          }
          confirmLabel="Move to trash"
          onConfirm={async () => {
            const node = dialog.node;
            const leavingCurrent = path.some((p) => p.id === node.id);
            await trashNode(library, node);
            if (leavingCurrent) {
              const fallback =
                node.kind === "workspace" ? library.workspaces.find((w) => w.id !== node.id)?.id : node.parentId;
              if (fallback) goToFolder(fallback);
            }
            await onRefresh();
          }}
        />
      )}
    </div>
  );
}

// ---- Pieces ----------------------------------------------------------------

function Tile({
  name,
  sub,
  preview,
  folder,
  menu,
  onOpen,
}: {
  name: string;
  sub: string;
  preview: ReactNode;
  folder?: boolean;
  menu: MenuItem[];
  onOpen: () => void;
}) {
  return (
    <div className="tile">
      <button type="button" className="tile-open" onClick={onOpen} title={name}>
        <div className="tile-preview" data-folder={folder || undefined}>
          {preview}
        </div>
        <div className="tile-meta">
          <span className="tile-name">{name}</span>
          <span className="tile-sub">{sub}</span>
        </div>
      </button>
      <div className="tile-menu">
        <ItemMenu items={menu} label={`Options for ${name}`} />
      </div>
    </div>
  );
}

function Thumbnail({ thumb }: { thumb?: Thumb }) {
  const [url, setUrl] = useState<string | null>(null);
  const id = thumb?.id;
  const version = thumb?.modifiedTime;
  useEffect(() => {
    setUrl(null);
    if (!id || !version) return;
    let alive = true;
    thumbnailUrl({ id, modifiedTime: version })
      .then((u) => alive && setUrl(u))
      .catch(() => {
        /* keep the placeholder */
      });
    return () => {
      alive = false;
    };
  }, [id, version]);
  return url ? <img src={url} alt="" draggable={false} /> : <BoardIcon size={32} />;
}

type MenuItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; title?: string };

function ItemMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="item-menu" ref={ref}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <DotsIcon size={16} />
      </button>
      {open && (
        <div className="menu-popover" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "danger-text" : undefined}
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const THEME_ICONS: Record<ThemeChoice, ReactNode> = {
  light: <SunIcon size={16} />,
  dark: <MoonIcon size={16} />,
  system: <MonitorIcon size={16} />,
};

/** Light, dark, or the computer's setting (same choice as in a board's main menu). */
function ThemeSwitch() {
  const { choice } = useTheme();
  return (
    <div className="theme-row">
      <span>Theme</span>
      <div className="theme-switch" role="radiogroup" aria-label="Theme">
        {THEME_CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={choice === c.value}
            aria-label={c.label}
            title={c.label}
            onClick={() => setThemeChoice(c.value)}
          >
            {THEME_ICONS[c.value]}
          </button>
        ))}
      </div>
    </div>
  );
}

const itemCount = (n: number) => (n === 0 ? "Empty" : n === 1 ? "1 item" : `${n} items`);

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

function timeAgo(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  if (!Number.isFinite(seconds)) return "";
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
