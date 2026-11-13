// Images: when each was added to the board (shown top right while images are
// selected), and downloading the selected ones.

import { useEffect, useReducer, useRef } from "react";
import { mutateElement } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawImageElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const isImage = (el: ExcalidrawElement): el is ExcalidrawImageElement => el.type === "image";

/**
 * Stamps each image that arrives on the board (added, pasted, dropped or
 * duplicated) with the time, in customData.addedAt. Images already on the board
 * when it opens are left as they are (`existing`: the shapes of all its pages).
 */
export function useStampNewImages(api: ExcalidrawImperativeAPI | null, existing: () => Iterable<readonly ExcalidrawElement[]>) {
  const existingRef = useRef(existing);
  existingRef.current = existing;
  useEffect(() => {
    if (!api) return;
    const seen = new Set<string>();
    for (const page of existingRef.current()) for (const el of page) if (isImage(el)) seen.add(el.id);
    for (const el of api.getSceneElementsIncludingDeleted()) if (isImage(el)) seen.add(el.id);
    let fresh: string[] = [];
    const stamp = () => {
      const ids = new Set(fresh);
      fresh = [];
      const now = Date.now();
      for (const el of api.getSceneElementsIncludingDeleted()) {
        // In place (not a new copy): Excalidraw is still loading new images into this very object.
        if (ids.has(el.id) && !el.isDeleted) mutateElement(el, { customData: { ...el.customData, addedAt: now } });
      }
    };
    return api.onChange((elements) => {
      for (const el of elements) {
        if (!isImage(el) || seen.has(el.id)) continue;
        seen.add(el.id);
        if (fresh.push(el.id) === 1) queueMicrotask(stamp);
      }
    });
  }, [api]);
}

/** When the image was added: stamped on it, else when its picture first came onto the board. */
function addedAt(el: ExcalidrawImageElement, files: BinaryFiles, driveTimes: ReadonlyMap<string, number>): number | null {
  const stamped = el.customData?.addedAt;
  if (typeof stamped === "number") return stamped;
  const file = el.fileId ? files[el.fileId] : undefined;
  if (file?.created) return file.created;
  return (el.fileId && driveTimes.get(el.fileId)) || null;
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dayNoYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "Added 12 Nov 2026, 14:32", or for several: "5 images · 3 Oct – 12 Nov 2026". */
function describe(times: number[], count: number): string {
  const first = Math.min(...times);
  const last = Math.max(...times);
  if (count === 1) return `Added ${day.format(first)}, ${time.format(first)}`;
  const from = new Date(first);
  const to = new Date(last);
  let range: string;
  if (day.format(from) === day.format(to)) range = `Added ${day.format(to)}`;
  else if (from.getFullYear() === to.getFullYear()) range = `${dayNoYear.format(from)} – ${day.format(to)}`;
  else range = `${day.format(from)} – ${day.format(to)}`;
  return `${count} images · ${range}`;
}

/** Small panel under the top right bar: when the selected images were added. */
export function ImageInfo({ api, driveTimes }: { api: ExcalidrawImperativeAPI; driveTimes: ReadonlyMap<string, number> }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const text = useRef("");

  useEffect(() => {
    const check = () => {
      const s = api.getAppState();
      const files = api.getFiles();
      const times: number[] = [];
      let count = 0;
      for (const el of api.getSceneElements()) {
        if (!s.selectedElementIds[el.id] || !isImage(el)) continue;
        count++;
        const t = addedAt(el, files, driveTimes);
        if (t) times.push(t);
      }
      const next = times.length ? describe(times, count) : "";
      if (next !== text.current) {
        text.current = next;
        rerender();
      }
    };
    check();
    return api.onChange(check);
  }, [api, driveTimes]);

  if (!text.current) return null;
  return (
    <div className="fx-panel fx-image-info" role="status">
      {text.current}
    </div>
  );
}

/** The selected images, top to bottom and left to right (each picture once). */
export function selectedImages(api: ExcalidrawImperativeAPI): ExcalidrawImageElement[] {
  const selected = api.getAppState().selectedElementIds;
  const images: ExcalidrawImageElement[] = [];
  for (const el of api.getSceneElements()) if (selected[el.id] && isImage(el) && el.fileId) images.push(el);
  images.sort((a, b) => a.y - b.y || a.x - b.x);
  const seen = new Set<string>();
  return images.filter((el) => !seen.has(el.fileId!) && !!seen.add(el.fileId!));
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, "-");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Gap between the downloads (browsers can drop ones started all at once). */
const DOWNLOAD_GAP_MS = 250;

const EXTENSIONS: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
  "image/x-icon": "ico",
};

/** Downloads each selected image as its own file ("Board - image 1.png", …). */
export async function downloadSelectedImages(api: ExcalidrawImperativeAPI, boardName: string) {
  const images = selectedImages(api);
  const files = api.getFiles();
  const left = images.filter((el) => !files[el.fileId!]?.dataURL).length;
  if (left) api.setToast({ message: `${left} image${left > 1 ? "s are" : " is"} still loading, try again in a moment.`, duration: 3000 });
  let started = false;
  for (const [i, el] of images.entries()) {
    const file = files[el.fileId!];
    if (!file?.dataURL) continue;
    if (started) await new Promise((r) => setTimeout(r, DOWNLOAD_GAP_MS));
    started = true;
    const blob = await (await fetch(file.dataURL)).blob();
    const ext = EXTENSIONS[file.mimeType] ?? file.mimeType.split("/")[1] ?? "png";
    download(blob, `${boardName} - image${images.length > 1 ? ` ${i + 1}` : ""}.${ext}`);
  }
}
