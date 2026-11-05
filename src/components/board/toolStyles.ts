import { useSyncExternalStore } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { activeShape, isConnector } from "./shapes";
import { strokeForFill } from "./Palette";

// Each tool keeps its own look (Excalidraw has one shared "current style"),
// so picking the marker doesn't change the color of the next shape, etc.

export type ToolStyles = {
  markerColor: string;
  markerWidth: number;
  stickyColor: string;
  shapeFill: string;
  connectorColor: string;
};

export const MARKER_THIN = 1;
export const MARKER_THICK = 3;
export const SHAPE_STROKE_WIDTH = 4;
export const LINE_WIDTH = 4;
export const TEXT_COLOR = "#1e1e1e";

const KEY = "mfa.toolStyles";
const DEFAULTS: ToolStyles = {
  markerColor: "#1e1e1e",
  markerWidth: MARKER_THIN,
  stickyColor: "#ffe299",
  shapeFill: "#ffffff",
  connectorColor: "#757575",
};

let styles: ToolStyles = (() => {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<ToolStyles>) };
  } catch {
    return DEFAULTS;
  }
})();
const listeners = new Set<() => void>();

export const getToolStyles = () => styles;

export function setToolStyles(patch: Partial<ToolStyles>): void {
  styles = { ...styles, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(styles));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

export function useToolStyles(): ToolStyles {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => styles,
  );
}

/** What the next new item drawn with the current tool should look like. */
function wanted(api: ExcalidrawImperativeAPI): Record<string, unknown> | null {
  const s = api.getAppState();
  const tool = s.activeTool.type;
  const shape = activeShape(api);
  if (tool === "freedraw") return { currentItemStrokeColor: styles.markerColor, currentItemStrokeWidth: styles.markerWidth };
  if (shape && isConnector(shape)) return { currentItemStrokeColor: styles.connectorColor, currentItemStrokeWidth: LINE_WIDTH };
  if (shape)
    return {
      currentItemBackgroundColor: styles.shapeFill,
      currentItemStrokeColor: strokeForFill(styles.shapeFill) ?? "#757575",
      currentItemStrokeWidth: SHAPE_STROKE_WIDTH,
    };
  if (tool === "text") return { currentItemStrokeColor: TEXT_COLOR };
  return null;
}

/** Puts the current tool's own style in place (cheap when nothing changes). */
export function applyToolStyle(api: ExcalidrawImperativeAPI): void {
  const want = wanted(api);
  if (!want) return;
  const s = api.getAppState() as unknown as Record<string, unknown>;
  if (Object.entries(want).every(([k, v]) => s[k] === v)) return;
  api.updateScene({ appState: want as never });
}
