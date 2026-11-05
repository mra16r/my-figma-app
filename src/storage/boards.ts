import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import {
  createFile,
  createFolder,
  findByProperty,
  readBlob,
  readText,
  trashFile,
  updateContent,
} from "../google/drive";

export const EMPTY_BOARD = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "my-figma-app",
  elements: [],
  appState: {},
  files: {},
});

export async function loadBoard(fileId: string): Promise<ExcalidrawInitialDataState> {
  const text = await readText(fileId);
  if (!text.trim()) return {};
  const data = JSON.parse(text);
  if (data?.type !== "excalidraw") throw new Error("This file is not a board.");
  return { elements: data.elements ?? [], appState: data.appState ?? {}, files: data.files ?? {} };
}

export function saveBoard(fileId: string, json: string): Promise<void> {
  return updateContent(fileId, json, "application/json");
}

// ---- Thumbnails ----------------------------------------------------------
// Each board gets a small PNG preview in "My Figma App/.thumbnails/",
// tagged with the board's id, so the home screen can show it.

/** boardId → thumbnail file id (null = known to have none). */
const thumbIds = new Map<string, string | null>();
let thumbsFolder: Promise<string> | null = null;

export function rememberThumbnails(thumbs: Map<string, { id: string }>): void {
  for (const [boardId, t] of thumbs) thumbIds.set(boardId, t.id);
}

export function forgetThumbnail(boardId: string): void {
  thumbIds.set(boardId, null);
}

function ensureThumbsFolder(): Promise<string> {
  thumbsFolder ??= (async () => {
    const [existing] = await findByProperty("role", "thumbs");
    if (existing) return existing.id;
    const [root] = await findByProperty("role", "root");
    if (!root) throw new Error("App folder not found.");
    const folder = await createFolder(".thumbnails", root.id, { role: "thumbs" });
    return folder.id;
  })().catch((err) => {
    thumbsFolder = null;
    throw err;
  });
  return thumbsFolder;
}

async function findThumbId(boardId: string): Promise<string | null> {
  if (thumbIds.has(boardId)) return thumbIds.get(boardId)!;
  const [file] = await findByProperty("board", boardId);
  thumbIds.set(boardId, file?.id ?? null);
  return file?.id ?? null;
}

export async function saveThumbnail(boardId: string, png: Blob): Promise<void> {
  const existing = await findThumbId(boardId);
  if (existing) {
    await updateContent(existing, png, "image/png");
    return;
  }
  const folderId = await ensureThumbsFolder();
  const file = await createFile(
    {
      name: `${boardId}.png`,
      mimeType: "image/png",
      parents: [folderId],
      appProperties: { role: "thumb", board: boardId },
    },
    png,
  );
  thumbIds.set(boardId, file.id);
}

export async function removeThumbnail(boardId: string): Promise<void> {
  const existing = await findThumbId(boardId);
  if (!existing) return;
  await trashFile(existing);
  thumbIds.set(boardId, null);
}

/** Object URLs for thumbnails, keyed by file id + version. */
const thumbUrls = new Map<string, Promise<string>>();

export function thumbnailUrl(thumb: { id: string; modifiedTime: string }): Promise<string> {
  const key = `${thumb.id}@${thumb.modifiedTime}`;
  let url = thumbUrls.get(key);
  if (!url) {
    url = readBlob(thumb.id).then((blob) => URL.createObjectURL(blob));
    url.catch(() => thumbUrls.delete(key));
    thumbUrls.set(key, url);
  }
  return url;
}
