// Rich text, like FigJam: each paragraph (line typed with Enter) of a text can have
// its own size, and any part of it can be bold or struck through. Stored on the
// text element:
//   customData.paraSizes  one size per paragraph of originalText (only when sizes differ)
//   customData.marks      per paragraph, runs of [length, flags] over its characters
//                         (flags: 1 bold, 2 strikethrough; only when something is marked)
//   customData.lineSizes  one size per drawn line (after wrapping), used to draw
//   customData.lineRuns   per drawn line, its pieces as [text, flags], used to draw
// Older texts may have customData.bold / .strike for the whole text; they're read
// as marks on every character and become marks once the text is laid out again.
// Excalidraw is patched (scripts/patch-excalidraw.mjs) to call richLayout() when it
// lays out text, to draw lines piece by piece (canvas and SVG), and to use the rich
// editor below instead of its plain textarea, so sizes and styles show while typing.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { inkElement } from "./darkInk";

type TextEl = ExcalidrawElement & {
  type: "text";
  fontSize: number;
  lineHeight: number;
  text: string;
  originalText: string;
  autoResize: boolean;
  containerId: string | null;
  textAlign: string;
};

type LayoutFns = {
  font: (el: object) => string;
  wrap: (text: string, font: string, maxWidth: number) => string;
  measure: (text: string, font: string, lineHeight: number) => { width: number; height: number };
};

export const BOLD = 1;
export const STRIKE = 2;
export const BULLET = "• ";

type Runs = [number, number][]; // [length, flags]
type Piece = [string, number]; // [text, flags]

/** Sizes in the rich editor right now, by text element id (newer than the element's). */
const liveSizes = new Map<string, number[]>();
/** Styles of each character in the rich editor right now (one list per paragraph). */
const liveMarks = new Map<string, number[][]>();

type Data = Record<string, unknown> | undefined;

const sizesOf = (el: { customData?: Data }) => {
  const s = el.customData?.paraSizes;
  return Array.isArray(s) && s.length ? (s as number[]) : null;
};

/** The size of each paragraph (null when the text has one size). */
export function paragraphSizes(el: ExcalidrawElement): number[] | null {
  return liveSizes.get(el.id) ?? sizesOf(el);
}

/** True when a text has more than one size. */
export function hasMixedSizes(el: ExcalidrawElement): boolean {
  const s = paragraphSizes(el);
  return !!s && new Set(s).size > 1;
}

/** Customdata without the size lists (after picking one size for all of it). */
export function withoutSizes(customData: Data): Record<string, unknown> {
  const rest = { ...(customData ?? {}) };
  delete rest.paraSizes;
  delete rest.lineSizes;
  return rest;
}

const legacyFlags = (cd: Data) => (cd?.bold ? BOLD : 0) | (cd?.strike ? STRIKE : 0);

/** Fits per-character styles to the paragraphs (extra characters take the last style). */
function fitFlags(flags: number[][], paras: string[], base = 0): number[][] {
  return paras.map((p, i) => {
    const f = (flags[i] ?? []).slice(0, p.length);
    const last = f.length ? f[f.length - 1] : (flags[i - 1]?.[flags[i - 1].length - 1] ?? base);
    while (f.length < p.length) f.push(last);
    return f;
  });
}

function expandMarks(stored: unknown, paras: string[], base: number): number[][] {
  const list = Array.isArray(stored) ? stored : [];
  return fitFlags(
    paras.map((p, i) => {
      const out: number[] = [];
      for (const [len, f] of Array.isArray(list[i]) ? (list[i] as Runs) : [])
        for (let k = 0; k < len && out.length < p.length; k++) out.push((Number(f) | 0) | base);
      return out.length || !p.length ? out : [base];
    }),
    paras,
    base,
  );
}

function compress(flags: number[]): Runs {
  const runs: Runs = [];
  for (const f of flags) {
    const last = runs[runs.length - 1];
    if (last && last[1] === f) last[0]++;
    else runs.push([1, f]);
  }
  return runs;
}

const anyMarks = (flags: number[][]) => flags.some((p) => p.some((f) => f));

/** Style of each character (one list per paragraph of originalText), or null for plain text. */
export function charFlags(el: ExcalidrawElement): number[][] | null {
  const live = liveMarks.get(el.id);
  if (live) return live;
  const cd = el.customData;
  const base = legacyFlags(cd);
  if (!Array.isArray(cd?.marks) && !base) return null;
  return expandMarks(cd?.marks, ((el as TextEl).originalText ?? "").split("\n"), base);
}

/** Customdata with these character styles (plain again when nothing is styled). */
export function withMarks(customData: Data, flags: number[][] | null): Record<string, unknown> {
  const rest = { ...(customData ?? {}) };
  delete rest.bold;
  delete rest.strike;
  delete rest.marks;
  delete rest.lineRuns;
  if (!Array.isArray(rest.paraSizes)) delete rest.lineSizes; // (worked out again when needed)
  if (flags && anyMarks(flags)) rest.marks = flags.map(compress);
  return rest;
}

/** True when every character of the text has this style. */
export function allMarked(el: ExcalidrawElement, bit: number): boolean {
  const paras = ((el as TextEl).originalText ?? "").split("\n");
  // (bullets don't count: they're never struck through)
  const flags = charFlags(el)?.flatMap((f, i) => f.slice(paras[i]?.startsWith(BULLET) ? BULLET.length : 0)) ?? [];
  return flags.length > 0 && flags.every((f) => f & bit);
}

/** Every character of the text with this style on or off (a patch for the element). */
export function markAll(el: ExcalidrawElement, bit: number, on: boolean): Record<string, unknown> {
  const paras = ((el as TextEl).originalText ?? "").split("\n");
  const flags = (charFlags(el) ?? paras.map((p) => Array(p.length).fill(0))).map((p) => p.map((f) => (on ? f | bit : f & ~bit)));
  return { customData: withMarks(el.customData, flags) };
}

// ---- Bulleted lists ----------------------------------------------------------------

/** True when every line with text (or the only line) starts with a bullet. */
function bulleted(paras: string[]): boolean {
  const lines = paras.length === 1 ? paras : paras.filter((p) => p.trim());
  return lines.length > 0 && lines.every((p) => p.startsWith(BULLET));
}

/**
 * Adds or removes "• " at the start of paragraphs `from`..`to` (empty ones are
 * skipped unless it's just one), keeping each character's style.
 */
function setBullets(paras: string[], flags: number[][], from: number, to: number, add: boolean) {
  const nextParas = paras.slice();
  const nextFlags = flags.map((f) => f.slice());
  const shift = paras.map(() => 0);
  for (let i = from; i <= to; i++) {
    const p = paras[i];
    if (!p.trim() && from !== to) continue;
    if (add && !p.startsWith(BULLET)) {
      nextParas[i] = BULLET + p;
      nextFlags[i] = [...Array(BULLET.length).fill((flags[i][0] ?? 0) & ~STRIKE), ...flags[i]];
      shift[i] = BULLET.length;
    } else if (!add && p.startsWith(BULLET)) {
      nextParas[i] = p.slice(BULLET.length);
      nextFlags[i] = flags[i].slice(BULLET.length);
      shift[i] = -BULLET.length;
    }
  }
  return { paras: nextParas, flags: nextFlags, shift };
}

/** True when the text is a bulleted list. */
export function hasBullets(el: ExcalidrawElement): boolean {
  return bulleted(((el as TextEl).originalText ?? "").split("\n"));
}

/** Turns the whole text into a bulleted list or back (a patch for the element). */
export function toggleBullets(el: ExcalidrawElement, add: boolean): Record<string, unknown> {
  const paras = ((el as TextEl).originalText ?? "").split("\n");
  const flags = charFlags(el);
  const out = setBullets(paras, flags ?? paras.map((p) => Array(p.length).fill(0)), 0, paras.length - 1, add);
  const text = out.paras.join("\n");
  return { originalText: text, text, ...(flags ? { customData: withMarks(el.customData, out.flags) } : {}) };
}

// ---- Layout ---------------------------------------------------------------------------

type Line = { text: string; runs: Piece[]; width: number };

/** Wraps one paragraph whose characters have different styles (so different widths). */
function wrapPieces(p: string, f: number[], maxWidth: number, widthOf: (s: string, flags: number) => number): Line[] {
  const width = (a: number, b: number) => {
    let w = 0;
    for (let k = a; k < b; ) {
      let e = k;
      while (e < b && f[e] === f[k]) e++;
      w += widthOf(p.slice(k, e), f[k]);
      k = e;
    }
    return w;
  };
  const make = (a: number, b: number, wrapped: boolean): Line => {
    let end = b;
    // Spaces where the line wraps aren't drawn (and don't count for centering).
    if (wrapped) while (end > a && /\s/.test(p[end - 1])) end--;
    const runs: Piece[] = [];
    for (let k = a; k < end; ) {
      let e = k;
      while (e < end && f[e] === f[k]) e++;
      runs.push([p.slice(k, e), f[k]]);
      k = e;
    }
    return { text: p.slice(a, end), runs, width: width(a, end) };
  };
  if (!Number.isFinite(maxWidth)) return [make(0, p.length, false)];
  const lines: Line[] = [];
  let start = 0;
  let wordsEnd = 0;
  let pos = 0;
  for (const token of p.match(/\s+|\S+/g) ?? []) {
    const a = pos;
    const b = (pos += token.length);
    if (/^\s/.test(token)) continue; // spaces stay on their line
    if (wordsEnd > start && width(start, b) > maxWidth) {
      lines.push(make(start, a, true));
      start = a;
    }
    if (width(start, b) > maxWidth) {
      // A word wider than the line: break it between letters.
      for (let e = a; e < b; e++) {
        if (e > start && width(start, e + 1) > maxWidth) {
          lines.push(make(start, e, false));
          start = e;
        }
      }
    }
    wordsEnd = b;
  }
  lines.push(make(start, p.length, false));
  return lines;
}

/**
 * Lays out a text with mixed sizes or styled parts: wraps and measures each
 * paragraph at its size, piece by piece. Returns null for ordinary text
 * (Excalidraw lays it out).
 */
function richLayout(element: ExcalidrawElement, text: string, maxWidth: number, fns: LayoutFns) {
  const el = element as TextEl;
  const cd = el.customData ?? {};
  const liveS = liveSizes.get(el.id);
  const liveM = liveMarks.get(el.id);
  const storedSizes = sizesOf(el);
  const live = !!(liveS || liveM);
  if (!live && !storedSizes && !Array.isArray(cd.marks) && !Array.isArray(cd.lineRuns)) return null;
  // Some callers pass the already-wrapped text; sizes and styles go with the typed text.
  const source = !live && text === el.text && el.text !== el.originalText ? el.originalText : text;
  const paras = source.split("\n");
  const sizes = liveS ?? storedSizes;
  const list = paras.map((_, i) => (sizes ? Number(sizes[Math.min(i, sizes.length - 1)]) : 0) || el.fontSize);
  const flags = liveM ? fitFlags(liveM, paras) : expandMarks(cd.marks, paras, legacyFlags(cd));
  paras.forEach((p, i) => {
    if (p.startsWith(BULLET)) for (let k = 0; k < BULLET.length; k++) flags[i][k] &= ~STRIKE; // bullets aren't struck through
  });
  const marked = anyMarks(flags);

  const fontFor = (size: number, f: number) => fns.font({ ...el, fontSize: size, customData: { ...cd, bold: !!(f & BOLD) } });
  const canWrap = Number.isFinite(maxWidth) && maxWidth > 0;
  const lines: string[] = [];
  const lineSizes: number[] = [];
  const lineRuns: Piece[][] = [];
  let width = 0;
  let height = 0;
  paras.forEach((p, i) => {
    const size = list[i];
    const f = flags[i];
    if (f.every((x) => x === f[0])) {
      // One style for the whole paragraph: Excalidraw's own wrapping.
      const style = f[0] ?? 0;
      const font = fontFor(size, style);
      const wrapped = canWrap ? fns.wrap(p, font, maxWidth) : p;
      const m = fns.measure(wrapped, font, el.lineHeight);
      width = Math.max(width, m.width);
      height += m.height;
      for (const line of wrapped.split("\n")) {
        lines.push(line);
        lineSizes.push(size);
        lineRuns.push(line ? [[line, style]] : []);
      }
      return;
    }
    const widths = new Map<string, number>();
    const widthOf = (s: string, style: number) => {
      const key = `${style}|${s}`;
      let w = widths.get(key);
      if (w === undefined) widths.set(key, (w = fns.measure(s, fontFor(size, style), el.lineHeight).width));
      return w;
    };
    for (const line of wrapPieces(p, f, canWrap ? maxWidth : Infinity, widthOf)) {
      lines.push(line.text);
      lineSizes.push(size);
      lineRuns.push(line.runs);
      width = Math.max(width, line.width);
      height += size * el.lineHeight;
    }
  });
  if (!el.autoResize && !el.containerId) width = el.width;

  // Free text grows from its left edge (or around its middle / from its right edge).
  let x = el.x;
  if (!el.containerId && el.autoResize) {
    if (el.textAlign === "center") x = el.x - (width - el.width) / 2;
    else if (el.textAlign === "right") x = el.x - (width - el.width);
  }
  const uniform = list.every((s) => s === list[0]);
  const rest = withMarks(withoutSizes(cd), null);
  return {
    text: lines.join("\n"),
    width,
    height,
    x,
    y: el.y,
    // One size and no styles left: an ordinary text again.
    ...(uniform ? { fontSize: list[0] } : {}),
    customData: {
      ...rest,
      ...(uniform ? {} : { paraSizes: list }),
      ...(!uniform || marked ? { lineSizes } : {}),
      ...(marked ? { marks: flags.map(compress), lineRuns } : {}),
    },
  };
}

const piecesOf = (element: ExcalidrawElement, index: number, count: number): Piece[] | null => {
  const all = element.customData?.lineRuns;
  return Array.isArray(all) && all.length === count && Array.isArray(all[index]) ? (all[index] as Piece[]) : null;
};

/** Draws one line piece by piece (canvas). Returns false for plain lines. */
function drawRuns(
  ctx: CanvasRenderingContext2D,
  element: ExcalidrawElement & { textAlign?: string },
  index: number,
  count: number,
  x: number,
  y: number,
  size: number,
  font: (el: object) => string,
): boolean {
  const pieces = piecesOf(element, index, count);
  if (!pieces) return false;
  ctx.save();
  ctx.textAlign = "left";
  const fonts = pieces.map(([, f]) => font({ ...element, fontSize: size, customData: { ...element.customData, bold: !!(f & BOLD) } }));
  const widths = pieces.map(([t], k) => {
    ctx.font = fonts[k];
    return ctx.measureText(t).width;
  });
  const total = widths.reduce((a, b) => a + b, 0);
  let at = element.textAlign === "center" ? x - total / 2 : element.textAlign === "right" ? x - total : x;
  pieces.forEach(([t, f], k) => {
    ctx.font = fonts[k];
    ctx.fillText(t, at, y);
    if (f & STRIKE) ctx.fillRect(at, y - size * 0.3, widths[k], Math.max(1, size / 14));
    at += widths[k];
  });
  ctx.restore();
  return true;
}

/** Writes one line piece by piece (SVG export). Returns false for plain lines. */
function svgRuns(node: SVGTextElement, element: ExcalidrawElement, index: number, count: number): boolean {
  const pieces = piecesOf(element, index, count);
  if (!pieces) return false;
  node.textContent = "";
  for (const [t, f] of pieces) {
    const span = node.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "tspan");
    span.textContent = t;
    if (f & BOLD) span.setAttribute("font-weight", "bold");
    if (f & STRIKE) span.setAttribute("text-decoration", "line-through");
    node.appendChild(span);
  }
  return true;
}

// ---- Rich editor ---------------------------------------------------------------

type Snapshot = { paras: string[]; sizes: number[]; marks: number[][]; start: number; end: number };

const count = (s: string, ch: string) => s.split(ch).length - 1;
const normalize = (s: string) => s.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");

/** Keeps sizes with their paragraphs when the whole text is replaced. */
function alignSizes(oldParas: string[], oldSizes: number[], newParas: string[], base: number): number[] {
  const [head, tail] = sameEnds(oldParas, newParas);
  const middle = newParas.length - head - tail;
  const fill = oldSizes[head] ?? oldSizes[head - 1] ?? base;
  return [...oldSizes.slice(0, head), ...Array(Math.max(0, middle)).fill(fill), ...oldSizes.slice(oldSizes.length - tail)];
}

/** Paragraphs (or characters) unchanged at the start and at the end. */
function sameEnds<T>(a: ArrayLike<T>, b: ArrayLike<T>): [number, number] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return [head, tail];
}

/** Keeps each character's style when the whole text is replaced. */
function alignMarks(oldParas: string[], oldMarks: number[][], newParas: string[]): number[][] {
  const [head, tail] = sameEnds(oldParas, newParas);
  const middle = newParas.slice(head, newParas.length - tail).map((p, j) => {
    const old = oldParas[head + j];
    const f = oldMarks[head + j];
    if (old === undefined || !f) return Array(p.length).fill(oldMarks[head - 1]?.at(-1) ?? 0);
    const [pre, suf] = sameEnds(old, p);
    const fill = f[pre - 1] ?? f[pre] ?? 0;
    return [...f.slice(0, pre), ...Array(Math.max(0, p.length - pre - suf)).fill(fill), ...f.slice(f.length - suf)];
  });
  return [...oldMarks.slice(0, head), ...middle, ...oldMarks.slice(oldMarks.length - tail)].map((f) => f.slice());
}

let current: RichTextEditor | null = null;

/** The rich editor being typed in, if any. */
export const activeRichEditor = () => (current?.isConnected ? current : null);

/** Fired on the document when the style for the next typed letters changes (the toolbar shows it). */
export const FORMAT_EVENT = "mfa-format";

/**
 * A text box that behaves like the <textarea> Excalidraw edits text in (value,
 * selectionStart/End, select(), input events…) but shows each paragraph at its
 * size and bold or struck-through parts as they are.
 */
class RichTextEditor extends HTMLElement {
  private paras: string[] = [""];
  private sizes: number[] = [16];
  private marks: number[][] = [[]];
  private base = 16;
  private textId = "";
  private start = 0;
  private end = 0;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private listening = false;
  private inkSource: TextEl | null = null;
  private styled = false;
  /** Style picked with nothing selected: used for the next letters typed at that spot. */
  private pending: number | null = null;
  private pendingAt = -1;

  setup(element: TextEl) {
    this.textId = element.id;
    this.inkSource = element;
    this.base = element.fontSize;
    const stored = sizesOf(element);
    this.paras = (element.originalText ?? "").split("\n");
    this.sizes = this.paras.map((_, i) => (stored ? (stored[Math.min(i, stored.length - 1)] ?? this.base) : this.base));
    if (stored) liveSizes.set(this.textId, this.sizes.slice());
    const flags = charFlags(element);
    this.styled = !!flags;
    this.marks = flags ? fitFlags(flags, this.paras) : this.paras.map((p) => Array(p.length).fill(0));
    this.syncLive();
  }

  connectedCallback() {
    current = this;
    this.setAttribute("contenteditable", "true");
    this.setAttribute("role", "textbox");
    this.setAttribute("aria-multiline", "true");
    if (!this.listening) {
      this.listening = true;
      this.addEventListener("beforeinput", this.onBeforeInput);
      this.addEventListener("compositionend", this.onCompositionEnd);
      this.addEventListener("focus", () => this.applySelection());
      this.addEventListener("copy", this.onCopy);
      this.addEventListener("cut", this.onCopy);
      this.addEventListener("keydown", this.onKeyDown);
      // Excalidraw sets the text color on this box; in dark mode show the color
      // it will have on the board instead (board.css uses --mfa-ink).
      new MutationObserver(() => this.updateInk()).observe(this, { attributes: true, attributeFilter: ["style"] });
    }
    this.updateInk();
    this.render();
  }

  private updateInk() {
    if (!this.inkSource || !this.style.color) return;
    const ink = inkElement({ ...this.inkSource, strokeColor: this.style.color }).strokeColor;
    if (this.style.getPropertyValue("--mfa-ink") !== ink) this.style.setProperty("--mfa-ink", ink);
  }

  disconnectedCallback() {
    if (current === this) current = null;
    liveSizes.delete(this.textId);
    liveMarks.delete(this.textId);
  }

  // ---- textarea-like API (used by Excalidraw) ----
  get value() {
    return this.paras.join("\n");
  }
  set value(v: string) {
    const next = normalize(String(v)).split("\n");
    this.sizes = alignSizes(this.paras, this.sizes, next, this.base);
    this.marks = alignMarks(this.paras, this.marks, next);
    this.paras = next;
    // Like a textarea: setting the text puts the caret at its end.
    this.start = this.end = this.value.length;
    this.syncLive();
    this.render();
  }
  get selectionStart() {
    this.readSelection();
    return this.start;
  }
  set selectionStart(v: number) {
    this.start = Math.max(0, Math.min(v, this.value.length));
    if (this.end < this.start) this.end = this.start;
    this.applySelection();
  }
  get selectionEnd() {
    this.readSelection();
    return this.end;
  }
  set selectionEnd(v: number) {
    this.end = Math.max(0, Math.min(v, this.value.length));
    if (this.start > this.end) this.start = this.end;
    this.applySelection();
  }
  setSelectionRange(a: number, b: number) {
    this.start = Math.max(0, Math.min(a, b, this.value.length));
    this.end = Math.max(0, Math.min(Math.max(a, b), this.value.length));
    this.applySelection();
  }
  select() {
    this.start = 0;
    this.end = this.value.length;
    this.applySelection();
  }

  // ---- sizes and styles (used by the selection toolbar) ----
  private selectedParagraphs(): [number, number] {
    this.readSelection();
    const v = this.value;
    const a = count(v.slice(0, this.start), "\n");
    let b = count(v.slice(0, this.end), "\n");
    // A selection ending right after a line break doesn't include the next paragraph.
    if (this.end > this.start && v[this.end - 1] === "\n" && b > a) b--;
    return [a, b];
  }

  /** Sizes of the selected paragraphs (or of the one with the caret). */
  selectedSizes(): number[] {
    const [a, b] = this.selectedParagraphs();
    return [...new Set(this.sizes.slice(a, b + 1))];
  }

  /** Gives the selected paragraphs (or the caret's) a size. */
  setSelectedSize(size: number) {
    const [a, b] = this.selectedParagraphs();
    this.snapshot();
    for (let i = a; i <= b; i++) this.sizes[i] = size;
    this.changed();
  }

  /** What the toolbar shows: styles of the selected letters (or of the next typed ones), and bullets. */
  formatState(): { bold: boolean; strike: boolean; bullets: boolean } {
    const [pa, pb] = this.selectedParagraphs();
    const flags = this.selectedFlags();
    const all = (bit: number) => flags.length > 0 && flags.every((f) => f & bit);
    return { bold: all(BOLD), strike: all(STRIKE), bullets: bulleted(this.paras.slice(pa, pb + 1)) };
  }

  /** A short text that changes when formatState() does. */
  formatKey(): string {
    const s = this.formatState();
    return `${+s.bold}${+s.strike}${+s.bullets}`;
  }

  /** Bold or strikethrough on the selected letters, or for the next ones typed. */
  toggleMark(bit: number) {
    this.readSelection();
    const on = this.selectedFlags().every((f) => f & bit);
    const a = this.start;
    const b = this.end;
    if (a === b) {
      const now = this.pending !== null && this.pendingAt === a ? this.pending : this.flagsNear(this.flat(), a, a);
      this.pending = on ? now & ~bit : now | bit;
      this.pendingAt = a;
      document.dispatchEvent(new Event(FORMAT_EVENT));
      return;
    }
    this.snapshot();
    const flat = this.flat();
    for (let k = a; k < b; k++) if (flat[k] >= 0) flat[k] = on ? flat[k] & ~bit : flat[k] | bit;
    this.marks = this.unflat(flat);
    this.changed();
  }

  /** Turns the selected paragraphs (or the caret's) into a bulleted list or back. */
  toggleBullets() {
    const [pa, pb] = this.selectedParagraphs();
    const add = !bulleted(this.paras.slice(pa, pb + 1));
    const out = setBullets(this.paras, this.marks, pa, pb, add);
    this.snapshot();
    const move = (offset: number) => {
      const i = count(this.value.slice(0, offset), "\n");
      const col = offset - this.paraStart(i);
      let before = 0;
      for (let k = 0; k < i; k++) before += out.paras[k].length + 1;
      return before + Math.max(0, Math.min(col + out.shift[i], out.paras[i].length));
    };
    const [s, e] = [move(this.start), move(this.end)];
    this.paras = out.paras;
    this.marks = out.flags;
    this.start = s;
    this.end = e;
    this.changed();
  }

  private selectedFlags(): number[] {
    this.readSelection();
    if (this.start === this.end)
      return [this.pending !== null && this.pendingAt === this.start ? this.pending : this.flagsNear(this.flat(), this.start, this.start)];
    // The selected letters, not counting bullets (they're never struck through).
    const out: number[] = [];
    let offset = 0;
    this.paras.forEach((p, i) => {
      const skip = p.startsWith(BULLET) ? BULLET.length : 0;
      for (let k = skip; k < p.length; k++) if (offset + k >= this.start && offset + k < this.end) out.push(this.marks[i][k] ?? 0);
      offset += p.length + 1;
    });
    return out.length
      ? out
      : this.flat()
          .slice(this.start, this.end)
          .filter((f) => f >= 0);
  }

  /** Styles of all characters in one list, with -1 for line breaks (lines up with value). */
  private flat(): number[] {
    const out: number[] = [];
    this.marks.forEach((f, i) => {
      if (i) out.push(-1);
      out.push(...f);
    });
    return out;
  }
  private unflat(flat: number[]): number[][] {
    const out: number[][] = [[]];
    for (const f of flat) {
      if (f < 0) out.push([]);
      else out[out.length - 1].push(f);
    }
    return out;
  }

  /** Style for letters typed at a: the letter before it (or after it at the start of a line). */
  private flagsNear(flat: number[], a: number, b: number): number {
    if (b > a && flat[a] >= 0) return flat[a];
    if (a > 0 && flat[a - 1] >= 0) return flat[a - 1];
    if (flat[a] >= 0) return flat[a];
    for (let k = a - 1; k >= 0; k--) if (flat[k] >= 0) return flat[k];
    return 0;
  }

  // ---- editing ----
  private onBeforeInput = (event: Event) => {
    const e = event as InputEvent;
    if (e.isComposing || e.inputType === "insertCompositionText") return; // IME: synced at compositionend
    e.preventDefault();
    this.readSelection();
    const v = this.value;
    const a = this.start;
    const b = this.end;
    const text = () => normalize(e.data ?? e.dataTransfer?.getData("text/plain") ?? "");
    const line = count(v.slice(0, a), "\n");
    const col = a - this.paraStart(line);
    const inList = a === b && this.paras[line].startsWith(BULLET) && col >= BULLET.length;
    switch (e.inputType) {
      case "insertText":
      case "insertReplacementText":
      case "insertFromPaste":
      case "insertFromDrop":
      case "insertFromYank":
        this.replace(a, b, text());
        break;
      case "insertParagraph":
      case "insertLineBreak":
        // In a list: the new line gets a bullet too; Enter on an empty item ends the list.
        if (inList && this.paras[line] === BULLET) this.replace(a - BULLET.length, a, "");
        else this.replace(a, b, inList ? `\n${BULLET}` : "\n");
        break;
      case "deleteContentBackward":
        if (a !== b) this.replace(a, b, "");
        else if (inList && col === BULLET.length) this.replace(a - BULLET.length, a, ""); // removes the bullet
        else if (a > 0) this.replace(prevChar(v, a), a, "");
        break;
      case "deleteContentForward":
        if (a !== b) this.replace(a, b, "");
        else if (a < v.length) this.replace(a, nextChar(v, a), "");
        break;
      case "deleteWordBackward":
        this.replace(a !== b ? a : wordStartBefore(v, a), b, "");
        break;
      case "deleteWordForward":
        this.replace(a, a !== b ? b : wordEndAfter(v, b), "");
        break;
      case "deleteSoftLineBackward":
      case "deleteHardLineBackward":
        this.replace(a !== b ? a : v.lastIndexOf("\n", a - 1) + 1, b, "");
        break;
      case "deleteSoftLineForward":
      case "deleteHardLineForward": {
        const nl = v.indexOf("\n", b);
        this.replace(a, a !== b ? b : nl < 0 ? v.length : nl, "");
        break;
      }
      case "deleteByCut":
      case "deleteByDrag":
      case "deleteContent":
        if (a !== b) this.replace(a, b, "");
        break;
      case "historyUndo":
        this.undo();
        break;
      case "historyRedo":
        this.redo();
        break;
      default:
        break; // the browser's own formatting doesn't apply here (Ctrl+B is handled below)
    }
  };

  // The browser has no undo history of its own here (every edit goes through the
  // model), so it never sends undo/redo input events: handle the keys directly.
  // Ctrl+B and Ctrl+Shift+X style the selected letters, like FigJam.
  private onKeyDown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      this.redo();
    } else if (key === "b" && !e.shiftKey) {
      e.preventDefault();
      this.toggleMark(BOLD);
    } else if (key === "x" && e.shiftKey) {
      e.preventDefault();
      this.toggleMark(STRIKE);
    }
  };

  private onCompositionEnd = () => {
    // The IME typed straight into the page: read the text back.
    const typed = Array.from(this.children).map((c) => (c.textContent ?? "").replace(/\n/g, ""));
    this.readSelection();
    this.snapshot();
    this.sizes = alignSizes(this.paras, this.sizes, typed, this.base);
    this.marks = alignMarks(this.paras, this.marks, typed);
    this.paras = typed;
    this.changed();
  };

  private onCopy = (event: ClipboardEvent) => {
    this.readSelection();
    if (this.start === this.end) return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", this.value.slice(this.start, this.end));
    // (cut then removes it through beforeinput "deleteByCut")
  };

  private replace(a: number, b: number, insert: string) {
    this.snapshot();
    const v = this.value;
    const flat = this.flat();
    const style = this.pending !== null && this.pendingAt === a && a === b ? this.pending : this.flagsNear(flat, a, b);
    this.pending = null;
    const pa = count(v.slice(0, a), "\n");
    const pb = count(v.slice(0, b), "\n");
    const next = v.slice(0, a) + insert + v.slice(b);
    const breaks = count(insert, "\n");
    const fill = this.sizes[pa] ?? this.base;
    this.sizes = [...this.sizes.slice(0, pa), ...Array(breaks + 1).fill(fill), ...this.sizes.slice(pb + 1)];
    // (one style per UTF-16 unit, like the string offsets)
    flat.splice(a, b - a, ...insert.split("").map((ch) => (ch === "\n" ? -1 : style)));
    this.marks = this.unflat(flat);
    this.paras = next.split("\n");
    this.start = this.end = a + insert.length;
    this.changed();
  }

  /** After a change: share it, redraw, and tell Excalidraw. */
  private changed() {
    this.syncLive();
    this.render();
    this.emit();
  }

  private snapshot() {
    this.undoStack.push({
      paras: this.paras.slice(),
      sizes: this.sizes.slice(),
      marks: this.marks.map((f) => f.slice()),
      start: this.start,
      end: this.end,
    });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  private restore(from: Snapshot[], to: Snapshot[]) {
    const s = from.pop();
    if (!s) return;
    to.push({ paras: this.paras.slice(), sizes: this.sizes.slice(), marks: this.marks.map((f) => f.slice()), start: this.start, end: this.end });
    this.paras = s.paras;
    this.sizes = s.sizes;
    this.marks = s.marks;
    this.start = s.start;
    this.end = s.end;
    this.changed();
  }
  private undo() {
    this.restore(this.undoStack, this.redoStack);
  }
  private redo() {
    this.restore(this.redoStack, this.undoStack);
  }

  private syncLive() {
    while (this.sizes.length < this.paras.length) this.sizes.push(this.sizes[this.sizes.length - 1] ?? this.base);
    this.sizes.length = this.paras.length;
    this.marks = fitFlags(this.marks, this.paras);
    // A bullet is never struck through (only the item's text is).
    this.paras.forEach((p, i) => {
      if (p.startsWith(BULLET)) for (let k = 0; k < BULLET.length; k++) this.marks[i][k] &= ~STRIKE;
    });
    if (!this.textId) return;
    if (liveSizes.has(this.textId) || new Set(this.sizes).size > 1 || this.sizes[0] !== this.base)
      liveSizes.set(this.textId, this.sizes.slice());
    if (this.styled || liveMarks.has(this.textId) || anyMarks(this.marks))
      liveMarks.set(
        this.textId,
        this.marks.map((f) => f.slice()),
      );
  }

  /** Tells Excalidraw the text changed (it re-measures and redraws). */
  private emit() {
    this.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // ---- drawing and caret ----
  private render() {
    const frag = document.createDocumentFragment();
    this.paras.forEach((p, i) => {
      const line = document.createElement("div");
      line.style.fontSize = `${this.sizes[i] ?? this.base}px`;
      if (!p) line.appendChild(document.createElement("br"));
      const f = this.marks[i] ?? [];
      for (let k = 0; k < p.length; ) {
        let e = k;
        while (e < p.length && (f[e] ?? 0) === (f[k] ?? 0)) e++;
        const span = document.createElement("span");
        span.style.fontWeight = (f[k] ?? 0) & BOLD ? "bold" : "normal";
        if ((f[k] ?? 0) & STRIKE) span.style.textDecoration = "line-through";
        span.textContent = p.slice(k, e);
        line.appendChild(span);
        k = e;
      }
      frag.appendChild(line);
    });
    this.replaceChildren(frag);
    if (document.activeElement === this) this.applySelection();
  }

  private paraStart(i: number) {
    let o = 0;
    for (let k = 0; k < i; k++) o += this.paras[k].length + 1;
    return o;
  }

  private toOffset(node: Node | null, off: number): number {
    if (!node) return 0;
    if (node === this) return off >= this.paras.length ? this.value.length : this.paraStart(off);
    let line: Node | null = node;
    while (line && line.parentNode !== this) line = line.parentNode;
    if (!line) return 0;
    const i = Array.prototype.indexOf.call(this.children, line);
    const len = this.paras[i]?.length ?? 0;
    // Letters between the start of the paragraph and this point (across its pieces).
    const range = document.createRange();
    range.setStart(line, 0);
    try {
      range.setEnd(node, off);
    } catch {
      return this.paraStart(i);
    }
    return this.paraStart(i) + Math.min(range.toString().length, len);
  }

  private toDom(offset: number): [Node, number] {
    const v = this.value;
    const i = count(v.slice(0, offset), "\n");
    const line = this.children[i];
    if (!line) return [this, 0];
    let rest = offset - this.paraStart(i);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      if (rest <= n.data.length) return [n, rest];
      rest -= n.data.length;
      last = n;
    }
    return last ? [last, last.data.length] : [line, 0];
  }

  private readSelection() {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount || !this.isConnected || !this.contains(sel.anchorNode)) return;
    const a = this.toOffset(sel.anchorNode, sel.anchorOffset);
    const f = this.toOffset(sel.focusNode, sel.focusOffset);
    this.start = Math.min(a, f);
    this.end = Math.max(a, f);
    // The caret moved: a style picked for the next letters no longer applies.
    if (this.pending !== null && (this.start !== this.pendingAt || this.end !== this.pendingAt)) this.pending = null;
  }

  private applySelection() {
    if (!this.isConnected || document.activeElement !== this) return;
    const sel = document.getSelection();
    if (!sel) return;
    const range = document.createRange();
    const [sn, so] = this.toDom(this.start);
    const [en, eo] = this.toDom(this.end);
    range.setStart(sn, so);
    range.setEnd(en, eo);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const prevChar = (v: string, i: number) => (i > 1 && isLowSurrogate(v.charCodeAt(i - 1)) ? i - 2 : i - 1);
const nextChar = (v: string, i: number) => (isLowSurrogate(v.charCodeAt(i + 1)) ? i + 2 : i + 1);
const wordStartBefore = (v: string, i: number) => {
  let k = i;
  while (k > 0 && /\s/.test(v[k - 1]) && v[k - 1] !== "\n") k--;
  while (k > 0 && !/\s/.test(v[k - 1])) k--;
  return k === i && i > 0 ? i - 1 : k;
};
const wordEndAfter = (v: string, i: number) => {
  let k = i;
  while (k < v.length && /\s/.test(v[k]) && v[k] !== "\n") k++;
  while (k < v.length && !/\s/.test(v[k])) k++;
  return k === i && i < v.length ? i + 1 : k;
};

// Hooks the patched Excalidraw looks for.
if (!customElements.get("mfa-rich-text")) customElements.define("mfa-rich-text", RichTextEditor);
const hooks = globalThis as unknown as {
  __mfaMixedLayout?: typeof richLayout;
  __mfaCreateEditor?: (element: TextEl) => HTMLElement;
  __mfaDrawRuns?: typeof drawRuns;
  __mfaSvgRuns?: typeof svgRuns;
};
hooks.__mfaMixedLayout = richLayout;
hooks.__mfaDrawRuns = drawRuns;
hooks.__mfaSvgRuns = svgRuns;
hooks.__mfaCreateEditor = (element) => {
  const editor = document.createElement("mfa-rich-text") as RichTextEditor;
  editor.setup(element);
  return editor;
};
