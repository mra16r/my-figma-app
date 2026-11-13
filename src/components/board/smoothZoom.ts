// Zoom that glides instead of jumping: Ctrl+scroll, pinch, the zoom buttons and
// keys. Each step goes as far as Excalidraw's own; it just eases into place.

import { useEffect } from "react";
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from "@excalidraw/excalidraw/types";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;
const clamp = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** How quickly the zoom settles (time constant): buttons and wheel clicks glide… */
const GLIDE_MS = 55;
/** …pinching barely lags, so it stays under the fingers. */
const PINCH_MS = 18;
/** Shapes are drawn again sharp this long after the zoom stops. */
const SHARPEN_AFTER_MS = 300;

type Glide = {
  target: number;
  /** The point that stays put, in px from the canvas' top left. */
  x: number;
  y: number;
  ms: number;
  last: number;
};

const glides = new WeakMap<ExcalidrawImperativeAPI, Glide>();
const sharpenTimers = new WeakMap<ExcalidrawImperativeAPI, number>();

/** Where the zoom is heading (the current zoom when it isn't moving). */
export function zoomTarget(api: ExcalidrawImperativeAPI): number {
  return glides.get(api)?.target ?? api.getAppState().zoom.value;
}

/** Glides the zoom to `target`, keeping the canvas point (x, y) where it is on screen. */
export function glideZoom(api: ExcalidrawImperativeAPI, target: number, x: number, y: number, ms = GLIDE_MS) {
  const running = glides.get(api);
  const glide = { target: clamp(target), x, y, ms, last: running?.last ?? performance.now() };
  glides.set(api, glide);
  window.clearTimeout(sharpenTimers.get(api));
  if (running) return; // the frame loop already going picks it up

  const step = (now: number) => {
    const g = glides.get(api);
    if (!g) return;
    const s = api.getAppState();
    const from = s.zoom.value;
    const dt = Math.min(50, Math.max(0, now - g.last));
    g.last = now;
    // Eased in log space, so zooming in and out feel the same.
    const k = 1 - Math.exp(-dt / g.ms);
    let next = from * Math.pow(g.target / from, k);
    const done = Math.abs(Math.log(g.target / next)) < 0.002;
    if (done) next = g.target;
    api.updateScene({
      appState: {
        zoom: { value: next as NormalizedZoomValue },
        scrollX: s.scrollX + g.x / next - g.x / from,
        scrollY: s.scrollY + g.y / next - g.y / from,
        // Like Excalidraw's own zoom: reuse the drawn shapes while moving (fast), sharpen after.
        shouldCacheIgnoreZoom: true,
      },
    });
    if (!done) {
      requestAnimationFrame(step);
      return;
    }
    glides.delete(api);
    sharpenTimers.set(
      api,
      window.setTimeout(() => api.updateScene({ appState: { shouldCacheIgnoreZoom: false } }), SHARPEN_AFTER_MS),
    );
  };
  requestAnimationFrame(step);
}

/** Excalidraw's step for one wheel event (so it zooms as far as before). */
function wheelStep(zoom: number, deltaY: number): number {
  const sign = Math.sign(deltaY);
  const abs = Math.abs(deltaY);
  const delta = Math.min(abs, 10) * sign;
  return zoom - delta / 100 + Math.log10(Math.max(1, zoom)) * -sign * Math.min(1, abs / 20);
}

/** Ctrl+scroll (and trackpad pinch, which the browser sends as Ctrl+scroll) on the canvas. */
export function useSmoothWheelZoom(api: ExcalidrawImperativeAPI | null, root: HTMLElement | null) {
  useEffect(() => {
    if (!api || !root) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // Where Excalidraw zooms (it ignores the rest, and blocks the browser's zoom).
      if (!(e.target instanceof HTMLCanvasElement || e.target instanceof HTMLTextAreaElement)) return;
      e.preventDefault();
      e.stopPropagation(); // Excalidraw's own wheel zoom would jump
      // In px (Firefox can count in lines or pages).
      const deltaY = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
      if (!deltaY) return;
      const s = api.getAppState();
      // Mouse wheels move in big clicks; trackpads in many small steps.
      const ms = Math.abs(deltaY) >= 40 ? GLIDE_MS : PINCH_MS;
      glideZoom(api, wheelStep(zoomTarget(api), deltaY), e.clientX - s.offsetLeft, e.clientY - s.offsetTop, ms);
    };
    root.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => root.removeEventListener("wheel", onWheel, { capture: true });
  }, [api, root]);
}
