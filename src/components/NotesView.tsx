import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { AuthExpiredError } from "../google/drive";
import { loadNotes, saveNotes, type Note } from "../storage/notes";
import { ConfirmDialog } from "./Dialogs";
import { CloseIcon, PlusIcon } from "./icons";

type Props = {
  rootId: string;
  /** Tells the sidebar how many notes are left to do. */
  onOpenCountChange: (count: number) => void;
  onAuthExpired: () => void;
};

type Status = "idle" | "saving" | "saved" | "error";

/** Wait this long after the last change before saving to Drive. */
const SAVE_DELAY = 600;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const openCount = (notes: Note[]) => notes.filter((n) => !n.done).length;

/** Personal notes: changes to make, written down so they don't get lost. */
export default function NotesView({ rootId, onOpenCountChange, onAuthExpired }: Props) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [saveError, setSaveError] = useState("");
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const latest = useRef<Note[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  /** Changes not sent to Drive yet. */
  const pending = useRef(false);
  const inFlight = useRef(0);

  useEffect(() => {
    document.title = "Notes – My Figma App";
    let alive = true;
    loadNotes()
      .then((list) => {
        if (!alive) return;
        latest.current = list;
        setNotes(list);
        onOpenCountChange(openCount(list));
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof AuthExpiredError) onAuthExpired();
        else setLoadError(message(err));
      });
    return () => {
      alive = false;
    };
  }, [onAuthExpired, onOpenCountChange]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (!pending.current || !latest.current) return;
    pending.current = false;
    inFlight.current++;
    setStatus("saving");
    saveNotes(rootId, latest.current)
      .then(() => {
        inFlight.current--;
        if (!pending.current && inFlight.current === 0) setStatus("saved");
      })
      .catch((err) => {
        inFlight.current--;
        pending.current = true; // try again with the next change, or Retry
        if (err instanceof AuthExpiredError) onAuthExpired();
        setSaveError(message(err));
        setStatus("error");
      });
  }, [rootId, onAuthExpired]);

  // Leaving the page: save right away instead of waiting.
  useEffect(() => () => flush(), [flush]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!pending.current && inFlight.current === 0) return;
      flush();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [flush]);

  const update = (change: (list: Note[]) => Note[]) => {
    const next = change(latest.current ?? []);
    latest.current = next;
    setNotes(next);
    onOpenCountChange(openCount(next));
    pending.current = true;
    setStatus("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    const note: Note = { id: crypto.randomUUID(), text, done: false, createdTime: new Date().toISOString() };
    update((list) => [note, ...list]);
    setDraft("");
  };

  // Ticking a note (or unticking it) brings it to the top of its list.
  const toggle = (id: string) =>
    update((list) => {
      const note = list.find((n) => n.id === id);
      return note ? [{ ...note, done: !note.done }, ...list.filter((n) => n.id !== id)] : list;
    });
  const edit = (id: string, text: string) => update((list) => list.map((n) => (n.id === id ? { ...n, text } : n)));
  const remove = (id: string) => update((list) => list.filter((n) => n.id !== id));

  const open = notes?.filter((n) => !n.done) ?? [];
  const done = notes?.filter((n) => n.done) ?? [];

  return (
    <>
      <header className="content-header">
        <nav className="breadcrumbs" aria-label="Location">
          <span className="crumb">
            <strong>Notes</strong>
          </span>
        </nav>
        <div className="header-actions">
          <span className="notes-status" data-status={status} role="status">
            {status === "saving" && "Saving…"}
            {status === "saved" && "Saved"}
            {status === "error" && (
              <>
                <span title={saveError}>Couldn't save</span>
                <button type="button" className="secondary small" onClick={() => flush()}>
                  Retry
                </button>
              </>
            )}
          </span>
          {done.length > 0 && (
            <button type="button" className="secondary" onClick={() => setConfirmClear(true)}>
              Clear done ({done.length})
            </button>
          )}
        </div>
      </header>

      <p className="notes-intro">Changes to make, just for you. Saved in your Google Drive.</p>

      {loadError ? (
        <p className="error">{loadError}</p>
      ) : !notes ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="notes">
          <form
            className="note-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <AutoTextarea
              className="note-add-input"
              value={draft}
              onChange={setDraft}
              placeholder="Write down a change to make…"
              aria-label="New note"
              autoFocus
              onKeyDown={(e) => {
                if (isEnter(e)) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="submit" className="primary small" disabled={!draft.trim()}>
              <PlusIcon size={16} /> Add
            </button>
          </form>

          {notes.length === 0 && <p className="muted notes-empty">Nothing written down yet. Press Enter to add a note.</p>}
          {notes.length > 0 && open.length === 0 && <p className="muted notes-empty">All done.</p>}

          {open.length > 0 && (
            <ul className="note-list">
              {open.map((n) => (
                <NoteRow key={n.id} note={n} onToggle={toggle} onEdit={edit} onDelete={remove} />
              ))}
            </ul>
          )}

          {done.length > 0 && (
            <>
              <h3 className="notes-heading">Done</h3>
              <ul className="note-list">
                {done.map((n) => (
                  <NoteRow key={n.id} note={n} onToggle={toggle} onEdit={edit} onDelete={remove} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear done notes?"
          body={`${done.length} done note${done.length === 1 ? " is" : "s are"} removed. This can't be undone.`}
          confirmLabel="Clear done"
          onClose={() => setConfirmClear(false)}
          onAuthExpired={onAuthExpired}
          onConfirm={async () => update((list) => list.filter((n) => !n.done))}
        />
      )}
    </>
  );
}

function NoteRow({
  note,
  onToggle,
  onEdit,
  onDelete,
}: {
  note: Note;
  onToggle: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <li className="note-row" data-done={note.done || undefined}>
      <input
        type="checkbox"
        className="note-check"
        checked={note.done}
        onChange={() => onToggle(note.id)}
        aria-label={note.done ? "Mark as not done" : "Mark as done"}
      />
      <AutoTextarea
        className="note-text"
        value={note.text}
        onChange={(text) => onEdit(note.id, text)}
        aria-label="Note"
        onBlur={() => {
          if (!note.text.trim()) onDelete(note.id);
        }}
        onKeyDown={(e) => {
          if (isEnter(e) || e.key === "Escape") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <button
        type="button"
        className="icon-button note-delete"
        title="Delete"
        aria-label="Delete note"
        onClick={() => onDelete(note.id)}
      >
        <CloseIcon size={16} />
      </button>
    </li>
  );
}

/** Enter (not Shift+Enter, which makes a new line). */
const isEnter = (e: KeyboardEvent) => e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;

/** A text box that grows with its text. */
function AutoTextarea({
  value,
  onChange,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, []);
  useLayoutEffect(fit, [value, fit]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
