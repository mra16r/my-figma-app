import { useEffect, useRef, useState, type ReactNode } from "react";
import { AuthExpiredError } from "../google/drive";
import type { Library, LibraryNode } from "../storage/library";
import { descendants } from "../storage/library";
import { FolderIcon, WorkspaceIcon } from "./icons";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Runs an async action with a busy state; shows errors inline. */
function useAction(onDone: () => void, onAuthExpired: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      onDone();
    } catch (err) {
      if (err instanceof AuthExpiredError) onAuthExpired();
      else setError(message(err));
      setBusy(false);
    }
  };
  return { busy, error, run };
}

type Common = { onClose: () => void; onAuthExpired: () => void };

export function NameDialog({
  title,
  initial = "",
  confirmLabel,
  onSubmit,
  onClose,
  onAuthExpired,
}: Common & { title: string; initial?: string; confirmLabel: string; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, run } = useAction(onClose, onAuthExpired);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const trimmed = name.trim();
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) void run(() => onSubmit(trimmed));
        }}
      >
        <input
          ref={input}
          className="text-input"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          aria-label="Name"
        />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!trimmed || busy}>
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  onAuthExpired,
}: Common & { title: string; body: ReactNode; confirmLabel: string; onConfirm: () => Promise<void> }) {
  const { busy, error, run } = useAction(onClose, onAuthExpired);
  return (
    <Modal title={title} onClose={onClose}>
      <p className="modal-text">{body}</p>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="danger" disabled={busy} onClick={() => void run(onConfirm)}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function MoveDialog({
  library,
  node,
  onMove,
  onClose,
  onAuthExpired,
}: Common & { library: Library; node: LibraryNode; onMove: (toId: string) => Promise<void> }) {
  const [target, setTarget] = useState<string | null>(null);
  const { busy, error, run } = useAction(onClose, onAuthExpired);

  // A folder can't move into itself or anything inside it.
  const blocked = new Set([node.id, ...descendants(library, node.id).map((n) => n.id)]);

  const rows: { node: LibraryNode; depth: number }[] = [];
  const walk = (parent: LibraryNode, depth: number) => {
    if (blocked.has(parent.id)) return;
    rows.push({ node: parent, depth });
    for (const child of library.children.get(parent.id) ?? []) {
      if (child.kind === "folder") walk(child, depth + 1);
    }
  };
  library.workspaces.forEach((ws) => walk(ws, 0));

  return (
    <Modal title={`Move "${node.name}"`} onClose={onClose}>
      <div className="move-list" role="listbox" aria-label="Destination">
        {rows.map(({ node: dest, depth }) => {
          const current = dest.id === node.parentId;
          return (
            <button
              key={dest.id}
              type="button"
              role="option"
              aria-selected={target === dest.id}
              className="move-row"
              data-selected={target === dest.id}
              disabled={current}
              style={{ paddingLeft: 12 + depth * 18 }}
              onClick={() => setTarget(dest.id)}
            >
              {dest.kind === "workspace" ? <WorkspaceIcon size={16} /> : <FolderIcon size={16} />}
              <span>{dest.name}</span>
              {current && <span className="muted small">(current)</span>}
            </button>
          );
        })}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={!target || busy}
          onClick={() => target && void run(() => onMove(target))}
        >
          {busy ? "Moving…" : "Move here"}
        </button>
      </div>
    </Modal>
  );
}
