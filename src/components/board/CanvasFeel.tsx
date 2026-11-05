import { useEffect, useRef } from "react";
import { sceneCoordsToViewportCoords, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

// A black arrow pointer, drawn for this app, used on the canvas and the board UI.
const ARROW_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<path d='M5.5 3.2v15.6l4.1-3.9 2.6 5.9 2.7-1.2-2.6-5.8 5.6-.2z' fill='%23000' stroke='%23fff' stroke-width='1.3' stroke-linejoin='round'/></svg>";
export const ARROW_CURSOR = `url("data:image/svg+xml,${ARROW_SVG.replace(/"/g, "'").replace(/</g, "%3C").replace(/>/g, "%3E")}") 5 3, default`;

export const STICKY_SIZE = 200;

/**
 * Excalidraw shows a "move" cross over shapes and a hand over handles.
 * Replace those with the plain arrow, like Figma.
 */
export function useArrowCursor(container: HTMLElement | null): void {
  useEffect(() => {
    // Menus render at the page root, so the cursor variable lives there.
    document.documentElement.style.setProperty("--fx-cursor", ARROW_CURSOR);
    return () => {
      document.documentElement.style.removeProperty("--fx-cursor");
    };
  }, []);

  useEffect(() => {
    // Watch Excalidraw's whole area: its canvas may be created after this runs.
    const root = container?.querySelector<HTMLElement>(".excalidraw");
    if (!root) return;
    const fix = (el: Element) => {
      if (!(el instanceof HTMLCanvasElement) || !el.classList.contains("interactive")) return;
      const c = el.style.cursor;
      if (c === "move" || c === "pointer") el.style.cursor = ARROW_CURSOR;
    };
    root.querySelectorAll("canvas").forEach(fix);
    const observer = new MutationObserver((records) => records.forEach((r) => fix(r.target as Element)));
    observer.observe(root, { attributes: true, attributeFilter: ["style"], subtree: true });
    return () => observer.disconnect();
  }, [container]);
}

/** Moves the dot grid with the canvas (CSS variables on the page element). */
export function useDotGrid(api: ExcalidrawImperativeAPI | null, page: HTMLElement | null): void {
  useEffect(() => {
    if (!api || !page) return;
    const BASE = 24;
    const apply = (scrollX: number, scrollY: number, zoom: number) => {
      let size = BASE * zoom;
      while (size < 14) size *= 2; // keep dots from crowding when zoomed out
      page.style.setProperty("--grid-size", `${size}px`);
      page.style.setProperty("--grid-x", `${(scrollX * zoom) % size}px`);
      page.style.setProperty("--grid-y", `${(scrollY * zoom) % size}px`);
      page.style.setProperty("--grid-dot", `${zoom < 0.3 ? 0.8 : 1}px`);
    };
    const s = api.getAppState();
    apply(s.scrollX, s.scrollY, s.zoom.value);
    return api.onScrollChange((x, y, z) => apply(x, y, z.value));
  }, [api, page]);
}

// ---- Hover outline and sticky preview --------------------------------------

type Point = { x: number; y: number };

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const isLinear = (el: ExcalidrawElement) => el.type === "arrow" || el.type === "line" || el.type === "freedraw";
const isFrame = (el: ExcalidrawElement) => el.type === "frame" || el.type === "magicframe";

/** Ray casting: is the point inside the polygon? */
function insidePolygon(p: Point, pts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function hits(el: ExcalidrawElement, p: Point, tol: number): boolean {
  if (isLinear(el) && "points" in el) {
    const pts = el.points.map(([x, y]) => ({ x: el.x + x, y: el.y + y }));
    const reach = tol + el.strokeWidth / 2;
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= reach;
    for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= reach) return true;
    // Closed, filled lines (like triangles) are picked anywhere inside.
    const first = pts[0];
    const last = pts[pts.length - 1];
    const closed = Math.hypot(first.x - last.x, first.y - last.y) < 1;
    return closed && el.backgroundColor !== "transparent" && insidePolygon(p, pts);
  }
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const cos = Math.cos(-el.angle);
  const sin = Math.sin(-el.angle);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const lx = Math.abs(dx * cos - dy * sin);
  const ly = Math.abs(dx * sin + dy * cos);
  const hw = Math.abs(el.width) / 2;
  const hh = Math.abs(el.height) / 2;
  if (lx > hw + tol || ly > hh + tol) return false;
  // Shapes without fill are only picked by their outline (same as clicking them).
  const hollow =
    (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") &&
    el.backgroundColor === "transparent" &&
    !el.customData?.kind;
  if (!hollow) return true;
  const edge = tol + el.strokeWidth * 2;
  return lx > hw - edge || ly > hh - edge;
}

/** Topmost element under the pointer (shapes before sections). */
function elementAt(elements: readonly ExcalidrawElement[], p: Point, zoom: number): ExcalidrawElement | null {
  const tol = 4 / zoom;
  const frames: ExcalidrawElement[] = [];
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.locked || (el.type === "text" && el.containerId)) continue;
    if (isFrame(el)) frames.push(el);
    else if (hits(el, p, tol)) return el;
  }
  return frames.find((f) => hits(f, p, tol)) ?? null;
}

function outlinePath(el: ExcalidrawElement, s: AppState): string {
  const toView = (x: number, y: number) => sceneCoordsToViewportCoords({ sceneX: x, sceneY: y }, s);
  if (isLinear(el) && "points" in el) {
    return el.points
      .map(([x, y], i) => {
        const v = toView(el.x + x, el.y + y);
        return `${i ? "L" : "M"}${v.x},${v.y}`;
      })
      .join("");
  }
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const rot = (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    const c = Math.cos(el.angle);
    const sn = Math.sin(el.angle);
    return toView(cx + dx * c - dy * sn, cy + dx * sn + dy * c);
  };
  const { x, y, width: w, height: h } = el;
  const corners =
    el.type === "diamond"
      ? [rot(x + w / 2, y), rot(x + w, y + h / 2), rot(x + w / 2, y + h), rot(x, y + h / 2)]
      : [rot(x, y), rot(x + w, y), rot(x + w, y + h), rot(x, y + h)];
  return corners.map((v, i) => `${i ? "L" : "M"}${v.x},${v.y}`).join("") + "Z";
}

export function CanvasOverlay({ api, stickyColor }: { api: ExcalidrawImperativeAPI; stickyColor: string }) {
  const path = useRef<SVGPathElement>(null);
  const ellipse = useRef<SVGEllipseElement>(null);
  const ghost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let pointer: Point | null = null;
    let pressed = false;
    let onCanvas = false;
    let dragStart: Point | null = null; // triangle being drawn
    let frame = 0;

    const triangleTool = () => {
      const t = api.getAppState().activeTool;
      return t.type === "custom" && (t.customType === "triangle" || t.customType === "triangle-down") ? t.customType : null;
    };

    const draw = () => {
      frame = 0;
      const p = path.current;
      const e = ellipse.current;
      const g = ghost.current;
      if (!p || !e || !g) return;
      const s = api.getAppState();
      p.style.display = "none";
      e.style.display = "none";
      g.style.display = "none";

      const triangle = triangleTool();
      if (triangle && dragStart && pointer && pressed) {
        // Live outline while dragging out a triangle.
        const x1 = Math.min(dragStart.x, pointer.x);
        const x2 = Math.max(dragStart.x, pointer.x);
        const y1 = Math.min(dragStart.y, pointer.y);
        const y2 = Math.max(dragStart.y, pointer.y);
        const mid = (x1 + x2) / 2;
        p.setAttribute(
          "d",
          triangle === "triangle" ? `M${mid},${y1}L${x2},${y2}L${x1},${y2}Z` : `M${x1},${y1}L${x2},${y1}L${mid},${y2}Z`,
        );
        p.style.display = "";
        return;
      }
      if (!pointer || !onCanvas) return;
      if (triangle) {
        const canvas = document.querySelector<HTMLCanvasElement>(".fx-board canvas.interactive");
        if (canvas && canvas.style.cursor !== "crosshair") canvas.style.cursor = "crosshair";
        return;
      }

      if (s.activeTool.type === "custom" && s.activeTool.customType === "sticky") {
        const size = STICKY_SIZE * s.zoom.value;
        g.style.display = "block";
        g.style.width = g.style.height = `${size}px`;
        g.style.transform = `translate(${pointer.x - size / 2}px, ${pointer.y - size / 2}px)`;
        return;
      }
      if (pressed || s.activeTool.type !== "selection" || s.editingTextElement || s.selectionElement) return;

      const scene = viewportCoordsToSceneCoords({ clientX: pointer.x, clientY: pointer.y }, s);
      const el = elementAt(api.getSceneElements(), scene, s.zoom.value);
      if (!el || s.selectedElementIds[el.id]) return;
      if (el.type === "ellipse") {
        const c = sceneCoordsToViewportCoords({ sceneX: el.x + el.width / 2, sceneY: el.y + el.height / 2 }, s);
        e.setAttribute("cx", String(c.x));
        e.setAttribute("cy", String(c.y));
        e.setAttribute("rx", String((Math.abs(el.width) / 2) * s.zoom.value));
        e.setAttribute("ry", String((Math.abs(el.height) / 2) * s.zoom.value));
        e.setAttribute("transform", `rotate(${(el.angle * 180) / Math.PI} ${c.x} ${c.y})`);
        e.style.display = "";
      } else {
        p.setAttribute("d", outlinePath(el, s));
        p.style.display = "";
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const onPointer = (ev: PointerEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      pressed = ev.buttons !== 0;
      onCanvas = (ev.target as Element | null)?.classList?.contains("interactive") ?? false;
      if (ev.type === "pointerdown") dragStart = onCanvas && triangleTool() ? pointer : null;
      if (ev.type === "pointerup") dragStart = null;
      schedule();
    };
    const onLeave = () => {
      onCanvas = false;
      schedule();
    };

    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    window.addEventListener("pointerup", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    const offs = [api.onScrollChange(schedule), api.onChange(schedule)];
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("pointerup", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      offs.forEach((off) => off());
    };
  }, [api]);

  return (
    <>
      <svg className="fx-hover" aria-hidden>
        <path ref={path} style={{ display: "none" }} />
        <ellipse ref={ellipse} style={{ display: "none" }} />
      </svg>
      <div ref={ghost} className="fx-sticky-ghost" style={{ display: "none", ["--c" as string]: stickyColor }} aria-hidden />
    </>
  );
}
