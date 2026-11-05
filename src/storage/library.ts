import { APP_FOLDER_NAME } from "../config";
import {
  createFile,
  createFolder,
  deleteFile,
  fileBytes,
  getFile,
  listAllFiles,
  listTrashedFiles,
  updateMetadata,
  type DriveFile,
} from "../google/drive";
import { EMPTY_BOARD, forgetThumbnail, rememberThumbnails } from "./boards";

// Drive layout:
//   My Figma App/                role=root
//     Personal/                  role=workspace
//       Ideas/                   role=folder (folders can nest)
//         Board.excalidraw       role=board
//     .thumbnails/               role=thumbs (board previews)
// Everything is found by its role tag, so renaming in Drive is safe.

export type NodeKind = "workspace" | "folder" | "board";

export type LibraryNode = {
  id: string;
  name: string;
  kind: NodeKind;
  parentId: string | null;
  createdTime: string;
  modifiedTime: string;
};

export type Thumb = { id: string; modifiedTime: string };

export type Library = {
  rootId: string;
  nodes: Map<string, LibraryNode>;
  /** Folders and boards inside each workspace or folder, already sorted. */
  children: Map<string, LibraryNode[]>;
  workspaces: LibraryNode[];
  /** boardId → its thumbnail file. */
  thumbs: Map<string, Thumb>;
  /** boardId → Drive ids of its pasted images. */
  images: Map<string, string[]>;
  /** Bytes used in Drive by the app's files. */
  usage: Usage;
};

/** Bytes used in Google Drive, by kind. Trashed files still count until deleted. */
export type Usage = { boards: number; images: number; previews: number; trash: number };

export const totalUsage = (u: Usage) => u.boards + u.images + u.previews + u.trash;

const BOARD_EXT = ".excalidraw";
const role = (f: DriveFile) => f.appProperties?.role;

export function boardFileName(name: string): string {
  return `${name}${BOARD_EXT}`;
}

function displayName(f: DriveFile): string {
  return role(f) === "board" && f.name.toLowerCase().endsWith(BOARD_EXT)
    ? f.name.slice(0, -BOARD_EXT.length)
    : f.name;
}

let inFlight: Promise<Library> | null = null;

/** Loads the whole library. Concurrent calls share one request. */
export function loadLibrary(): Promise<Library> {
  inFlight ??= fetchLibrary().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function fetchLibrary(): Promise<Library> {
  const [files, trashed] = await Promise.all([listAllFiles(), listTrashedFiles()]);
  const trashBytes = trashed.reduce((sum, f) => sum + fileBytes(f), 0);

  let root = files
    .filter((f) => role(f) === "root")
    .sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? ""))[0];
  if (!root) {
    root = await createFolder(APP_FOLDER_NAME, undefined, { role: "root" });
    files.push(root);
  }

  const inRoot = (f: DriveFile) => f.parents?.includes(root.id);
  let firstWorkspace = files.find((f) => role(f) === "workspace" && inRoot(f));
  if (!firstWorkspace) {
    firstWorkspace = await createFolder("Personal", root.id, { role: "workspace" });
    files.push(firstWorkspace);
  }

  // Boards from before workspaces existed sit directly in the app folder.
  for (const f of files) {
    if (role(f) === "board" && inRoot(f)) {
      await updateMetadata(f.id, {}, { from: root.id, to: firstWorkspace.id });
      f.parents = [firstWorkspace.id];
    }
  }

  return buildLibrary(root.id, files, trashBytes);
}

function buildLibrary(rootId: string, files: DriveFile[], trashBytes: number): Library {
  const nodes = new Map<string, LibraryNode>();
  const thumbs = new Map<string, Thumb>();
  const images = new Map<string, string[]>();
  const usage: Usage = { boards: 0, images: 0, previews: 0, trash: trashBytes };

  for (const f of files) {
    const r = role(f);
    if (r === "board") usage.boards += fileBytes(f);
    else if (r === "image") usage.images += fileBytes(f);
    else if (r === "thumb") usage.previews += fileBytes(f);
    const boardId = f.appProperties?.board;
    if (r === "thumb" && boardId) {
      thumbs.set(boardId, { id: f.id, modifiedTime: f.modifiedTime ?? "" });
      continue;
    }
    if (r === "image" && boardId) {
      images.set(boardId, [...(images.get(boardId) ?? []), f.id]);
      continue;
    }
    if (r !== "workspace" && r !== "folder" && r !== "board") continue;
    const parentId = f.parents?.[0] ?? null;
    if (r === "workspace" && parentId !== rootId) continue;
    nodes.set(f.id, {
      id: f.id,
      name: displayName(f),
      kind: r,
      parentId,
      createdTime: f.createdTime ?? "",
      modifiedTime: f.modifiedTime ?? "",
    });
  }

  const children = new Map<string, LibraryNode[]>();
  for (const node of nodes.values()) {
    if (node.kind === "workspace" || !node.parentId) continue;
    const parent = nodes.get(node.parentId);
    if (!parent || parent.kind === "board") continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  for (const list of children.values()) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1; // folders first
      return a.kind === "folder"
        ? collator.compare(a.name, b.name) // folders A→Z
        : b.modifiedTime.localeCompare(a.modifiedTime); // boards newest first
    });
  }

  const workspaces = [...nodes.values()]
    .filter((n) => n.kind === "workspace")
    .sort((a, b) => a.createdTime.localeCompare(b.createdTime));

  rememberThumbnails(thumbs);
  return { rootId, nodes, children, workspaces, thumbs, images, usage };
}

/** Workspace → … → node, for breadcrumbs. */
export function pathTo(lib: Library, id: string): LibraryNode[] {
  const path: LibraryNode[] = [];
  let node = lib.nodes.get(id);
  while (node && path.length < 50) {
    path.unshift(node);
    node = node.parentId ? lib.nodes.get(node.parentId) : undefined;
  }
  return path;
}

/** All folders and boards below a node. */
export function descendants(lib: Library, id: string): LibraryNode[] {
  const out: LibraryNode[] = [];
  const stack = [...(lib.children.get(id) ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    out.push(node);
    stack.push(...(lib.children.get(node.id) ?? []));
  }
  return out;
}

export function countItems(lib: Library, id: string): number {
  return lib.children.get(id)?.length ?? 0;
}

/** Name and folder of a board that isn't in the loaded library yet. */
export async function getBoardInfo(
  id: string,
): Promise<{ id: string; name: string; parentId: string | null; modifiedTime: string }> {
  const f = await getFile(id);
  if (role(f) !== "board" || f.trashed) throw new Error("This board doesn't exist anymore.");
  return { id: f.id, name: displayName(f), parentId: f.parents?.[0] ?? null, modifiedTime: f.modifiedTime ?? "" };
}

// ---- Changes -------------------------------------------------------------

export async function createWorkspace(lib: Library, name: string): Promise<string> {
  const f = await createFolder(name, lib.rootId, { role: "workspace" });
  return f.id;
}

export async function createSubfolder(parentId: string, name: string): Promise<string> {
  const f = await createFolder(name, parentId, { role: "folder" });
  return f.id;
}

export async function createBoard(parentId: string, name: string): Promise<string> {
  const f = await createFile(
    {
      name: boardFileName(name),
      mimeType: "application/json",
      parents: [parentId],
      appProperties: { role: "board" },
    },
    EMPTY_BOARD,
  );
  return f.id;
}

export async function renameNode(node: Pick<LibraryNode, "id" | "kind">, name: string): Promise<void> {
  await updateMetadata(node.id, { name: node.kind === "board" ? boardFileName(name) : name });
}

export async function moveNode(node: LibraryNode, toParentId: string): Promise<void> {
  if (!node.parentId || node.parentId === toParentId) return;
  await updateMetadata(node.id, {}, { from: node.parentId, to: toParentId });
}

/**
 * Moves a node (and everything inside it) to Drive's trash. Drive deletes
 * trashed items for good after 30 days. The date and what went along with it
 * are noted on the files, so the app's Trash can show and restore them.
 */
export async function trashNode(lib: Library, node: LibraryNode): Promise<void> {
  const trashedAt = new Date().toISOString();
  await updateMetadata(node.id, { trashed: true, appProperties: { trashedAt } });
  // The previews and images of those boards go to the trash with them.
  const boards = [node, ...descendants(lib, node.id)].filter((n) => n.kind === "board");
  const extras: string[] = [];
  for (const b of boards) {
    const thumb = lib.thumbs.get(b.id);
    if (thumb) extras.push(thumb.id);
    extras.push(...(lib.images.get(b.id) ?? []));
    forgetThumbnail(b.id);
  }
  await Promise.allSettled(
    extras.map((id) => updateMetadata(id, { trashed: true, appProperties: { trashedAt, trashedWith: node.id } })),
  );
}

// ---- Trash -----------------------------------------------------------------

export const TRASH_DAYS = 30;

export type TrashItem = {
  id: string;
  name: string;
  kind: NodeKind;
  parentId: string | null;
  /** When it was trashed from this app (unknown for items trashed in Drive). */
  trashedAt?: string;
  /** Bytes it frees when deleted, including what's inside and its images. */
  bytes: number;
  /** Previews and images that went to the trash with it. */
  extraIds: string[];
};

export type Trash = {
  items: TrashItem[];
  /** Every trashed app file, for restoring and deleting. */
  files: DriveFile[];
  /** Total bytes the app's trashed files still take. */
  bytes: number;
};

export async function loadTrash(): Promise<Trash> {
  const files = await listTrashedFiles();
  const byId = new Map(files.map((f) => [f.id, f]));
  const kinds = new Set(["workspace", "folder", "board"]);

  /** Trashed files inside `id` (any depth), plus `id` itself. */
  const within = (id: string): DriveFile[] => {
    const out: DriveFile[] = [];
    for (const f of files) {
      let cur: DriveFile | undefined = f;
      for (let depth = 0; cur && depth < 50; depth++) {
        if (cur.id === id) {
          out.push(f);
          break;
        }
        cur = cur.parents?.[0] ? byId.get(cur.parents[0]) : undefined;
      }
    }
    return out;
  };

  const items: TrashItem[] = files
    .filter((f) => f.explicitlyTrashed && kinds.has(role(f) ?? ""))
    .map((f) => {
      const inside = within(f.id);
      const boards = new Set(inside.filter((x) => role(x) === "board").map((x) => x.id));
      // Tagged when trashed from this app; older items are matched by board.
      const extras = files.filter(
        (x) =>
          x.appProperties?.trashedWith === f.id ||
          (!x.appProperties?.trashedWith && role(x) !== "board" && boards.has(x.appProperties?.board ?? "")),
      );
      return {
        id: f.id,
        name: displayName(f),
        kind: role(f) as NodeKind,
        parentId: f.parents?.[0] ?? null,
        trashedAt: f.appProperties?.trashedAt,
        bytes: [...inside, ...extras].reduce((sum, x) => sum + fileBytes(x), 0),
        extraIds: extras.map((x) => x.id),
      };
    })
    .sort((a, b) => (b.trashedAt ?? "").localeCompare(a.trashedAt ?? ""));

  return { items, files, bytes: files.reduce((sum, f) => sum + fileBytes(f), 0) };
}

/** Days left before Drive deletes it for good (undefined if unknown). */
export function daysLeft(item: TrashItem): number | undefined {
  if (!item.trashedAt) return undefined;
  const ms = Date.parse(item.trashedAt) + TRASH_DAYS * 86_400_000 - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** Puts an item back where it was (or in a workspace if that place is gone). */
export async function restoreItem(lib: Library, item: TrashItem): Promise<void> {
  const clear = { trashedAt: null, trashedWith: null };
  const parentAlive = item.parentId === lib.rootId || (!!item.parentId && lib.nodes.has(item.parentId));
  const fallback = item.kind === "workspace" ? lib.rootId : lib.workspaces[0]?.id;
  const move = !parentAlive && item.parentId && fallback ? { from: item.parentId, to: fallback } : undefined;
  await updateMetadata(item.id, { trashed: false, appProperties: clear }, move);
  await Promise.allSettled(item.extraIds.map((id) => updateMetadata(id, { trashed: false, appProperties: clear })));
}

/** Deletes an item, everything inside it and its images for good. */
export async function deleteForever(item: TrashItem): Promise<void> {
  await deleteFile(item.id);
  await Promise.allSettled(item.extraIds.map((id) => deleteFile(id)));
}

/** Deletes everything in the app's trash for good. */
export async function emptyTrash(trash: Trash): Promise<void> {
  await Promise.allSettled(trash.files.filter((f) => f.explicitlyTrashed).map((f) => deleteFile(f.id)));
}
