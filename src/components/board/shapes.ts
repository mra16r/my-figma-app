import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith,
  ROUNDNESS,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

// Everything the Shapes tray offers. Excalidraw draws most of them itself;
// triangles are closed lines that this app draws (custom tool).

export type ShapeKind =
  | "elbow"
  | "curved"
  | "straight"
  | "line"
  | "square"
  | "rounded"
  | "circle"
  | "diamond"
  | "triangle"
  | "triangle-down";

export const CONNECTORS: ShapeKind[] = ["elbow", "curved", "straight", "line"];
export const SHAPES: ShapeKind[] = ["square", "rounded", "circle", "diamond", "triangle", "triangle-down"];

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  elbow: "Elbow connector",
  curved: "Curved connector",
  straight: "Arrow",
  line: "Line",
  square: "Square",
  rounded: "Rounded square",
  circle: "Ellipse",
  diamond: "Diamond",
  triangle: "Triangle",
  "triangle-down": "Down triangle",
};

export const isConnector = (k: ShapeKind) => CONNECTORS.includes(k);

/** Picks a shape or connector as the drawing tool. */
export function selectShape(api: ExcalidrawImperativeAPI, kind: ShapeKind): void {
  switch (kind) {
    case "elbow":
    case "curved":
    case "straight":
      api.updateScene({
        appState: { currentItemArrowType: kind === "elbow" ? "elbow" : kind === "curved" ? "round" : "sharp" },
      });
      api.setActiveTool({ type: "arrow" });
      break;
    case "line":
      api.setActiveTool({ type: "line" });
      break;
    case "square":
    case "rounded":
      api.updateScene({ appState: { currentItemRoundness: kind === "rounded" ? "round" : "sharp" } });
      api.setActiveTool({ type: "rectangle" });
      break;
    case "circle":
      api.setActiveTool({ type: "ellipse" });
      break;
    case "diamond":
      api.updateScene({ appState: { currentItemRoundness: "sharp" } });
      api.setActiveTool({ type: "diamond" });
      break;
    case "triangle":
    case "triangle-down":
      api.setActiveTool({ type: "custom", customType: kind });
      break;
  }
}

/** The shape tool currently active, if any. */
export function activeShape(api: ExcalidrawImperativeAPI): ShapeKind | null {
  const s = api.getAppState();
  const t = s.activeTool;
  if (t.type === "custom") return t.customType === "triangle" || t.customType === "triangle-down" ? t.customType : null;
  if (t.type === "arrow") return s.currentItemArrowType === "elbow" ? "elbow" : s.currentItemArrowType === "round" ? "curved" : "straight";
  if (t.type === "line") return "line";
  if (t.type === "rectangle") return s.currentItemRoundness === "round" ? "rounded" : "square";
  if (t.type === "ellipse") return "circle";
  if (t.type === "diamond") return "diamond";
  return null;
}

/** What a selected element is, in tray terms (null for anything else). */
export function shapeOf(el: ExcalidrawElement): ShapeKind | null {
  if (el.customData?.kind === "sticky") return null;
  if (el.type === "rectangle") return el.roundness ? "rounded" : "square";
  if (el.type === "ellipse") return "circle";
  if (el.type === "diamond") return "diamond";
  if (el.type === "line" && (el.customData?.shape === "triangle" || el.customData?.shape === "triangle-down"))
    return el.customData.shape;
  return null;
}

export const isBoxShape = (k: ShapeKind | null) => k === "square" || k === "rounded" || k === "circle" || k === "diamond";
export const isTriangle = (k: ShapeKind | null) => k === "triangle" || k === "triangle-down";

function trianglePoints(kind: "triangle" | "triangle-down", w: number, h: number): [number, number][] {
  return kind === "triangle"
    ? [
        [w / 2, 0],
        [w, h],
        [0, h],
        [w / 2, 0],
      ]
    : [
        [0, 0],
        [w, 0],
        [w / 2, h],
        [0, 0],
      ];
}

/** Builds a triangle (a closed line, so it can be filled). */
export function makeTriangle(
  api: ExcalidrawImperativeAPI,
  kind: "triangle" | "triangle-down",
  box: { x: number; y: number; width: number; height: number },
  style?: Partial<ExcalidrawElement>,
): ExcalidrawElement {
  const s = api.getAppState();
  const points = trianglePoints(kind, box.width, box.height);
  const [el] = convertToExcalidrawElements([
    {
      type: "line",
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      points,
      backgroundColor: s.currentItemBackgroundColor,
      strokeColor: s.currentItemStrokeColor,
      strokeWidth: s.currentItemStrokeWidth,
      strokeStyle: s.currentItemStrokeStyle,
      fillStyle: "solid",
      roughness: 0,
      roundness: null,
      opacity: s.currentItemOpacity,
      customData: { shape: kind },
      ...(style as object),
    } as never,
  ]);
  // Make sure the stored size matches the points (it's used for resizing).
  return newElementWith(el, { points, width: box.width, height: box.height } as never);
}

/**
 * The box a line really covers. Its points can start anywhere (after a reload
 * Excalidraw anchors x/y to the first point), so measure from the points.
 */
function pointsBox(el: ExcalidrawElement & { points: readonly (readonly [number, number])[] }) {
  const xs = el.points.map((p) => p[0]);
  const ys = el.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: el.x + minX, y: el.y + minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/**
 * Changes the selected shapes to another kind, keeping place, size and colors.
 * Squares, circles and diamonds switch freely (text stays inside); a shape
 * only becomes a triangle (or back) when it has no text or connectors.
 */
export function convertShapes(api: ExcalidrawImperativeAPI, to: ShapeKind): void {
  const selected = api.getAppState().selectedElementIds;
  const all = api.getSceneElementsIncludingDeleted();
  const added: ExcalidrawElement[] = [];
  const newSelection: Record<string, true> = {};

  const next = all.map((el) => {
    if (!selected[el.id] || el.isDeleted) return el;
    const from = shapeOf(el);
    if (!from || from === to) {
      newSelection[el.id] = true;
      return el;
    }
    if (isBoxShape(from) && isBoxShape(to)) {
      newSelection[el.id] = true;
      const type = to === "circle" ? "ellipse" : to === "diamond" ? "diamond" : "rectangle";
      const roundness =
        to === "rounded" ? { type: ROUNDNESS.ADAPTIVE_RADIUS } : to === "diamond" || to === "square" ? null : el.roundness;
      return newElementWith(el, { type, roundness } as never);
    }
    if (isTriangle(from) && isTriangle(to) && "points" in el) {
      newSelection[el.id] = true;
      const box = pointsBox(el);
      return newElementWith(el, {
        ...box,
        points: trianglePoints(to as "triangle", box.width, box.height),
        customData: { ...el.customData, shape: to },
      } as never);
    }
    // Box ↔ triangle: rebuild, but only for plain shapes.
    if (el.boundElements?.length) {
      newSelection[el.id] = true;
      return el;
    }
    const style = {
      strokeColor: el.strokeColor,
      backgroundColor: el.backgroundColor,
      strokeWidth: el.strokeWidth,
      strokeStyle: el.strokeStyle,
      opacity: el.opacity,
      angle: el.angle,
    };
    const box = "points" in el ? pointsBox(el) : { x: el.x, y: el.y, width: el.width, height: el.height };
    let replacement: ExcalidrawElement;
    if (isTriangle(to)) {
      replacement = makeTriangle(api, to as "triangle", box, style);
    } else {
      const type = to === "circle" ? "ellipse" : to === "diamond" ? "diamond" : "rectangle";
      [replacement] = convertToExcalidrawElements([
        {
          type,
          ...box,
          ...style,
          fillStyle: "solid",
          roughness: 0,
          roundness: to === "rounded" ? { type: ROUNDNESS.ADAPTIVE_RADIUS } : null,
        } as never,
      ]);
    }
    added.push(replacement);
    newSelection[replacement.id] = true;
    return newElementWith(el, { isDeleted: true });
  });

  api.updateScene({
    elements: [...next, ...added],
    appState: { selectedElementIds: newSelection },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** Can this selection become a triangle (or a box, from a triangle)? */
export function canConvert(el: ExcalidrawElement, to: ShapeKind): boolean {
  const from = shapeOf(el);
  if (!from) return false;
  if (isBoxShape(from) === isBoxShape(to)) return true;
  return !el.boundElements?.length;
}
