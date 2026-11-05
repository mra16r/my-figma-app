import { useEffect, useState } from "react";
import { AuthExpiredError, getStorageQuota, type StorageQuota } from "../google/drive";
import { formatBytes } from "../format";
import { goToTrash } from "../router";
import { TRASH_DAYS, totalUsage, type Usage } from "../storage/library";
import { Modal } from "./Dialogs";

type Props = {
  usage: Usage;
  onClose: () => void;
  onAuthExpired: () => void;
};

export default function StorageDialog({ usage, onClose, onAuthExpired }: Props) {
  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getStorageQuota()
      .then((q) => alive && setQuota(q))
      .catch((err) => {
        if (err instanceof AuthExpiredError) onAuthExpired();
        else if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [onAuthExpired]);

  const appBytes = totalUsage(usage);
  const rows: [string, number, string][] = [
    ["Boards", usage.boards, "var(--seg-boards)"],
    ["Images", usage.images, "var(--seg-images)"],
    ["Previews", usage.previews, "var(--seg-previews)"],
    ["Trash", usage.trash, "var(--seg-trash)"],
  ];

  const pct = (n: number) => (quota?.limit ? Math.max(0, Math.min(100, (n / quota.limit) * 100)) : 0);

  return (
    <Modal title="Storage" onClose={onClose}>
      <div className="storage">
        <div className="storage-total">
          <strong>{formatBytes(appBytes)}</strong>
          <span>used by My Figma App in your Google Drive</span>
        </div>

        <ul className="storage-rows">
          {rows.map(([label, bytes, color]) => (
            <li key={label}>
              <span className="storage-dot" style={{ background: color }} />
              <span className="storage-label">{label}</span>
              <span className="storage-value">{formatBytes(bytes)}</span>
            </li>
          ))}
        </ul>

        {quota ? (
          <div className="storage-account">
            <div className="storage-bar" aria-hidden>
              <span className="storage-bar-app" style={{ width: `${Math.max(pct(appBytes), appBytes ? 0.6 : 0)}%` }} />
              <span className="storage-bar-other" style={{ width: `${pct(Math.max(0, quota.usage - appBytes))}%` }} />
            </div>
            <div className="storage-legend">
              <span>
                <span className="storage-dot" style={{ background: "var(--seg-app)" }} /> This app
              </span>
              <span>
                <span className="storage-dot" style={{ background: "var(--seg-other)" }} /> Everything else
              </span>
            </div>
            <p className="muted small">
              {quota.limit
                ? `Your Google account uses ${formatBytes(quota.usage)} of ${formatBytes(quota.limit)}, shared with Gmail and Google Photos.`
                : `Your Google account uses ${formatBytes(quota.usage)}.`}
            </p>
          </div>
        ) : (
          !error && <p className="muted small">Checking your Google account…</p>
        )}

        {error && <p className="error">{error}</p>}

        {usage.trash > 0 && (
          <p className="muted small">
            Trashed items still count until they're deleted, {TRASH_DAYS} days after trashing or right away with Empty
            trash.{" "}
            <button
              type="button"
              className="link"
              onClick={() => {
                onClose();
                goToTrash();
              }}
            >
              Open trash
            </button>
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
