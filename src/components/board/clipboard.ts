// Copy and paste, like FigJam: copying from the board puts the real text on the
// clipboard (so pasting into a doc, chat or email gives the words, with bold and
// strikethrough where an app takes formatted text), and the board data rides along
// hidden in the formatted copy, so pasting back onto a board still gives the same
// stickies and shapes. Excalidraw is patched (scripts/patch-excalidraw.mjs) to call
// __mfaCopy when it copies and __mfaPasteData first when it pastes.

import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import { BOLD, charFlags, STRIKE } from "./richText";

/** Attribute on an empty <span> in the copied HTML holding the board data (Excalidraw's clipboard JSON). */
const DATA_ATTR = "data-mfa-board";
const CLIPBOARD_TYPE = "excalidraw/clipboard";

const isText = (el: ExcalidrawElement): el is ExcalidrawTextElement => el.type === "text" && !el.isDeleted;

/** Texts in reading order: row by row from the top, left to right within a row. */
function readingOrder(elements: readonly ExcalidrawElement[]): ExcalidrawTextElement[] {
  const byId = new Map(elements.map((el) => [el.id, el]));
  // A label is placed by its sticky or shape, not by where its first line sits inside it.
  const box = (t: ExcalidrawTextElement) => (t.containerId && byId.get(t.containerId)) || t;
  const texts = elements.filter(isText).filter((t) => t.originalText.trim());
  texts.sort((a, b) => box(a).y - box(b).y);
  const rows: ExcalidrawTextElement[][] = [];
  for (const t of texts) {
    const row = rows[rows.length - 1];
    const first = row && box(row[0]);
    // Same row when it starts above the middle of the row's first item.
    if (first && box(t).y < first.y + first.height / 2) row.push(t);
    else rows.push([t]);
  }
  return rows.flatMap((row) => row.sort((a, b) => box(a).x - box(b).x));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One paragraph as HTML, bold and struck-through parts marked. */
function paragraphHtml(text: string, flags: number[] | undefined): string {
  if (!text) return "<br>";
  let html = "";
  for (let i = 0; i < text.length; ) {
    const f = flags?.[i] ?? 0;
    let j = i + 1;
    while (j < text.length && (flags?.[j] ?? 0) === f) j++;
    let piece = escapeHtml(text.slice(i, j));
    if (f & STRIKE) piece = `<s>${piece}</s>`;
    if (f & BOLD) piece = `<b>${piece}</b>`;
    html += piece;
    i = j;
  }
  return html;
}

/**
 * The words of the copied elements, as plain text and as HTML: one text per line,
 * with a blank line between texts when any of them has several lines.
 */
function copiedText(elements: readonly ExcalidrawElement[]): { plain: string; html: string } {
  const texts = readingOrder(elements);
  const paras = texts.map((t) => t.originalText.split("\n"));
  const spaced = paras.some((p) => p.length > 1);
  const plain = paras.map((p) => p.join("\n")).join(spaced ? "\n\n" : "\n");
  const html = texts
    .map((t, i) => {
      const flags = charFlags(t);
      return paras[i].map((p, k) => `<p>${paragraphHtml(p, flags?.[k])}</p>`).join("");
    })
    .join(spaced ? "<p><br></p>" : "");
  return { plain, html };
}

/** Writes both formats when there's no copy event to write into (the right-click menu's Copy). */
function writeWithoutEvent(data: Record<string, string>): Promise<boolean> | boolean {
  // A copy command run now, while the click still counts as the user's, keeps the HTML as is.
  const onCopy = (e: ClipboardEvent) => {
    for (const [type, value] of Object.entries(data)) e.clipboardData?.setData(type, value);
    e.preventDefault();
    e.stopImmediatePropagation(); // (Excalidraw's own copy handler must not run again)
  };
  window.addEventListener("copy", onCopy, true);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    window.removeEventListener("copy", onCopy, true);
  }
  if (copied) return true;
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
  const item = new ClipboardItem(
    Object.fromEntries(Object.entries(data).map(([type, value]) => [type, new Blob([value], { type })])),
  );
  return navigator.clipboard.write([item]).then(
    () => true,
    () => false,
  );
}

/** Copy (and cut): the real text as plain text, the words plus the hidden board data as HTML. */
function copy(
  elements: readonly ExcalidrawElement[],
  boardJson: string,
  event: ClipboardEvent | null | undefined,
): Promise<boolean> | boolean {
  if (!elements.length) return true; // nothing selected: leave the clipboard alone
  const { plain, html } = copiedText(elements);
  const data: Record<string, string> = {
    "text/html": `<meta charset="utf-8"><span ${DATA_ATTR}="${escapeHtml(boardJson)}"></span>${html}`,
  };
  if (plain) data["text/plain"] = plain;
  if (event?.clipboardData) {
    for (const [type, value] of Object.entries(data)) event.clipboardData.setData(type, value);
    return true; // (Excalidraw cancels the event, so these are what get copied)
  }
  return writeWithoutEvent(data);
}

type PasteData = { elements: ExcalidrawElement[]; files?: Record<string, unknown> };

/** Paste: the board data copied above, if that's what's on the clipboard. */
function pasteData(event: ClipboardEvent | null | undefined, isPlainPaste: boolean): PasteData | undefined {
  if (isPlainPaste) return undefined; // Ctrl+Shift+V: just the text
  const html = event?.clipboardData?.getData("text/html");
  if (!html?.includes(DATA_ATTR)) return undefined;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const json = doc.querySelector(`[${DATA_ATTR}]`)?.getAttribute(DATA_ATTR);
    const data = json ? JSON.parse(json) : null;
    if (data?.type === CLIPBOARD_TYPE && Array.isArray(data.elements)) return { elements: data.elements, files: data.files };
  } catch (err) {
    console.warn("Could not read the copied board data", err);
  }
  return undefined;
}

// Hooks the patched Excalidraw looks for.
const hooks = globalThis as unknown as { __mfaCopy?: typeof copy; __mfaPasteData?: typeof pasteData };
hooks.__mfaCopy = copy;
hooks.__mfaPasteData = pasteData;
