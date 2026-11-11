// Dropping several images at once places them all, laid out in rows like a contact
// sheet around where they were dropped (Excalidraw on its own only takes the first
// file). Excalidraw is patched (scripts/patch-excalidraw.mjs) to call
// __mfaDropImages first when something is dropped; one image still goes through
// Excalidraw's own drop.

import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawImageElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, SceneData } from "@excalidraw/excalidraw/types";

/** The parts of Excalidraw's App the patched drop handler hands over. */
type App = {
  state: AppState;
  scene: { getElementsIncludingDeleted(): readonly ExcalidrawElement[] };
  isToolSupported(tool: "image"): boolean;
  createImageElement(at: { sceneX: number; sceneY: number }): ExcalidrawImageElement;
  /** Resolves once the image is loaded and sized (null if it couldn't be added). */
  insertImageElement(el: ExcalidrawImageElement, file: File): Promise<ExcalidrawImageElement | null | undefined>;
  initializeImageDimensions(el: ExcalidrawImageElement): void;
  /** How Excalidraw's own actions change the board. (Unlike updateScene, its undo step
   * also takes in elements added since the last one, like the images just placed.) */
  syncActionResult(result: {
    elements: readonly ExcalidrawElement[];
    appState: Partial<AppState>;
    captureUpdate: SceneData["captureUpdate"];
  }): void;
};

type Drop = { dataTransfer: DataTransfer | null; clientX: number; clientY: number };

/** The image types Excalidraw can place. */
const IMAGE_TYPES = new Set([
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/x-icon",
  "image/avif",
  "image/jfif",
]);

/** Space between the images, on screen. */
const GAP_PX = 16;
/** Excalidraw's loading placeholder, on screen. */
const PLACEHOLDER_PX = 100;
/** The dropped images never cover more than this much of the view. */
const MAX_VIEW_SHARE = 0.8;

async function placeImages(app: App, files: File[], at: { x: number; y: number }) {
  const zoom = app.state.zoom.value;
  const columns = (n: number) => Math.ceil(Math.sqrt(n));
  // While they load: placeholders in a grid around the drop point.
  const cols = columns(files.length);
  const rows = Math.ceil(files.length / cols);
  const step = (PLACEHOLDER_PX + GAP_PX) / zoom;
  const loading = files.map((file, i) => {
    const el = app.createImageElement({
      sceneX: at.x + (i % cols - (cols - 1) / 2) * step,
      sceneY: at.y + (Math.floor(i / cols) - (rows - 1) / 2) * step,
    });
    const done = app.insertImageElement(el, file);
    app.initializeImageDimensions(el);
    return done;
  });
  const placed = (await Promise.all(loading)).filter((el): el is ExcalidrawImageElement => !!el && !el.isDeleted);
  if (!placed.length) return;

  // Loaded (each at its own size): rows centered on the drop point, all shrunk
  // together if they'd take up more than most of the view.
  const gap = GAP_PX / zoom;
  const perRow = columns(placed.length);
  const grid: ExcalidrawImageElement[][] = [];
  for (let i = 0; i < placed.length; i += perRow) grid.push(placed.slice(i, i + perRow));
  const rowWidth = (row: ExcalidrawImageElement[]) => row.reduce((w, el) => w + el.width, 0) + gap * (row.length - 1);
  const rowHeight = (row: ExcalidrawImageElement[]) => Math.max(...row.map((el) => el.height));
  const width = Math.max(...grid.map(rowWidth));
  const height = grid.reduce((h, row) => h + rowHeight(row), 0) + gap * (grid.length - 1);
  const { width: viewW, height: viewH } = app.state;
  const fit = Math.min(1, (viewW * MAX_VIEW_SHARE) / zoom / width, (viewH * MAX_VIEW_SHARE) / zoom / height);

  const moves = new Map<string, Partial<ExcalidrawImageElement>>();
  let top = at.y - (height * fit) / 2;
  for (const row of grid) {
    let left = at.x - (width * fit) / 2;
    for (const el of row) {
      moves.set(el.id, { x: left, y: top, width: el.width * fit, height: el.height * fit });
      left += (el.width + gap) * fit;
    }
    top += (rowHeight(row) + gap) * fit;
  }
  app.syncActionResult({
    elements: app.scene.getElementsIncludingDeleted().map((el) => {
      const move = moves.get(el.id);
      return move ? newElementWith(el as ExcalidrawImageElement, move) : el;
    }),
    appState: { selectedElementIds: Object.fromEntries(placed.map((el) => [el.id, true as const])) },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY, // one undo step for the whole drop
  });
}

/** Takes the drop when it has two or more images (true), else leaves it to Excalidraw. */
function dropImages(event: Drop, app: App): boolean {
  // (read now: the dropped files are gone once the drop event is over)
  const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => IMAGE_TYPES.has(f.type));
  if (files.length < 2 || !app.isToolSupported("image")) return false;
  const { zoom, offsetLeft, offsetTop, scrollX, scrollY } = app.state;
  const at = {
    x: (event.clientX - offsetLeft) / zoom.value - scrollX,
    y: (event.clientY - offsetTop) / zoom.value - scrollY,
  };
  placeImages(app, files, at).catch((err) => console.error("Could not place the dropped images", err));
  return true;
}

// Hook the patched Excalidraw looks for.
(globalThis as unknown as { __mfaDropImages?: typeof dropImages }).__mfaDropImages = dropImages;
