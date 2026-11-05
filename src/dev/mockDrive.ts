// Dev-only fake Google Drive, so the signed-in screens can be tested
// locally without a Google account. Never included in the live site.
// Open: http://localhost:5173/my-figma-app/?mock     (add &reset to start over)

type MockFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  createdTime: string;
  modifiedTime: string;
  trashed: boolean;
  content?: string; // data URL
};

const STORE_KEY = "mfa.mockDrive";
const FOLDER = "application/vnd.google-apps.folder";
let files = new Map<string, MockFile>();

const now = () => new Date().toISOString();
const newId = () => `mock${Math.random().toString(36).slice(2, 12)}`;

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...files.values()]));
  } catch {
    /* too big for storage: keep in memory */
  }
}

function seed() {
  // Looks like Phase 2: one board directly in the app folder.
  const root: MockFile = {
    id: newId(),
    name: "My Figma App",
    mimeType: FOLDER,
    appProperties: { role: "root" },
    createdTime: now(),
    modifiedTime: now(),
    trashed: false,
  };
  const board: MockFile = {
    id: newId(),
    name: "My first board.excalidraw",
    mimeType: "application/json",
    parents: [root.id],
    appProperties: { role: "board" },
    createdTime: now(),
    modifiedTime: now(),
    trashed: false,
    content: `data:application/json,${encodeURIComponent(
      JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} }),
    )}`,
  };
  files = new Map([root, board].map((f) => [f.id, f]));
  persist();
}

function isTrashed(f: MockFile, depth = 0): boolean {
  if (f.trashed) return true;
  const parent = f.parents?.[0] ? files.get(f.parents[0]) : undefined;
  return !!parent && depth < 50 && isTrashed(parent, depth + 1);
}

function matches(f: MockFile, q: string): boolean {
  if (q.includes("trashed = false") && isTrashed(f)) return false;
  for (const m of q.matchAll(/appProperties has \{ key='([^']*)' and value='([^']*)' \}/g)) {
    if (f.appProperties?.[m[1]] !== m[2]) return false;
  }
  for (const m of q.matchAll(/'([^']*)' in parents/g)) {
    if (!f.parents?.includes(m[1])) return false;
  }
  return true;
}

function meta(f: MockFile) {
  const { content: _content, ...rest } = f;
  return rest;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const notFound = () => json({ error: { message: "File not found" } }, 404);

function toDataUrl(content: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(content);
  });
}

async function parseMultipart(body: Blob, contentType: string) {
  const boundary = contentType.split("boundary=")[1];
  const bytes = new Uint8Array(await body.arrayBuffer());
  let latin = "";
  for (let i = 0; i < bytes.length; i++) latin += String.fromCharCode(bytes[i]);
  const metaStart = latin.indexOf("\r\n\r\n") + 4;
  const metaEnd = latin.indexOf(`\r\n--${boundary}`, metaStart);
  const metadata = JSON.parse(new TextDecoder().decode(bytes.slice(metaStart, metaEnd)));
  const contentStart = latin.indexOf("\r\n\r\n", metaEnd) + 4;
  const contentEnd = latin.lastIndexOf(`\r\n--${boundary}--`);
  return { metadata, content: new Blob([bytes.slice(contentStart, contentEnd)], { type: metadata.mimeType }) };
}

async function handle(url: URL, init: RequestInit, realFetch: typeof fetch): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const path = url.pathname;
  const fileId = decodeURIComponent(path.match(/\/files\/([^/]+)$/)?.[1] ?? "");

  if (path.endsWith("/drive/v3/about")) {
    return json({ user: { displayName: "Test User", emailAddress: "test@example.com" } });
  }

  if (path === "/drive/v3/files" && method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    return json({ files: [...files.values()].filter((f) => matches(f, q)).map(meta) });
  }

  if (path === "/drive/v3/files" && method === "POST") {
    const body = JSON.parse(init.body as string);
    const f: MockFile = { id: newId(), createdTime: now(), modifiedTime: now(), trashed: false, ...body };
    files.set(f.id, f);
    persist();
    return json(meta(f));
  }

  if (path === "/upload/drive/v3/files" && method === "POST") {
    const headers = new Headers(init.headers);
    const { metadata, content } = await parseMultipart(init.body as Blob, headers.get("Content-Type") ?? "");
    const f: MockFile = {
      id: newId(),
      createdTime: now(),
      modifiedTime: now(),
      trashed: false,
      ...metadata,
      content: await toDataUrl(content),
    };
    files.set(f.id, f);
    persist();
    return json(meta(f));
  }

  const f = files.get(fileId);
  if (!f) return notFound();

  if (path.startsWith("/upload/") && method === "PATCH") {
    const body = init.body;
    const blob = body instanceof Blob ? body : new Blob([body as string], { type: "application/json" });
    f.content = await toDataUrl(blob);
    f.modifiedTime = now();
    persist();
    return json(meta(f));
  }

  if (method === "PATCH") {
    Object.assign(f, JSON.parse((init.body as string) || "{}"));
    const add = url.searchParams.get("addParents");
    const remove = url.searchParams.get("removeParents");
    if (add || remove) f.parents = [...(f.parents ?? []).filter((p) => p !== remove), ...(add ? [add] : [])];
    f.modifiedTime = now();
    persist();
    return json(meta(f));
  }

  if (method === "GET" && url.searchParams.get("alt") === "media") {
    if (!f.content) return new Response("");
    return new Response(await (await realFetch(f.content)).blob());
  }

  if (method === "GET") return json(meta(f));
  return json({ error: { message: `Mock can't handle ${method} ${path}` } }, 400);
}

export function installMockDrive(reset: boolean): void {
  try {
    const raw = reset ? null : localStorage.getItem(STORE_KEY);
    if (raw) files = new Map((JSON.parse(raw) as MockFile[]).map((f) => [f.id, f]));
    else seed();
  } catch {
    seed();
  }
  localStorage.setItem("mfa.token", JSON.stringify({ accessToken: "mock", expiresAt: Date.now() + 365 * 86_400_000 }));
  localStorage.setItem("mfa.email", "test@example.com");

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.href);
    if (url.hostname !== "www.googleapis.com") return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 120)); // feel like a network
    return handle(url, init ?? {}, realFetch);
  };
  console.info("[mock] Fake Google Drive is active.");
}
