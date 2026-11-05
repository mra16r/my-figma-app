// Mixed text sizes, like FigJam: each paragraph (line typed with Enter) of a text
// can have its own size. Stored on the text element:
//   customData.paraSizes  one size per paragraph of originalText
//   customData.lineSizes  one size per drawn line (after wrapping), used to draw
// Excalidraw is patched (scripts/patch-excalidraw.mjs) to call mixedLayout() when it
// lays out text, to draw each line at its size, and to use the rich editor below
// instead of its plain textarea, so sizes show while typing.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

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

/** Sizes in the rich editor right now, by text element id (newer than the element's). */
const liveSizes = new Map<string, number[]>();

const sizesOf = (el: { customData?: Record<string, unknown> }) => {
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
export function withoutSizes(customData: Record<string, unknown> | undefined): Record<string, unknown> {
  const rest = { ...(customData ?? {}) };
  delete rest.paraSizes;
  delete rest.lineSizes;
  return rest;
}

/**
 * Lays out a text whose paragraphs have their own sizes: wraps and measures each
 * paragraph at its size. Returns null for ordinary text (Excalidraw lays it out).
 */
function mixedLayout(element: ExcalidrawElement, text: string, maxWidth: number, fns: LayoutFns) {
  const el = element as TextEl;
  const live = liveSizes.get(el.id);
  const sizes = live ?? sizesOf(el);
  if (!sizes) return null;
  // Some callers pass the already-wrapped text; the sizes go with the typed text.
  const source = !live && text === el.text && el.text !== el.originalText ? el.originalText : text;
  const paras = source.split("\n");
  const list = paras.map((_, i) => Number(sizes[Math.min(i, sizes.length - 1)]) || el.fontSize);
  const rest = withoutSizes(el.customData);

  const lines: string[] = [];
  const lineSizes: number[] = [];
  let width = 0;
  let height = 0;
  paras.forEach((p, i) => {
    const font = fns.font({ ...el, fontSize: list[i] });
    const wrapped = Number.isFinite(maxWidth) && maxWidth > 0 ? fns.wrap(p, font, maxWidth) : p;
    const m = fns.measure(wrapped, font, el.lineHeight);
    width = Math.max(width, m.width);
    height += m.height;
    for (const line of wrapped.split("\n")) {
      lines.push(line);
      lineSizes.push(list[i]);
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
  return {
    text: lines.join("\n"),
    width,
    height,
    x,
    y: el.y,
    // One size left: an ordinary text again.
    ...(uniform ? { fontSize: list[0], customData: rest } : { customData: { ...rest, paraSizes: list, lineSizes } }),
  };
}

// ---- Rich editor ---------------------------------------------------------------

type Snapshot = { paras: string[]; sizes: number[]; start: number; end: number };

const count = (s: string, ch: string) => s.split(ch).length - 1;
const normalize = (s: string) => s.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");

/** Keeps sizes with their paragraphs when the whole text is replaced. */
function alignSizes(oldParas: string[], oldSizes: number[], newParas: string[], base: number): number[] {
  let head = 0;
  while (head < oldParas.length && head < newParas.length && oldParas[head] === newParas[head]) head++;
  let tail = 0;
  while (
    tail < oldParas.length - head &&
    tail < newParas.length - head &&
    oldParas[oldParas.length - 1 - tail] === newParas[newParas.length - 1 - tail]
  )
    tail++;
  const middle = newParas.length - head - tail;
  const fill = oldSizes[head] ?? oldSizes[head - 1] ?? base;
  return [...oldSizes.slice(0, head), ...Array(Math.max(0, middle)).fill(fill), ...oldSizes.slice(oldSizes.length - tail)];
}

let current: RichTextEditor | null = null;

/** The rich editor being typed in, if any. */
export const activeRichEditor = () => (current?.isConnected ? current : null);

/**
 * A text box that behaves like the <textarea> Excalidraw edits text in (value,
 * selectionStart/End, select(), input events…) but shows each paragraph at its size.
 */
class RichTextEditor extends HTMLElement {
  private paras: string[] = [""];
  private sizes: number[] = [16];
  private base = 16;
  private textId = "";
  private start = 0;
  private end = 0;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private listening = false;

  setup(element: TextEl) {
    this.textId = element.id;
    this.base = element.fontSize;
    const stored = sizesOf(element);
    this.paras = (element.originalText ?? "").split("\n");
    this.sizes = this.paras.map((_, i) => (stored ? (stored[Math.min(i, stored.length - 1)] ?? this.base) : this.base));
    if (stored) liveSizes.set(this.textId, this.sizes.slice());
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
    }
    this.render();
  }

  disconnectedCallback() {
    if (current === this) current = null;
    liveSizes.delete(this.textId);
  }

  // ---- textarea-like API (used by Excalidraw) ----
  get value() {
    return this.paras.join("\n");
  }
  set value(v: string) {
    const next = normalize(String(v)).split("\n");
    this.sizes = alignSizes(this.paras, this.sizes, next, this.base);
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

  // ---- sizes (used by the selection toolbar) ----
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
    this.syncLive();
    this.render();
    this.emit();
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
        this.replace(a, b, "\n");
        break;
      case "deleteContentBackward":
        if (a !== b) this.replace(a, b, "");
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
        break; // formatting shortcuts (Ctrl+B…) don't apply here
    }
  };

  // The browser has no undo history of its own here (every edit goes through the
  // model), so it never sends undo/redo input events: handle the keys directly.
  private onKeyDown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      this.redo();
    }
  };

  private onCompositionEnd = () => {
    // The IME typed straight into the page: read the text back.
    const typed = Array.from(this.children).map((c) => (c.textContent ?? "").replace(/\n/g, ""));
    this.readSelection();
    this.snapshot();
    this.sizes = alignSizes(this.paras, this.sizes, typed, this.base);
    this.paras = typed;
    this.syncLive();
    this.render();
    this.emit();
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
    const pa = count(v.slice(0, a), "\n");
    const pb = count(v.slice(0, b), "\n");
    const next = v.slice(0, a) + insert + v.slice(b);
    const breaks = count(insert, "\n");
    const fill = this.sizes[pa] ?? this.base;
    this.sizes = [...this.sizes.slice(0, pa), ...Array(breaks + 1).fill(fill), ...this.sizes.slice(pb + 1)];
    this.paras = next.split("\n");
    this.start = this.end = a + insert.length;
    this.syncLive();
    this.render();
    this.emit();
  }

  private snapshot() {
    this.undoStack.push({ paras: this.paras.slice(), sizes: this.sizes.slice(), start: this.start, end: this.end });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  private restore(from: Snapshot[], to: Snapshot[]) {
    const s = from.pop();
    if (!s) return;
    to.push({ paras: this.paras.slice(), sizes: this.sizes.slice(), start: this.start, end: this.end });
    this.paras = s.paras;
    this.sizes = s.sizes;
    this.start = s.start;
    this.end = s.end;
    this.syncLive();
    this.render();
    this.emit();
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
    if (this.textId && (liveSizes.has(this.textId) || new Set(this.sizes).size > 1 || this.sizes[0] !== this.base))
      liveSizes.set(this.textId, this.sizes.slice());
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
      if (p) line.textContent = p;
      else line.appendChild(document.createElement("br"));
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
    let within = 0;
    if (node.nodeType === Node.TEXT_NODE) {
      // Offsets inside the paragraph's text (it may be split in several text nodes).
      let before = 0;
      for (const child of Array.from(line.childNodes)) {
        if (child === node) break;
        before += child.textContent?.length ?? 0;
      }
      within = before + off;
    } else if (node === line) within = off === 0 ? 0 : len;
    return this.paraStart(i) + Math.min(within, len);
  }

  private toDom(offset: number): [Node, number] {
    const v = this.value;
    const i = count(v.slice(0, offset), "\n");
    const line = this.children[i];
    if (!line) return [this, 0];
    const t = line.firstChild;
    if (t && t.nodeType === Node.TEXT_NODE) return [t, Math.min(offset - this.paraStart(i), t.textContent?.length ?? 0)];
    return [line, 0];
  }

  private readSelection() {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount || !this.isConnected || !this.contains(sel.anchorNode)) return;
    const a = this.toOffset(sel.anchorNode, sel.anchorOffset);
    const f = this.toOffset(sel.focusNode, sel.focusOffset);
    this.start = Math.min(a, f);
    this.end = Math.max(a, f);
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
  __mfaMixedLayout?: typeof mixedLayout;
  __mfaCreateEditor?: (element: TextEl) => HTMLElement;
};
hooks.__mfaMixedLayout = mixedLayout;
hooks.__mfaCreateEditor = (element) => {
  const editor = document.createElement("mfa-rich-text") as RichTextEditor;
  editor.setup(element);
  return editor;
};
