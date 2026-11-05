import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { APP_FOLDER_NAME } from "../config";
import {
  createFolder,
  createJsonFile,
  findByRole,
  readTextFile,
  updateJsonFile,
  type DriveFile,
} from "../google/drive";

// Drive layout (Phase 2):
//   My Figma App/            ← app folder, tagged role=root
//     My first board.excalidraw   ← tagged role=board
// Files are found by their tags, so renaming them in Drive is fine.

export type BoardRef = { id: string; name: string };

const EMPTY_BOARD = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "my-figma-app",
  elements: [],
  appState: {},
  files: {},
});

export async function ensureAppFolder(): Promise<DriveFile> {
  const existing = await findByRole("root");
  if (existing.length > 0) return existing[0];
  return createFolder(APP_FOLDER_NAME, undefined, { role: "root" });
}

/** Opens the most recently edited board, creating a first one if there is none. */
export async function ensureDefaultBoard(folderId: string): Promise<BoardRef> {
  const boards = await findByRole("board", folderId);
  if (boards.length > 0) return { id: boards[0].id, name: stripExtension(boards[0].name) };
  const file = await createJsonFile("My first board.excalidraw", folderId, { role: "board" }, EMPTY_BOARD);
  return { id: file.id, name: stripExtension(file.name) };
}

export async function loadBoard(fileId: string): Promise<ExcalidrawInitialDataState> {
  const text = await readTextFile(fileId);
  if (!text.trim()) return {};
  const data = JSON.parse(text);
  if (data?.type !== "excalidraw") throw new Error("This file is not a board.");
  return { elements: data.elements ?? [], appState: data.appState ?? {}, files: data.files ?? {} };
}

export function saveBoard(fileId: string, json: string): Promise<void> {
  return updateJsonFile(fileId, json);
}

function stripExtension(name: string): string {
  return name.replace(/\.excalidraw$/i, "");
}
