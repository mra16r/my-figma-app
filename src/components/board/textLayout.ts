import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type TextLike = ExcalidrawElement & {
  fontSize: number;
  fontFamily: number;
  textAlign: string;
  verticalAlign: string;
  lineHeight: number;
  text: string;
  originalText: string;
};
type Patch = Record<string, unknown>;

/** Inter, FigJam's font: added to Excalidraw as font family 11 (scripts/patch-excalidraw.mjs). */
export const INTER_FONT = 11;

/** Space between a shape's edge and its text (same as the patched Excalidraw padding). */
export const LABEL_PAD = 14;

// Where text sits inside a shape (same rules as Excalidraw's own layout).
function labelArea(c: ExcalidrawElement) {
  const k = c.type === "ellipse" ? Math.SQRT2 / 2 : c.type === "diamond" ? 0.5 : 1;
  const ox = LABEL_PAD + (c.type === "ellipse" ? (c.width / 2) * (1 - Math.SQRT2 / 2) : c.type === "diamond" ? c.width / 4 : 0);
  const oy = LABEL_PAD + (c.type === "ellipse" ? (c.height / 2) * (1 - Math.SQRT2 / 2) : c.type === "diamond" ? c.height / 4 : 0);
  const maxW = (k === 1 ? c.width : Math.round(c.width * k)) - LABEL_PAD * 2;
  const maxH = (k === 1 ? c.height : Math.round(c.height * k)) - LABEL_PAD * 2;
  return { x: c.x + ox, y: c.y + oy, maxW, maxH, k };
}

/** Grows the shape if its text no longer fits, then places the text again. */
export function placeLabel(text: TextLike, container: ExcalidrawElement): { text: Patch; container?: Patch } {
  let c = container;
  let area = labelArea(c);
  let containerPatch: Patch | undefined;
  if (text.height > area.maxH) {
    const height = (text.height + LABEL_PAD * 2) / area.k;
    containerPatch = { height };
    c = { ...c, height } as ExcalidrawElement;
    area = labelArea(c);
  }
  const y =
    text.verticalAlign === "top"
      ? area.y
      : text.verticalAlign === "bottom"
        ? area.y + area.maxH - text.height
        : area.y + area.maxH / 2 - text.height / 2;
  const x =
    text.textAlign === "left"
      ? area.x
      : text.textAlign === "right"
        ? area.x + area.maxW - text.width
        : area.x + area.maxW / 2 - text.width / 2;
  return { text: { x, y }, container: containerPatch };
}

const bad = (n: unknown) => typeof n !== "number" || !Number.isFinite(n);

/**
 * Text that an earlier version broke (bold made its height "not a number",
 * which hides it). Returns the fix, or null when the text is fine.
 */
export function repairText(text: TextLike, container: ExcalidrawElement | undefined): Patch | null {
  // (After a reload, Excalidraw turns those sizes into 0.)
  const flat = (text.height as number) <= 0 && !!text.text;
  if (!flat && !bad(text.x) && !bad(text.y) && !bad(text.width) && !bad(text.height)) return null;
  const lines = (text.text || " ").split("\n").length;
  const height = lines * text.fontSize * (text.lineHeight || 1.25);
  const width = bad(text.width) ? text.fontSize * 0.6 * Math.max(...(text.text || " ").split("\n").map((l) => l.length)) : text.width;
  const fixed = { ...text, width, height } as TextLike;
  if (container) return { width, height, ...placeLabel(fixed, container).text };
  return { width, height, x: bad(text.x) ? 0 : text.x, y: bad(text.y) ? 0 : text.y };
}
