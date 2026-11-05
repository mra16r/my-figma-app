// Board colors in dark mode. Excalidraw's own dark mode inverts the whole canvas,
// which turns sticky notes muddy brown. Instead, the patched Excalidraw
// (scripts/patch-excalidraw.mjs) asks __mfaInk for the colors to draw with:
//   - sticky notes, and the text on them, keep their real colors (paper on a dark board),
//     and so does text in a shape whose color barely changes (see keepsColor);
//   - everything else gets its lightness flipped with hue and saturation kept:
//     white shapes turn dark gray, black text and lines turn near-white, and
//     colored shapes get a darker or lighter version of the same color.
// Saved boards never change; exports and previews are always drawn light.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { readableTextColor } from "./autoStyle";

type Lookup = (id: string) => ExcalidrawElement | undefined;

let lookup: Lookup | null = null;

/** Lets text find its shape (to know whether it sits on a sticky note). */
export function setInkLookup(fn: Lookup | null): void {
  lookup = fn;
}

export const isDarkBoard = () => document.documentElement.dataset.theme === "dark";

let probe: CanvasRenderingContext2D | null = null;
const cache = new Map<string, string>();

/** Any CSS color as [r, g, b, a] (0-255, alpha 0-1). */
function parse(color: string): [number, number, number, number] | null {
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  probe.fillStyle = "#000";
  probe.fillStyle = color;
  const v = String(probe.fillStyle);
  if (v.startsWith("#")) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = "1"] = m[1].split(",").map((s) => s.trim());
  return [Number(r), Number(g), Number(b), Number(a)];
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255)) as [number, number, number];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)].map((v) => Math.round(v * 255)) as [number, number, number];
}

const hex = (n: number) => n.toString(16).padStart(2, "0");

/**
 * A color's dark-mode version: lightness flipped, hue and saturation kept.
 * White becomes #2c2c2c (a little lighter than the dark canvas, as white shapes
 * are a little lighter than the light one) and #1e1e1e text becomes #ebebeb.
 */
export function darkColor(color: string): string {
  if (!color || color === "transparent") return color;
  const hit = cache.get(color);
  if (hit) return hit;
  const rgba = parse(color);
  if (!rgba) return color;
  const [h, s, l] = toHsl(rgba[0], rgba[1], rgba[2]);
  const [r, g, b] = fromHsl(h, s, Math.min(1, Math.max(0, 1.02 - 0.847 * l)));
  const out = `#${hex(r)}${hex(g)}${hex(b)}${rgba[3] < 1 ? hex(Math.round(rgba[3] * 255)) : ""}`;
  cache.set(color, out);
  return out;
}

const isSticky = (el: ExcalidrawElement | undefined) => el?.customData?.kind === "sticky";

/**
 * Sticky notes and the text on them keep their colors. So does text in a shape
 * whose color stays on the same side of light/dark (a red shape stays red, so
 * its white text stays white); in a shape that flips, the text flips too.
 */
function keepsColor(el: ExcalidrawElement): boolean {
  if (isSticky(el)) return true;
  const containerId = (el as { containerId?: string | null }).containerId;
  const box = containerId ? lookup?.(containerId) : undefined;
  if (!box) return false;
  if (isSticky(box)) return true;
  if (box.backgroundColor === "transparent") return false;
  return readableTextColor(box.backgroundColor) === readableTextColor(darkColor(box.backgroundColor));
}

/** The element as it should be drawn on the board right now (a copy when its colors change). */
export function inkElement<T extends ExcalidrawElement>(el: T): T {
  if (!isDarkBoard() || el.type === "image" || keepsColor(el)) return el;
  const strokeColor = darkColor(el.strokeColor);
  const backgroundColor = darkColor(el.backgroundColor);
  if (strokeColor === el.strokeColor && backgroundColor === el.backgroundColor) return el;
  return { ...el, strokeColor, backgroundColor };
}

// Hooks the patched Excalidraw looks for.
const hooks = globalThis as unknown as {
  __mfaInk?: typeof inkElement;
  __mfaInkKey?: () => string;
};
hooks.__mfaInk = inkElement;
// Shapes Excalidraw keeps ready to draw are redone when this changes.
hooks.__mfaInkKey = () => (isDarkBoard() ? "dark" : "light");
