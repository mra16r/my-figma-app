import { useEffect, useRef } from "react";
import { convertToExcalidrawElements, ROUNDNESS, sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { SECTION_STROKE } from "./autoStyle";
import { darkColor, isDarkBoard } from "./darkInk";

const SVG_NS = "http://www.w3.org/2000/svg";

/** A see-through sticky color would let its own shadow show through; use it opaque. */
const baseFill = (c: string) => (/^#[0-9a-f]{8}$/i.test(c) ? c.slice(0, 7) : c);

/**
 * For exports and previews: section fills are drawn by this app, not by
 * Excalidraw, so add a filled rectangle behind each section.
 */
export function withSectionBackgrounds<T extends ExcalidrawElement>(elements: readonly T[]): NonDeleted<ExcalidrawElement>[] {
  const sections = elements.filter((el) => (el.type === "frame" || el.type === "magicframe") && !el.isDeleted);
  if (!sections.length) return elements as unknown as NonDeleted<ExcalidrawElement>[];
  const backgrounds = convertToExcalidrawElements(
    sections.map((s) => ({
      type: "rectangle" as const,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      backgroundColor: s.backgroundColor,
      strokeColor: s.customData?.section ? s.strokeColor : SECTION_STROKE,
      fillStyle: "solid" as const,
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    })),
  );
  return [...backgrounds, ...elements] as unknown as NonDeleted<ExcalidrawElement>[];
}

/**
 * Draws section backgrounds (fill + outline) underneath the canvas, so
 * everything inside a section sits on top of it, like in FigJam.
 */
export function SectionLayer({ api }: { api: ExcalidrawImperativeAPI }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = 0;
      const svg = svgRef.current;
      if (!svg) return;
      const s = api.getAppState();
      const z = s.zoom.value;
      const rects: SVGRectElement[] = [];
      const shadows: SVGRectElement[] = [];
      for (const el of api.getSceneElements()) {
        // Sticky notes get a soft shadow along their bottom edge, like FigJam.
        if (el.customData?.kind === "sticky" && el.type === "rectangle" && el.backgroundColor !== "transparent") {
          const p = sceneCoordsToViewportCoords({ sceneX: el.x, sceneY: el.y }, s);
          const x = p.x - s.offsetLeft;
          const y = p.y - s.offsetTop;
          const w = el.width * z;
          const h = el.height * z;
          const shadow = document.createElementNS(SVG_NS, "rect");
          shadow.setAttribute("x", String(x));
          shadow.setAttribute("y", String(y));
          shadow.setAttribute("width", String(Math.max(0, w)));
          shadow.setAttribute("height", String(Math.max(0, h)));
          shadow.setAttribute("fill", baseFill(el.backgroundColor));
          if (el.angle) shadow.setAttribute("transform", `rotate(${(el.angle * 180) / Math.PI} ${x + w / 2} ${y + h / 2})`);
          // Shadow colors come from board.css (stronger in dark mode).
          shadow.style.filter = `drop-shadow(0 ${3 * z}px ${3 * z}px var(--fx-sticky-shadow)) drop-shadow(0 0 ${0.5 * z}px var(--fx-sticky-edge))`;
          shadows.push(shadow);
          continue;
        }
        if (el.type !== "frame" && el.type !== "magicframe") continue;
        const p = sceneCoordsToViewportCoords({ sceneX: el.x, sceneY: el.y }, s);
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", String(p.x - s.offsetLeft));
        rect.setAttribute("y", String(p.y - s.offsetTop));
        rect.setAttribute("width", String(Math.max(0, el.width * z)));
        rect.setAttribute("height", String(Math.max(0, el.height * z)));
        rect.setAttribute("rx", String(Math.min(6 * z, 10)));
        // Same colors as the canvas uses (darker versions in dark mode).
        const ink = isDarkBoard() ? darkColor : (c: string) => c;
        rect.setAttribute("fill", el.backgroundColor === "transparent" ? "none" : ink(el.backgroundColor));
        rect.setAttribute(
          "stroke",
          el.strokeColor === "transparent" ? "none" : ink(el.customData?.section ? el.strokeColor : SECTION_STROKE),
        );
        rect.setAttribute("stroke-width", String(Math.min(2, Math.max(1, 2 * z))));
        rects.push(rect);
      }
      svg.replaceChildren(...rects, ...shadows);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    schedule();
    const offs = [api.onChange(schedule), api.onScrollChange(schedule)];
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      offs.forEach((off) => off());
      window.removeEventListener("resize", schedule);
    };
  }, [api]);

  return <svg ref={svgRef} className="fx-section-layer" aria-hidden />;
}
