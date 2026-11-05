import { Menu, useMenu } from "./Menu";

export type SaveStatus = "saved" | "unsaved" | "saving" | "expired" | "error";

type Props = {
  status: SaveStatus;
  errorText: string;
  imagesLeft: number;
  email: string;
  onReconnect: () => void;
  onSignOut: () => void;
};

export function TopRightBar({ status, errorText, imagesLeft, email, onReconnect, onSignOut }: Props) {
  const menu = useMenu();
  const label =
    status === "expired"
      ? "Sign-in expired"
      : status === "error"
        ? "Couldn't save, retrying"
        : status === "saving" || status === "unsaved"
          ? "Saving…"
          : imagesLeft > 0
            ? `Loading ${imagesLeft} image${imagesLeft > 1 ? "s" : ""}…`
            : "Saved";

  return (
    <div className="fx-panel fx-topright">
      <span className="fx-save" data-status={status} title={errorText || undefined}>
        <span className="fx-save-dot" />
        {label}
      </span>
      {status === "expired" && (
        <button type="button" className="fx-button fx-button--primary" onClick={onReconnect}>
          Reconnect
        </button>
      )}
      <button
        type="button"
        className="fx-avatar"
        aria-label="Account"
        data-open={!!menu.anchor || undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        {(email[0] ?? "?").toUpperCase()}
      </button>
      {menu.anchor && (
        <Menu
          anchor={menu.anchor}
          align="end"
          onClose={menu.close}
          entries={[{ heading: email }, { label: "Sign out", onSelect: onSignOut }]}
        />
      )}
    </div>
  );
}
