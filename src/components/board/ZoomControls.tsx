import { useEffect, useState } from "react";
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import { Menu, useMenu } from "./Menu";
import { HelpIcon, MinusIcon, PlusIcon } from "./icons";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;

/** Zooms around the middle of the screen. */
export function zoomTo(api: ExcalidrawImperativeAPI, value: number): void {
  const s = api.getAppState();
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  const cx = s.width / 2;
  const cy = s.height / 2;
  api.updateScene({
    appState: {
      zoom: { value: next as NormalizedZoomValue },
      scrollX: s.scrollX + cx / next - cx / s.zoom.value,
      scrollY: s.scrollY + cy / next - cy / s.zoom.value,
    },
  });
}

export const zoomBy = (api: ExcalidrawImperativeAPI, factor: number) =>
  zoomTo(api, api.getAppState().zoom.value * factor);

export const zoomToFit = (api: ExcalidrawImperativeAPI) => {
  if (api.getSceneElements().length === 0) return zoomTo(api, 1);
  api.scrollToContent(undefined, { fitToContent: true, animate: true, duration: 250 });
};

export function ZoomControls({ api, onHelp }: { api: ExcalidrawImperativeAPI; onHelp: () => void }) {
  const [zoom, setZoom] = useState(() => api.getAppState().zoom.value);
  const menu = useMenu();

  useEffect(() => {
    const update = () => setZoom(api.getAppState().zoom.value);
    const offs = [api.onScrollChange(update), api.onChange(update)];
    return () => offs.forEach((off) => off());
  }, [api]);

  return (
    <div className="fx-zoom">
      <div className="fx-panel fx-zoom-panel">
        <button
          type="button"
          className="fx-icon-button"
          data-tip="Zoom out  Ctrl+−"
          aria-label="Zoom out"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => zoomBy(api, 1 / 1.25)}
        >
          <MinusIcon />
        </button>
        <button
          type="button"
          className="fx-zoom-value"
          data-open={!!menu.anchor || undefined}
          aria-label="Zoom options"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => menu.toggle(e.currentTarget)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="fx-icon-button"
          data-tip="Zoom in  Ctrl++"
          aria-label="Zoom in"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => zoomBy(api, 1.25)}
        >
          <PlusIcon />
        </button>
      </div>
      <button
        type="button"
        className="fx-panel fx-help-button"
        data-tip="Keyboard shortcuts  ?"
        aria-label="Keyboard shortcuts"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onHelp}
      >
        <HelpIcon />
      </button>
      {menu.anchor && (
        <Menu
          anchor={menu.anchor}
          side="above"
          align="end"
          onClose={menu.close}
          entries={[
            { label: "Zoom in", shortcut: "Ctrl++", onSelect: () => zoomBy(api, 1.25) },
            { label: "Zoom out", shortcut: "Ctrl+−", onSelect: () => zoomBy(api, 1 / 1.25) },
            { separator: true },
            { label: "Zoom to fit", shortcut: "Shift+1", onSelect: () => zoomToFit(api) },
            { label: "Zoom to 50%", onSelect: () => zoomTo(api, 0.5) },
            { label: "Zoom to 100%", shortcut: "Shift+0", onSelect: () => zoomTo(api, 1) },
            { label: "Zoom to 200%", onSelect: () => zoomTo(api, 2) },
          ]}
        />
      )}
    </div>
  );
}
