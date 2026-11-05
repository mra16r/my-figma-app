import { useCallback, useEffect, useState } from "react";
import { AuthExpiredError } from "../google/drive";
import { formatBytes } from "../format";
import {
  TRASH_DAYS,
  daysLeft,
  deleteForever,
  emptyTrash,
  loadTrash,
  pathTo,
  restoreItem,
  type Library,
  type Trash,
  type TrashItem,
} from "../storage/library";
import { ConfirmDialog } from "./Dialogs";
import { BoardIcon, FolderIcon, TrashIcon, WorkspaceIcon } from "./icons";

type Props = {
  library: Library;
  onRefresh: () => Promise<void>;
  onAuthExpired: () => void;
};

type Confirm = { kind: "delete"; item: TrashItem } | { kind: "empty" };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function TrashView({ library, onRefresh, onAuthExpired }: Props) {
  const [trash, setTrash] = useState<Trash | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const reload = useCallback(async () => {
    try {
      setTrash(await loadTrash());
      setError("");
    } catch (err) {
      if (err instanceof AuthExpiredError) onAuthExpired();
      else setError(message(err));
    }
  }, [onAuthExpired]);

  useEffect(() => {
    document.title = "Trash – My Figma App";
    void reload();
  }, [reload]);

  const restore = async (item: TrashItem) => {
    setBusy(item.id);
    try {
      await restoreItem(library, item);
      await Promise.all([reload(), onRefresh()]);
    } catch (err) {
      if (err instanceof AuthExpiredError) onAuthExpired();
      else setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const location = (item: TrashItem) => {
    if (item.kind === "workspace") return "Workspace";
    if (!item.parentId || !library.nodes.has(item.parentId)) {
      const parent = item.parentId ? trash?.files.find((f) => f.id === item.parentId) : undefined;
      return parent
        ? `Was in "${parent.name}", also in the trash (restores to ${library.workspaces[0]?.name ?? "a workspace"})`
        : "Original folder is gone";
    }
    return pathTo(library, item.parentId)
      .map((n) => n.name)
      .join(" / ");
  };

  const items = trash?.items ?? [];

  return (
    <>
      <header className="content-header">
        <nav className="breadcrumbs" aria-label="Location">
          <span className="crumb">
            <strong>Trash</strong>
          </span>
        </nav>
        <div className="header-actions">
          <button
            type="button"
            className="secondary"
            disabled={!items.length || busy !== null}
            onClick={() => setConfirm({ kind: "empty" })}
          >
            <TrashIcon size={16} /> Empty trash
          </button>
        </div>
      </header>

      <p className="trash-note">
        Items here are deleted for good {TRASH_DAYS} days after you trash them. Restoring a board also brings back its
        images.
      </p>

      {error && <p className="error trash-error">{error}</p>}

      {!trash && !error ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <TrashIcon size={36} />
          <p>Trash is empty.</p>
        </div>
      ) : (
        <ul className="trash-list">
          {items.map((item) => {
            const left = daysLeft(item);
            return (
              <li key={item.id} className="trash-row" data-busy={busy === item.id || undefined}>
                <span className="trash-icon">
                  {item.kind === "board" ? (
                    <BoardIcon size={18} />
                  ) : item.kind === "folder" ? (
                    <FolderIcon size={18} />
                  ) : (
                    <WorkspaceIcon size={18} />
                  )}
                </span>
                <span className="trash-main">
                  <span className="trash-name">{item.name}</span>
                  <span className="trash-sub">{location(item)}</span>
                </span>
                <span className="trash-meta">
                  <span data-soon={left !== undefined && left <= 3 ? true : undefined}>
                    {left === undefined ? "Trashed in Google Drive" : left === 0 ? "Deleted today" : `${left} day${left === 1 ? "" : "s"} left`}
                  </span>
                  <span className="trash-size">{formatBytes(item.bytes)}</span>
                </span>
                <span className="trash-actions">
                  <button type="button" className="secondary small" disabled={busy !== null} onClick={() => void restore(item)}>
                    {busy === item.id ? "Restoring…" : "Restore"}
                  </button>
                  <button
                    type="button"
                    className="link danger-link"
                    disabled={busy !== null}
                    onClick={() => setConfirm({ kind: "delete", item })}
                  >
                    Delete forever
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {confirm?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete "${confirm.item.name}" forever?`}
          body={
            confirm.item.kind === "board"
              ? "The board and its images are deleted for good. This can't be undone."
              : "It and everything inside it are deleted for good. This can't be undone."
          }
          confirmLabel="Delete forever"
          onClose={() => setConfirm(null)}
          onAuthExpired={onAuthExpired}
          onConfirm={async () => {
            await deleteForever(confirm.item);
            await Promise.all([reload(), onRefresh()]);
          }}
        />
      )}
      {confirm?.kind === "empty" && trash && (
        <ConfirmDialog
          title="Empty trash?"
          body={`Everything in the trash (${formatBytes(trash.bytes)}) is deleted for good. This can't be undone.`}
          confirmLabel="Empty trash"
          onClose={() => setConfirm(null)}
          onAuthExpired={onAuthExpired}
          onConfirm={async () => {
            await emptyTrash(trash);
            await Promise.all([reload(), onRefresh()]);
          }}
        />
      )}
    </>
  );
}
