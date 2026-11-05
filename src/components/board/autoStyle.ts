import { useEffect } from "react";
import { CaptureUpdateAction, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { placeLabel, repairText, type TextLike } from "./textLayout";

export const TEXT_DARK = "#1e1e1e";
export const TEXT_LIGHT = "#ffffff";
export const SECTION_FILL = "#ffffff";
export const SECTION_STROKE = "#e6e6e6";
/** Space between a sticky note's edge and its text (same as Excalidraw's patched label padding). */
const STICKY_PAD = 14;

/** "#abc", "#aabbcc" or "#aabbccdd" → [r, g, b, a] (0–1 alpha). */
function parseHex(color: string): [number, number, number, number] | null {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1];
}

/** Black or white, whichever reads better on this fill. */
export function readableTextColor(fill: string): string {
  const rgba = parseHex(fill);
  if (!rgba) return TEXT_DARK; // transparent or unknown: the canvas is light
  const [r, g, b, a] = rgba;
  // See-through fills blend with the light canvas.
  const mix = (c: number) => (c * a + 245 * (1 - a)) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(mix(r)) + 0.7152 * lin(mix(g)) + 0.0722 * lin(mix(b));
  return luminance < 0.4 ? TEXT_LIGHT : TEXT_DARK;
}

const isSection = (el: ExcalidrawElement) => el.type === "frame" || el.type === "magicframe";

/**
 * Keeps things tidy as you work:
 *  - text inside a shape is black or white depending on the shape's color
 *  - new sections get a white fill, a soft outline and a "Section N" name
 */
export function useAutoStyles(api: ExcalidrawImperativeAPI | null): void {
  useEffect(() => {
    if (!api) return;
    let frame = 0;

    const fix = () => {
      frame = 0;
      const elements = api.getSceneElementsIncludingDeleted();
      const byId = new Map(elements.map((el) => [el.id, el]));
      const patches = new Map<string, Record<string, unknown>>();

      let sectionNumber = 0;
      for (const el of elements) {
        const m = !el.isDeleted && isSection(el) && el.name?.match(/^Section (\d+)$/);
        if (m) sectionNumber = Math.max(sectionNumber, Number(m[1]));
      }

      // Not the shape being drawn right now: replacing it would stop Excalidraw
      // from sizing it (a new section stayed tiny).
      const drawing = api.getAppState().newElement?.id;

      for (const el of elements) {
        if (el.isDeleted || el.id === drawing) continue;
        if (el.type === "text") {
          // Text hidden by an earlier bug (a size that isn't a number): measure and place it again.
          const owner = el.containerId ? byId.get(el.containerId) : undefined;
          const container = owner && !owner.isDeleted ? owner : undefined;
          const repair = repairText(el as unknown as TextLike, container);
          if (repair) {
            // Measure it for real (works again), then place it inside its shape.
            const [measured] = restoreElements([{ ...el, ...repair } as ExcalidrawElement], null, {
              refreshDimensions: true,
              repairBindings: true,
            });
            const m = measured as unknown as TextLike;
            const ok = Number.isFinite(m.width) && Number.isFinite(m.height) && m.height > 0;
            const sized = ok ? { ...repair, width: m.width, height: m.height, text: m.text } : repair;
            patches.set(el.id, container ? { ...sized, ...placeLabel({ ...m, ...sized } as TextLike, container).text } : sized);
            continue;
          }
          // Mixed sizes or styled parts whose line lists no longer match the drawn
          // lines (a change Excalidraw made on its own): lay the text out again.
          const { lineSizes, lineRuns, paraSizes } = el.customData ?? {};
          const drawn = (el as unknown as TextLike).text.split("\n").length;
          const fits = (list: unknown) => Array.isArray(list) && list.length === drawn;
          if ((Array.isArray(paraSizes) || Array.isArray(lineRuns)) && !(fits(lineSizes) && (!lineRuns || fits(lineRuns)))) {
            const t = el as unknown as TextLike;
            const [measured] = restoreElements(
              [{ ...el, text: t.originalText } as ExcalidrawElement, ...(container ? [container] : [])],
              null,
              { refreshDimensions: true, repairBindings: true },
            );
            const m = measured as unknown as TextLike;
            if (Number.isFinite(m.height) && m.height > 0) {
              const sized = { text: m.text, width: m.width, height: m.height, fontSize: m.fontSize, customData: m.customData };
              patches.set(el.id, container ? { ...sized, ...placeLabel({ ...m } as TextLike, container).text } : sized);
              continue;
            }
          }
        }
        if (el.type === "text" && el.containerId) {
          const container = byId.get(el.containerId);
          if (!container || container.isDeleted || container.type === "arrow") continue;
          const want = readableTextColor(container.backgroundColor);
          const patch: Record<string, unknown> = {};
          if (el.strokeColor !== want) patch.strokeColor = want;
          // New sticky notes keep their text at the top left, like FigJam.
          if (container.customData?.topLeft && "textAlign" in el) {
            const x = container.x + STICKY_PAD;
            const y = container.y + STICKY_PAD;
            if (el.textAlign !== "left" || el.verticalAlign !== "top" || Math.abs(el.x - x) > 0.5 || Math.abs(el.y - y) > 0.5)
              Object.assign(patch, { textAlign: "left", verticalAlign: "top", x, y });
          }
          if (Object.keys(patch).length) patches.set(el.id, patch);
        } else if (isSection(el) && !el.customData?.section) {
          patches.set(el.id, {
            name: el.name && el.name !== "Frame" ? el.name : `Section ${++sectionNumber}`,
            backgroundColor: SECTION_FILL,
            strokeColor: SECTION_STROKE,
            customData: { ...el.customData, section: true },
          });
        }
      }

      if (!patches.size) return;
      api.updateScene({
        elements: elements.map((el) => {
          const patch = patches.get(el.id);
          return patch ? newElementWith(el, patch as never) : el;
        }),
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      });
    };

    // A short timer (not an animation frame) so it also runs in a background tab.
    const schedule = () => {
      if (!frame) frame = window.setTimeout(fix, 30);
    };
    schedule();
    const off = api.onChange(schedule);
    return () => {
      off();
      window.clearTimeout(frame);
    };
  }, [api]);
}
