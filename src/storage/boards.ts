import { getNonDeletedElements, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import {
  createFile,
  createFolder,
  findByProperties,
  findByProperty,
  readBlob,
  readText,
  trashFile,
  updateContent,
} from "../google/drive";

// Drive layout for board content:
//   <folder>/Board.excalidraw        pages with shapes and text (role=board)
//   My Figma App/.images/<id>.png    pasted images   (role=image, board=<boardId>, file=<excalidraw file id>)
//   My Figma App/.thumbnails/<id>.png  previews      (role=thumb, board=<boardId>)

export type Page = { id: string; name: string; elements: readonly ExcalidrawElement[] };

export type BoardContent = {
  pages: Page[];
  appState: Partial<AppState>;
  /** Only in boards saved before images had their own files. */
  files: BinaryFiles;
};

export const newPageId = () => `page-${crypto.randomUUID().slice(0, 8)}`;

export const EMPTY_BOARD = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "my-figma-app",
  format: 2,
  elements: [],
  appState: {},
  files: {},
  pages: [{ id: "page-1", name: "Page 1", elements: [] }],
});

export async function loadBoard(fileId: string): Promise<BoardContent> {
  const text = await readText(fileId);
  const data = text.trim() ? JSON.parse(text) : { type: "excalidraw" };
  if (data?.type !== "excalidraw") throw new Error("This file is not a board.");
  const pages: Page[] =
    Array.isArray(data.pages) && data.pages.length > 0
      ? data.pages.map((p: Partial<Page>, i: number) => ({
          id: String(p.id ?? `page-${i + 1}`),
          name: String(p.name ?? `Page ${i + 1}`),
          elements: p.elements ?? [],
        }))
      : // Boards from before pages existed: everything is on page 1.
        [{ id: "page-1", name: "Page 1", elements: data.elements ?? [] }];
  return { pages, appState: data.appState ?? {}, files: data.files ?? {} };
}

/** Board file content: every page's shapes, without image data. */
export function serializeBoard(pages: Page[], appState: Partial<AppState>): string {
  const cleaned = JSON.parse(serializeAsJSON([], appState, {}, "local")).appState;
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "my-figma-app",
    format: 2,
    elements: [],
    appState: cleaned,
    files: {},
    pages: pages.map((p) => ({ id: p.id, name: p.name, elements: getNonDeletedElements(p.elements) })),
  });
}

export function saveBoard(fileId: string, json: string): Promise<void> {
  return updateContent(fileId, json, "application/json");
}

// ---- Hidden app folders ----------------------------------------------------

const hiddenFolders = new Map<string, Promise<string>>();

function ensureHiddenFolder(role: "thumbs" | "images", name: string): Promise<string> {
  let folder = hiddenFolders.get(role);
  if (!folder) {
    folder = (async () => {
      const [existing] = await findByProperty("role", role);
      if (existing) return existing.id;
      const [root] = await findByProperty("role", "root");
      if (!root) throw new Error("App folder not found.");
      return (await createFolder(name, root.id, { role })).id;
    })();
    folder.catch(() => hiddenFolders.delete(role));
    hiddenFolders.set(role, folder);
  }
  return folder;
}

// ---- Images ----------------------------------------------------------------

export type BoardImage = { fileId: string; driveId: string; mimeType: string; createdTime: string };

export async function listBoardImages(boardId: string): Promise<BoardImage[]> {
  const files = await findByProperties({ role: "image", board: boardId });
  return files
    .filter((f) => f.appProperties?.file)
    .map((f) => ({
      fileId: f.appProperties!.file,
      driveId: f.id,
      mimeType: f.mimeType,
      createdTime: f.createdTime ?? "",
    }));
}

/** Uploads one pasted image and returns its Drive file id. */
export async function uploadImage(boardId: string, file: BinaryFileData): Promise<string> {
  const folderId = await ensureHiddenFolder("images", ".images");
  const blob = await (await fetch(file.dataURL)).blob();
  const ext = (file.mimeType.split("/")[1] ?? "bin").replace("svg+xml", "svg");
  const created = await createFile(
    {
      name: `${file.id}.${ext}`,
      mimeType: file.mimeType,
      parents: [folderId],
      appProperties: { role: "image", board: boardId, file: file.id },
    },
    blob,
  );
  return created.id;
}

export async function downloadImage(image: BoardImage): Promise<BinaryFileData> {
  const blob = await readBlob(image.driveId);
  const dataURL = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return {
    id: image.fileId as BinaryFileData["id"],
    mimeType: image.mimeType as BinaryFileData["mimeType"],
    dataURL: dataURL as BinaryFileData["dataURL"],
    created: Date.parse(image.createdTime) || Date.now(),
    lastRetrieved: Date.now(),
  };
}

/**
 * Moves images no longer used on the board to the trash. Only images older
 * than the board's last save are touched, so an image another tab is still
 * saving is never removed.
 */
export async function trashUnusedImages(
  images: BoardImage[],
  usedFileIds: Set<string>,
  boardModifiedTime: string,
): Promise<void> {
  const cutoff = Date.parse(boardModifiedTime) - 60_000;
  if (!Number.isFinite(cutoff)) return;
  const unused = images.filter((i) => !usedFileIds.has(i.fileId) && Date.parse(i.createdTime) < cutoff);
  await Promise.allSettled(unused.map((i) => trashFile(i.driveId)));
}

// ---- Thumbnails ----------------------------------------------------------
// Each board gets a small PNG preview so the home screen can show it.

/** boardId → thumbnail file id (null = known to have none). */
const thumbIds = new Map<string, string | null>();

export function rememberThumbnails(thumbs: Map<string, { id: string }>): void {
  for (const [boardId, t] of thumbs) thumbIds.set(boardId, t.id);
}

export function forgetThumbnail(boardId: string): void {
  thumbIds.set(boardId, null);
}

async function findThumbId(boardId: string): Promise<string | null> {
  if (thumbIds.has(boardId)) return thumbIds.get(boardId)!;
  const [file] = await findByProperties({ role: "thumb", board: boardId });
  thumbIds.set(boardId, file?.id ?? null);
  return file?.id ?? null;
}

export async function saveThumbnail(boardId: string, png: Blob): Promise<void> {
  const existing = await findThumbId(boardId);
  if (existing) {
    await updateContent(existing, png, "image/png");
    return;
  }
  const folderId = await ensureHiddenFolder("thumbs", ".thumbnails");
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
