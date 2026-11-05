import { clearToken, getValidToken } from "./auth";

// Thin wrapper around the Google Drive REST API (v3), called straight
// from the browser. With the drive.file scope, every request only ever
// sees files this app created.

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Thrown when the sign-in has expired and the user needs to reconnect. */
export class AuthExpiredError extends Error {
  constructor() {
    super("Your Google sign-in expired.");
    this.name = "AuthExpiredError";
  }
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  trashed?: boolean;
};

const FILE_FIELDS = "id,name,mimeType,createdTime,modifiedTime,parents,appProperties";

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = getValidToken();
  if (!token) throw new AuthExpiredError();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    throw new AuthExpiredError();
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.message ?? "";
    } catch {
      /* not JSON */
    }
    throw new Error(`Google Drive error ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res;
}

/** Escapes a value for use inside a Drive search query string. */
function q(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function getUser(): Promise<{ displayName: string; emailAddress: string }> {
  const res = await driveFetch(`${API}/about?fields=user(displayName,emailAddress)`);
  const body = await res.json();
  return body.user;
}

/** Every file this app can see (only ones it created), across all pages. */
export async function listAllFiles(): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: "trashed = false",
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: "1000",
      spaces: "drive",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await driveFetch(`${API}/files?${params}`);
    const body = await res.json();
    files.push(...(body.files as DriveFile[]));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return files;
}

export async function findFiles(query: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `${query} and trashed = false`,
    fields: `files(${FILE_FIELDS})`,
    spaces: "drive",
    pageSize: "100",
  });
  const res = await driveFetch(`${API}/files?${params}`);
  const body = await res.json();
  return body.files as DriveFile[];
}

/** Finds files tagged with appProperties[key] = value. */
export function findByProperty(key: string, value: string): Promise<DriveFile[]> {
  return findFiles(`appProperties has { key='${q(key)}' and value='${q(value)}' }`);
}

export async function getFile(fileId: string): Promise<DriveFile> {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS},trashed`);
  return res.json();
}

export async function createFolder(
  name: string,
  parentId: string | undefined,
  appProperties: Record<string, string>,
): Promise<DriveFile> {
  const res = await driveFetch(`${API}/files?fields=${FILE_FIELDS}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: parentId ? [parentId] : undefined,
      appProperties,
    }),
  });
  return res.json();
}

/** Creates a file with metadata and content in one request. */
export async function createFile(
  metadata: { name: string; mimeType: string; parents: string[]; appProperties: Record<string, string> },
  content: Blob | string,
): Promise<DriveFile> {
  const boundary = `mfa-${crypto.randomUUID()}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ]);
  const res = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return res.json();
}

/** Replaces a file's content. */
export async function updateContent(fileId: string, content: Blob | string, contentType: string): Promise<void> {
  await driveFetch(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media`, {
    method: "PATCH",
    headers: { "Content-Type": contentType },
    body: content,
  });
}

/** Changes metadata (name, trashed…) and optionally moves the file. */
export async function updateMetadata(
  fileId: string,
  metadata: Record<string, unknown>,
  move?: { from: string; to: string },
): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: FILE_FIELDS });
  if (move) {
    params.set("addParents", move.to);
    params.set("removeParents", move.from);
  }
  const res = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  return res.json();
}

/** Moves a file to Drive's trash (recoverable from drive.google.com for 30 days). */
export async function trashFile(fileId: string): Promise<void> {
  await updateMetadata(fileId, { trashed: true });
}

export async function readText(fileId: string): Promise<string> {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
  return res.text();
}

export async function readBlob(fileId: string): Promise<Blob> {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
  return res.blob();
}
