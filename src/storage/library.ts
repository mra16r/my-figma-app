import { APP_FOLDER_NAME } from "../config";
import {
  createFile,
  createFolder,
  getFile,
  listAllFiles,
  trashFile,
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
};

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
  const files = await listAllFiles();

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

  return buildLibrary(root.id, files);
}

function buildLibrary(rootId: string, files: DriveFile[]): Library {
  const nodes = new Map<string, LibraryNode>();
  const thumbs = new Map<string, Thumb>();

  for (const f of files) {
    const r = role(f);
    if (r === "thumb" && f.appProperties?.board) {
      thumbs.set(f.appProperties.board, { id: f.id, modifiedTime: f.modifiedTime ?? "" });
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
  return { rootId, nodes, children, workspaces, thumbs };
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
export async function getBoardInfo(id: string): Promise<{ id: string; name: string; parentId: string | null }> {
  const f = await getFile(id);
  if (role(f) !== "board" || f.trashed) throw new Error("This board doesn't exist anymore.");
  return { id: f.id, name: displayName(f), parentId: f.parents?.[0] ?? null };
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

/** Moves a node (and everything inside it) to Drive's trash. */
export async function trashNode(lib: Library, node: LibraryNode): Promise<void> {
  await trashFile(node.id);
  // Clean up previews of boards that went to the trash with it.
  const boards = [node, ...descendants(lib, node.id)].filter((n) => n.kind === "board");
  await Promise.allSettled(
    boards.map(async (b) => {
      const thumb = lib.thumbs.get(b.id);
      if (thumb) await trashFile(thumb.id);
      forgetThumbnail(b.id);
    }),
  );
}
