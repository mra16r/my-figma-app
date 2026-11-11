import { createFile, findByProperty, readText, updateContent, updateMetadata } from "../google/drive";

// Personal notes (changes to make), kept in one JSON file in the app folder:
//   My Figma App/Notes.json      role=notes, open=<count of notes not done>
// The count is on the file's tags, so the sidebar can show it without
// reading the file.

export type Note = {
  id: string;
  text: string;
  done: boolean;
  createdTime: string;
};

const FILE_NAME = "Notes.json";
const MIME = "application/json";

/** The notes file, once found or created. */
let fileId: string | null = null;
let savedOpen: number | null = null;
/** Saves run one after another, so the file is only created once. */
let queue: Promise<void> = Promise.resolve();

const openCount = (notes: Note[]) => notes.filter((n) => !n.done).length;

export async function loadNotes(): Promise<Note[]> {
  await queue; // read back what was just saved
  const files = await findByProperty("role", "notes");
  const file = files.sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? ""))[0];
  fileId = file?.id ?? null;
  savedOpen = file ? Number(file.appProperties?.open ?? 0) : null;
  if (!file) return [];
  const text = await readText(file.id);
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    const list: unknown[] = Array.isArray(parsed?.notes) ? parsed.notes : [];
    return list
      .filter((n): n is Note => typeof n === "object" && n !== null && typeof (n as Note).text === "string")
      .map((n) => ({
        id: typeof n.id === "string" ? n.id : crypto.randomUUID(),
        text: n.text,
        done: !!n.done,
        createdTime: typeof n.createdTime === "string" ? n.createdTime : "",
      }));
  } catch {
    throw new Error(`Couldn't read your notes (${FILE_NAME} in Google Drive isn't valid).`);
  }
}

export function saveNotes(rootId: string, notes: Note[]): Promise<void> {
  const run = queue.then(async () => {
    const body = JSON.stringify({ version: 1, notes }, null, 2);
    const open = openCount(notes);
    if (!fileId) {
      const f = await createFile(
        { name: FILE_NAME, mimeType: MIME, parents: [rootId], appProperties: { role: "notes", open: String(open) } },
        body,
      );
      fileId = f.id;
    } else {
      await updateContent(fileId, body, MIME);
      if (open !== savedOpen) await updateMetadata(fileId, { appProperties: { open: String(open) } });
    }
    savedOpen = open;
  });
  queue = run.catch(() => {});
  return run;
}
