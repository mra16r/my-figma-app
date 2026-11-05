import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from "@excalidraw/excalidraw/types";
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

/** Bottom right: zoom out / in, and help (zoom levels are in the main menu, under View). */
export function ZoomControls({ api, onHelp }: { api: ExcalidrawImperativeAPI; onHelp: () => void }) {
  return (
    <div className="fx-zoom" role="toolbar" aria-label="Help/zoom toolbar">
      <div className="fx-zoom-pill">
        <button
          type="button"
          className="fx-zoom-btn"
          data-tip="Zoom out  Ctrl+−"
          aria-label="Zoom out"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => zoomBy(api, 1 / 1.25)}
        >
          <MinusIcon />
        </button>
        <span className="fx-zoom-sep" />
        <button
          type="button"
          className="fx-zoom-btn"
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
        className="fx-help-button"
        data-tip="Keyboard shortcuts  ?"
        aria-label="Help"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onHelp}
      >
        <HelpIcon />
      </button>
    </div>
  );
}
