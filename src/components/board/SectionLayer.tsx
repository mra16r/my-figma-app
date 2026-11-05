import { useEffect, useRef } from "react";
import { convertToExcalidrawElements, ROUNDNESS, sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { SECTION_STROKE } from "./autoStyle";

const SVG_NS = "http://www.w3.org/2000/svg";

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
      for (const el of api.getSceneElements()) {
        if (el.type !== "frame" && el.type !== "magicframe") continue;
        const p = sceneCoordsToViewportCoords({ sceneX: el.x, sceneY: el.y }, s);
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", String(p.x - s.offsetLeft));
        rect.setAttribute("y", String(p.y - s.offsetTop));
        rect.setAttribute("width", String(Math.max(0, el.width * z)));
        rect.setAttribute("height", String(Math.max(0, el.height * z)));
        rect.setAttribute("rx", String(Math.min(6 * z, 10)));
        rect.setAttribute("fill", el.backgroundColor === "transparent" ? "none" : el.backgroundColor);
        rect.setAttribute(
          "stroke",
          el.strokeColor === "transparent" ? "none" : el.customData?.section ? el.strokeColor : SECTION_STROKE,
        );
        rect.setAttribute("stroke-width", "1");
        rects.push(rect);
      }
      svg.replaceChildren(...rects);
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
