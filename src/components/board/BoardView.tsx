import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  getNonDeletedElements,
  getSceneVersion,
  restoreElements,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";
import { msUntilExpiry, onTokenRenewed, requestAccessToken } from "../../google/auth";
import { AuthExpiredError } from "../../google/drive";
import {
  downloadImage,
  newPageId,
  removeThumbnail,
  saveBoard,
  saveThumbnail,
  serializeBoard,
  trashUnusedImages,
  uploadImage,
  type BoardContent,
  type BoardImage,
  type Page,
} from "../../storage/boards";
import { renameNode } from "../../storage/library";
import { useAutoStyles } from "./autoStyle";
import { CanvasOverlay, STICKY_SIZE, useArrowCursor, useDotGrid } from "./CanvasFeel";
import "./clipboard"; // copy gives the real text
import "./imageDrop"; // dropping several images places them all
import { SectionLayer, withSectionBackgrounds } from "./SectionLayer";
import { FilePanel, type PageMeta } from "./FilePanel";
import { download, ImageInfo, useStampNewImages } from "./imageInfo";
import type { MenuEntry } from "./Menu";
import { SelectionToolbar } from "./SelectionToolbar";
import { INTER_FONT } from "./textLayout";
import { makeTriangle, selectShape } from "./shapes";
import { selectTool, Toolbar } from "./Toolbar";
import { getToolStyles, useToolStyles } from "./toolStyles";
import { Tooltips } from "./Tooltips";
import { TopRightBar, type SaveStatus } from "./TopRightBar";
import { useSmoothWheelZoom } from "./smoothZoom";
import { ZoomControls, zoomBy, zoomTo, zoomToFit } from "./ZoomControls";
import { setThemeChoice, THEME_CHOICES, useTheme } from "../../theme";
import { setInkLookup } from "./darkInk";
import "./board.css";

export type BoardInfo = { id: string; name: string; parentId: string | null; modifiedTime: string };

type Props = {
  board: BoardInfo;
  /** "Workspace / Folder", shown under the board name. */
  location: string;
  hasThumbnail: boolean;
  content: BoardContent;
  /** Images of this board already stored in Drive. */
  images: BoardImage[];
  email: string;
  onBack: () => void;
  onSignOut: () => void;
};

// Clean defaults for new items (everything can be changed per item).
const DEFAULT_STYLE: Partial<AppState> = {
  viewBackgroundColor: "transparent", // the dot grid shows through
  currentItemRoughness: 0,
  currentItemFontFamily: INTER_FONT as AppState["currentItemFontFamily"], // FigJam's font
  currentItemFontSize: 16,
  currentItemStrokeColor: "#1e1e1e",
  currentItemBackgroundColor: "#ffffff", // filled, so a click anywhere inside selects it
  currentItemFillStyle: "solid",
  currentItemStrokeWidth: 4,
  currentItemRoundness: "round",
  currentItemArrowType: "elbow",
  // Sections: names as pills (styled in CSS), fill and outline drawn by SectionLayer, no clipping.
  frameRendering: { enabled: true, name: true, outline: false, clip: false },
  // Alignment guides and snapping when moving, sizing and drawing, like FigJam
  // (hold Ctrl to place freely; Alt+S turns it off until the board is opened again).
  objectsSnapModeEnabled: true,
};

/** Text typed into a sticky note starts at Medium (the patched Excalidraw asks for it). */
const STICKY_TEXT_SIZE = 24;
(globalThis as unknown as { __mfaLabelSize?: (container: ExcalidrawElement) => number | undefined }).__mfaLabelSize = (
  container,
) => (container.customData?.kind === "sticky" ? STICKY_TEXT_SIZE : undefined);

const SAVE_DELAY_MS = 1000;
const RETRY_DELAY_MS = 10_000;
const THUMB_INTERVAL_MS = 20_000;
const THUMB_WAIT_ON_LEAVE_MS = 4000;
const IMAGE_DOWNLOADS_AT_ONCE = 4;

type View = { scrollX: number; scrollY: number; zoom: number };

/** Excalidraw file ids used by image shapes. */
function usedImageIds(pages: Iterable<readonly ExcalidrawElement[]>): Set<string> {
  const ids = new Set<string>();
  for (const elements of pages)
    for (const el of elements) if (el.type === "image" && !el.isDeleted && el.fileId) ids.add(el.fileId);
  return ids;
}

/** Runs one of Excalidraw's keyboard actions (they handle bindings, order…). */
function press(init: KeyboardEventInit) {
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}
const CTRL = { ctrlKey: true, metaKey: true };

const pageKey = (boardId: string) => `mfa.page.${boardId}`;

export default function BoardView({ board, location, hasThumbnail, content, images, email, onBack, onSignOut }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [pageEl, setPageEl] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [errorText, setErrorText] = useState("");
  const [name, setName] = useState(board.name);
  const [renameSignal, setRenameSignal] = useState(0);
  const [imagesLeft, setImagesLeft] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const { choice: themeChoice, theme } = useTheme();

  // ---- Pages ----
  const [pages, setPages] = useState<PageMeta[]>(() => content.pages.map(({ id, name }) => ({ id, name })));
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  /** Shapes of the pages that aren't on screen. */
  const stored = useRef(new Map(content.pages.map((p) => [p.id, p.elements])));
  const [currentPage, setCurrentPage] = useState(() => {
    try {
      const last = localStorage.getItem(pageKey(board.id));
      if (last && content.pages.some((p) => p.id === last)) return last;
    } catch {
      /* storage unavailable */
    }
    return content.pages[0].id;
  });
  const currentPageRef = useRef(currentPage);
  const views = useRef(new Map<string, View>());
  const pagesVersion = useRef(0);

  // ---- Saving state ----
  const latest = useRef<{ elements: readonly ExcalidrawElement[]; appState: AppState; files: BinaryFiles } | null>(null);
  const currentSig = useRef<string | null>(null);
  const savedSig = useRef<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const expired = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // ---- Images & thumbnail ----
  const driveImages = useRef(new Map(images.map((i) => [i.fileId, i.driveId])));
  const fromDrive = useRef(new Set<string>());
  const imagesReady = useRef(false);
  const hasInlineImages = useRef(Object.keys(content.files ?? {}).length > 0);
  const thumbDirty = useRef(!hasThumbnail);
  const thumbAt = useRef(0);
  const thumbInflight = useRef<Promise<void> | null>(null);
  /** When each image in Drive was uploaded (for images added before they were dated). */
  const driveTimes = useMemo(() => new Map(images.map((i) => [i.fileId, Date.parse(i.createdTime) || 0])), [images]);

  const initialData = useMemo<ExcalidrawInitialDataState>(
    () => ({
      elements: stored.current.get(currentPageRef.current) ?? [],
      appState: { ...content.appState, ...DEFAULT_STYLE },
      files: content.files,
      scrollToContent: true,
    }),
    [content],
  );

  useEffect(() => {
    document.title = `${name} – My Figma App`;
  }, [name]);

  /** All pages with up-to-date shapes (the visible page comes from the canvas). */
  const allPages = useCallback((): Page[] => {
    const visible = latest.current?.elements ?? stored.current.get(currentPageRef.current) ?? [];
    return pagesRef.current.map((p) => ({
      ...p,
      elements: p.id === currentPageRef.current ? visible : (stored.current.get(p.id) ?? []),
    }));
  }, []);

  const markChanged = useCallback(() => {
    pagesVersion.current++;
    thumbDirty.current = true;
    // Picked up by the next onChange; nudge a save in case the canvas is idle.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => saveRef.current(), SAVE_DELAY_MS);
    currentSig.current = `${currentSig.current}|p${pagesVersion.current}`;
    setStatus((s) => (s === "saving" || s === "expired" ? s : "unsaved"));
  }, []);

  // ---- Thumbnail (first page, for the home screen) ----
  const updateThumbnail = useCallback(
    async (force: boolean) => {
      if (thumbInflight.current) await thumbInflight.current;
      if (!latest.current || !thumbDirty.current || !imagesReady.current) return;
      if (!force && Date.now() - thumbAt.current < THUMB_INTERVAL_MS) return;
      const { appState, files } = latest.current;
      const cover = getNonDeletedElements(allPages()[0]?.elements ?? []);
      thumbDirty.current = false;
      thumbAt.current = Date.now();
      const job = (async () => {
        try {
          if (cover.length === 0) {
            await removeThumbnail(board.id);
            return;
          }
          const png = await exportToBlob({
            elements: withSectionBackgrounds(cover),
            appState: { ...appState, exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
            files,
            mimeType: "image/png",
            maxWidthOrHeight: 480,
            exportPadding: 24,
          });
          await saveThumbnail(board.id, png);
        } catch (err) {
          thumbDirty.current = true;
          console.warn("Could not update thumbnail", err);
        } finally {
          thumbInflight.current = null;
        }
      })();
      thumbInflight.current = job;
      await job;
    },
    [board.id, allPages],
  );

  // ---- Saving to Drive ----
  const save = useCallback((): Promise<void> => {
    window.clearTimeout(timer.current);
    if (inflight.current) return inflight.current;
    if (expired.current || !latest.current) return Promise.resolve();
    const sig = currentSig.current;
    if (sig === savedSig.current) {
      setStatus("saved");
      return Promise.resolve();
    }
    setStatus("saving");
    const { appState, files } = latest.current;
    const pagesNow = allPages();
    const job = (async () => {
      try {
        // 1. Upload new images first, so the board never points at a missing image.
        for (const page of pagesNow) {
          for (const el of page.elements) {
            if (el.type !== "image" || el.isDeleted || !el.fileId) continue;
            if (driveImages.current.has(el.fileId)) continue;
            const file = files[el.fileId];
            if (!file) continue; // still being added; a later save picks it up
            driveImages.current.set(el.fileId, await uploadImage(board.id, file));
          }
        }
        // 2. Save the board itself (all pages, no image data).
        await saveBoard(board.id, serializeBoard(pagesNow, appState));
        savedSig.current = sig;
        hasInlineImages.current = false;
        setErrorText("");
      } catch (err) {
        if (err instanceof AuthExpiredError) {
          expired.current = true;
          setStatus("expired");
        } else {
          setErrorText(err instanceof Error ? err.message : String(err));
          setStatus("error");
          timer.current = window.setTimeout(() => saveRef.current(), RETRY_DELAY_MS);
        }
        return;
      } finally {
        inflight.current = null;
      }
      void updateThumbnail(false);
      if (currentSig.current !== savedSig.current) {
        setStatus("unsaved");
        timer.current = window.setTimeout(() => saveRef.current(), SAVE_DELAY_MS);
      } else {
        setStatus("saved");
      }
    })();
    inflight.current = job;
    return job;
  }, [board.id, allPages, updateThumbnail]);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    if (!expired.current && currentSig.current !== savedSig.current) await save();
  }, [save]);

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      latest.current = { elements, appState, files };
      let newFiles = 0;
      for (const id in files) if (!fromDrive.current.has(id)) newFiles++;
      const sig = `${currentPageRef.current}|${getSceneVersion(elements)}|${newFiles}|p${pagesVersion.current}`;
      if (savedSig.current === null) {
        currentSig.current = sig;
        if (!hasInlineImages.current) {
          savedSig.current = sig;
          return;
        }
        savedSig.current = "move-inline-images"; // old board: save once to move images out
        timer.current = window.setTimeout(() => saveRef.current(), SAVE_DELAY_MS);
        return;
      }
      if (sig === currentSig.current) return;
      currentSig.current = sig;
      thumbDirty.current = true;
      if (expired.current) return;
      setStatus((s) => (s === "saving" ? s : "unsaved"));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => saveRef.current(), SAVE_DELAY_MS);
    },
    [],
  );

  // A new Google token (renewed on a click, or "Reconnect"): carry on saving.
  const [tokenVersion, setTokenVersion] = useState(0);
  useEffect(
    () =>
      onTokenRenewed(() => {
        setTokenVersion((v) => v + 1);
        if (!expired.current) return;
        expired.current = false;
        setErrorText("");
        if (currentSig.current !== savedSig.current) void saveRef.current();
        else setStatus("saved");
      }),
    [],
  );

  // Show "Reconnect" if the Google sign-in runs out before it could be renewed.
  useEffect(() => {
    const id = window.setTimeout(() => {
      expired.current = true;
      setStatus("expired");
    }, msUntilExpiry());
    return () => window.clearTimeout(id);
  }, [status === "expired", tokenVersion]);

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void saveRef.current();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (currentSig.current !== savedSig.current) e.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  useEffect(() => () => void flush().then(() => updateThumbnail(true)), [flush, updateThumbnail]);

  // ---- Images from Drive ----
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const used = usedImageIds(stored.current.values());
    const queue = images.filter((i) => used.has(i.fileId) && !content.files?.[i.fileId]);
    let left = queue.length;
    setImagesLeft(left);
    const worker = async () => {
      for (let image = queue.shift(); image && alive; image = queue.shift()) {
        try {
          const file = await downloadImage(image);
          if (!alive) return;
          fromDrive.current.add(image.fileId);
          api.addFiles([file]);
        } catch (err) {
          if (err instanceof AuthExpiredError) {
            expired.current = true;
            setStatus("expired");
          }
          console.warn("Could not load image", image.fileId, err);
        }
        setImagesLeft(--left);
      }
    };
    void Promise.all(Array.from({ length: IMAGE_DOWNLOADS_AT_ONCE }, worker)).then(() => {
      if (alive) imagesReady.current = true;
    });
    void trashUnusedImages(images, used, board.modifiedTime).catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, images, content, board.modifiedTime]);

  // ---- Page actions ----
  const switchPage = useCallback(
    (id: string) => {
      if (!api || id === currentPageRef.current) return;
      const s = api.getAppState();
      stored.current.set(currentPageRef.current, getNonDeletedElements(api.getSceneElementsIncludingDeleted()));
      views.current.set(currentPageRef.current, { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value });
      currentPageRef.current = id;
      setCurrentPage(id);
      const view = views.current.get(id);
      const elements = restoreElements(stored.current.get(id) ?? [], null);
      if (view) {
        api.updateScene({
          elements,
          appState: {
            selectedElementIds: {},
            scrollX: view.scrollX,
            scrollY: view.scrollY,
            zoom: { value: view.zoom as NormalizedZoomValue },
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      } else {
        api.updateScene({ elements, appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
      }
      api.history.clear();
      if (!view) requestAnimationFrame(() => api.scrollToContent(undefined, { fitToContent: false }));
      try {
        localStorage.setItem(pageKey(board.id), id);
      } catch {
        /* storage unavailable */
      }
    },
    [api, board.id],
  );

  const addPage = () => {
    const id = newPageId();
    const used = new Set(pagesRef.current.map((p) => p.name));
    let n = pagesRef.current.length + 1;
    while (used.has(`Page ${n}`)) n++;
    stored.current.set(id, []);
    const next = [...pagesRef.current, { id, name: `Page ${n}` }];
    pagesRef.current = next;
    setPages(next);
    markChanged();
    switchPage(id);
  };

  const renamePage = (id: string, pageName: string) => {
    const next = pagesRef.current.map((p) => (p.id === id ? { ...p, name: pageName } : p));
    pagesRef.current = next;
    setPages(next);
    markChanged();
  };

  const deletePage = (id: string) => {
    if (pagesRef.current.length <= 1) return;
    const index = pagesRef.current.findIndex((p) => p.id === id);
    const hasContent = (id === currentPageRef.current ? (api?.getSceneElements() ?? []) : (stored.current.get(id) ?? [])).length > 0;
    if (hasContent && !window.confirm(`Delete "${pagesRef.current[index].name}" and everything on it?`)) return;
    if (id === currentPageRef.current) {
      const neighbor = pagesRef.current[index + 1] ?? pagesRef.current[index - 1];
      switchPage(neighbor.id);
    }
    stored.current.delete(id);
    views.current.delete(id);
    const next = pagesRef.current.filter((p) => p.id !== id);
    pagesRef.current = next;
    setPages(next);
    markChanged();
  };

  const renameBoard = async (newName: string) => {
    const previous = name;
    setName(newName);
    try {
      await renameNode({ id: board.id, kind: "board" }, newName);
    } catch (err) {
      setName(previous);
      if (err instanceof AuthExpiredError) {
        expired.current = true;
        setStatus("expired");
      } else {
        setErrorText(err instanceof Error ? err.message : String(err));
      }
    }
  };

  // ---- Leaving, exporting, signing out ----
  const [leaving, setLeaving] = useState(false);
  const goBack = async () => {
    if (leaving) return;
    setLeaving(true);
    await flush();
    if (currentSig.current !== savedSig.current && !window.confirm("Some changes aren't saved to Google Drive yet. Leave anyway?")) {
      setLeaving(false);
      return;
    }
    await Promise.race([updateThumbnail(true), new Promise((r) => setTimeout(r, THUMB_WAIT_ON_LEAVE_MS))]);
    onBack();
  };

  const signOut = async () => {
    await flush();
    onSignOut();
  };

  // (The new token resumes saving, see onTokenRenewed above.)
  const reconnect = () => {
    requestAccessToken().catch((err) => setErrorText(err instanceof Error ? err.message : String(err)));
  };

  const pageName = pages.find((p) => p.id === currentPage)?.name ?? "Page";
  const exportPage = async (type: "png" | "svg") => {
    if (!api) return;
    const onPage = api.getSceneElements();
    if (onPage.length === 0) {
      api.setToast({ message: "This page is empty.", duration: 2000 });
      return;
    }
    const elements = withSectionBackgrounds(onPage);
    const appState = { ...api.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false };
    const filename = `${name} - ${pageName}.${type}`;
    if (type === "png") {
      const blob = await exportToBlob({
        elements,
        appState,
        files: api.getFiles(),
        mimeType: "image/png",
        exportPadding: 32,
        getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }),
      });
      download(blob, filename);
    } else {
      const svgEl = await exportToSvg({ elements, appState, files: api.getFiles(), exportPadding: 32 });
      download(new Blob([svgEl.outerHTML], { type: "image/svg+xml" }), filename);
    }
  };

  const fileMenu: MenuEntry[] = [
    { label: "Rename", onSelect: () => setRenameSignal((n) => n + 1) },
    { label: "Add page", onSelect: addPage },
    { separator: true },
    { label: "Export page as PNG", onSelect: () => void exportPage("png") },
    { label: "Export page as SVG", onSelect: () => void exportPage("svg") },
  ];

  const mainMenu: MenuEntry[] = [
    { label: "Back to files", onSelect: goBack },
    { separator: true },
    { label: "File", submenu: fileMenu },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", shortcut: "Ctrl+Z", onSelect: () => press({ key: "z", code: "KeyZ", ...CTRL }) },
        { label: "Redo", shortcut: "Ctrl+Shift+Z", onSelect: () => press({ key: "Z", code: "KeyZ", shiftKey: true, ...CTRL }) },
        { separator: true },
        { label: "Duplicate", shortcut: "Ctrl+D", onSelect: () => press({ key: "d", code: "KeyD", ...CTRL }) },
        { label: "Delete", shortcut: "Del", onSelect: () => press({ key: "Delete", code: "Delete" }) },
        { separator: true },
        { label: "Select all", shortcut: "Ctrl+A", onSelect: () => press({ key: "a", code: "KeyA", ...CTRL }) },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Zoom in", shortcut: "Ctrl++", onSelect: () => api && zoomBy(api, 1.25) },
        { label: "Zoom out", shortcut: "Ctrl+−", onSelect: () => api && zoomBy(api, 1 / 1.25) },
        { separator: true },
        { label: "Zoom to fit", shortcut: "Shift+1", onSelect: () => api && zoomToFit(api) },
        { label: "Zoom to 50%", onSelect: () => api && zoomTo(api, 0.5) },
        { label: "Zoom to 100%", shortcut: "Shift+0", onSelect: () => api && zoomTo(api, 1) },
        { label: "Zoom to 200%", onSelect: () => api && zoomTo(api, 2) },
      ],
    },
    {
      label: "Arrange",
      submenu: [
        { label: "Bring to front", shortcut: "Ctrl+Shift+]", onSelect: () => press({ key: "]", code: "BracketRight", shiftKey: true, ...CTRL }) },
        { label: "Bring forward", shortcut: "Ctrl+]", onSelect: () => press({ key: "]", code: "BracketRight", ...CTRL }) },
        { label: "Send backward", shortcut: "Ctrl+[", onSelect: () => press({ key: "[", code: "BracketLeft", ...CTRL }) },
        { label: "Send to back", shortcut: "Ctrl+Shift+[", onSelect: () => press({ key: "[", code: "BracketLeft", shiftKey: true, ...CTRL }) },
      ],
    },
    { separator: true },
    {
      label: "Preferences",
      submenu: [
        {
          label: "Theme",
          submenu: THEME_CHOICES.map((c) => ({
            label: c.label,
            checked: themeChoice === c.value,
            onSelect: () => setThemeChoice(c.value),
          })),
        },
      ],
    },
    { separator: true },
    {
      label: "Help and account",
      submenu: [
        { label: "Keyboard shortcuts", shortcut: "?", onSelect: () => setShowHelp(true) },
        { separator: true },
        { label: "Sign out", onSelect: signOut },
      ],
    },
  ];

  // ---- Sticky notes ----
  const { stickyColor } = useToolStyles();
  useEffect(() => {
    if (!api || !pageEl) return;
    return api.onPointerDown((tool, state) => {
      if (tool.type !== "custom" || tool.customType !== "sticky") return;
      const { x, y } = state.origin;
      const [sticky] = convertToExcalidrawElements([
        {
          type: "rectangle",
          x: x - STICKY_SIZE / 2,
          y: y - STICKY_SIZE / 2,
          width: STICKY_SIZE,
          height: STICKY_SIZE,
          backgroundColor: getToolStyles().stickyColor,
          fillStyle: "solid",
          strokeColor: "transparent",
          strokeWidth: 1,
          roughness: 0,
          roundness: null,
          // topLeft: its text sits at the top left, like FigJam (see autoStyle).
          customData: { kind: "sticky", topLeft: true },
        },
      ]);
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), sticky],
        appState: { selectedElementIds: { [sticky.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      selectTool(api, "selection");
      // Start typing right away, like a real sticky note.
      setTimeout(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })), 30);
    });
  }, [api, pageEl]);

  // ---- Triangles (drag to size, or click for a default one) ----
  useEffect(() => {
    if (!api) return;
    return api.onPointerUp((tool, state, event) => {
      if (tool.type !== "custom" || (tool.customType !== "triangle" && tool.customType !== "triangle-down")) return;
      const o = state.origin;
      const end = viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, api.getAppState());
      let box = { x: Math.min(o.x, end.x), y: Math.min(o.y, end.y), width: Math.abs(end.x - o.x), height: Math.abs(end.y - o.y) };
      if (box.width < 6 && box.height < 6) box = { x: o.x - 60, y: o.y - 52, width: 120, height: 104 };
      if (event.shiftKey) box.height = box.width = Math.max(box.width, box.height);
      const triangle = makeTriangle(api, tool.customType, box);
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), triangle],
        appState: { selectedElementIds: { [triangle.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      selectTool(api, "selection");
    });
  }, [api]);

  // ---- Extra shortcuts (on top of Excalidraw's own) ----
  useEffect(() => {
    if (!api) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null; // can be the page itself
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (api.getAppState().editingTextElement) return;
      // Ctrl+= / Ctrl+− (and Excalidraw's Shift+= / Shift+−) glide like the zoom buttons.
      const zoomStep =
        e.code === "Equal" || e.code === "NumpadAdd" ? 1.25 : e.code === "Minus" || e.code === "NumpadSubtract" ? 1 / 1.25 : 0;
      if (zoomStep && (e.ctrlKey || e.metaKey || e.shiftKey) && !e.altKey) {
        zoomBy(api, zoomStep);
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      let handled = true;
      if (key === "s" && !e.shiftKey) selectTool(api, "sticky");
      else if (key === "s" && e.shiftKey) selectTool(api, "frame");
      else if (key === "x" && !e.shiftKey) selectShape(api, "elbow");
      else if (e.key === "?") setShowHelp(true);
      else if (e.key === ")" || (e.shiftKey && e.code === "Digit0")) zoomTo(api, 1);
      else if (e.shiftKey && e.code === "Digit1") zoomToFit(api);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [api]);

  useArrowCursor(api ? pageEl : null); // once the canvas exists
  useDotGrid(api, pageEl);
  useAutoStyles(api);
  useStampNewImages(api, () => stored.current.values());
  useSmoothWheelZoom(api, pageEl);

  // Dark mode colors: text needs to know whether its shape is a sticky note.
  useEffect(() => {
    if (!api) return;
    let seen: readonly ExcalidrawElement[] | null = null;
    let byId = new Map<string, ExcalidrawElement>();
    setInkLookup((id) => {
      const all = api.getSceneElements();
      if (all !== seen) {
        seen = all;
        byId = new Map(all.map((el) => [el.id, el]));
      }
      return byId.get(id);
    });
    return () => setInkLookup(null);
  }, [api]);

  // Local testing only (left out of the live build): lets test scripts drive the canvas.
  useEffect(() => {
    if (import.meta.env.DEV && api) (window as unknown as { __board?: unknown }).__board = api;
  }, [api]);

  return (
    <div className="fx-board" ref={setPageEl}>
      {api && <SectionLayer api={api} />}
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={setApi}
        onChange={onChange}
        name={name}
        theme={theme}
        handleKeyboardGlobally
        UIOptions={{ canvasActions: { toggleTheme: false } }}
      />

      {api && (
        <div className="fx-ui">
          <CanvasOverlay api={api} stickyColor={stickyColor} />
          <div className="fx-topleft">
            <FilePanel
              boardName={name}
              location={location}
              pages={pages}
              currentPageId={currentPage}
              mainMenu={mainMenu}
              fileMenu={fileMenu}
              renameBoardSignal={renameSignal}
              onRenameBoard={(n) => void renameBoard(n)}
              onSelectPage={switchPage}
              onAddPage={addPage}
              onRenamePage={renamePage}
              onDeletePage={deletePage}
            />
          </div>
          <div className="fx-topright-wrap">
            <TopRightBar
              status={leaving ? "saving" : status}
              errorText={errorText}
              imagesLeft={imagesLeft}
              email={email}
              onReconnect={reconnect}
              onSignOut={signOut}
            />
            <ImageInfo api={api} driveTimes={driveTimes} />
          </div>
          <div className="fx-bottom">
            <Toolbar api={api} />
          </div>
          <ZoomControls api={api} onHelp={() => setShowHelp(true)} />
          <SelectionToolbar api={api} boardName={name} />
          <Tooltips />
          {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
        </div>
      )}
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Move", "V"],
  ["Hand (or hold Space)", "H"],
  ["Marker", "P"],
  ["Eraser", "E"],
  ["Sticky note", "S"],
  ["Rectangle", "R"],
  ["Ellipse", "O"],
  ["Diamond", "D"],
  ["Connector", "X"],
  ["Line", "L"],
  ["Text", "T"],
  ["Section", "Shift+S"],
  ["Undo / Redo", "Ctrl+Z / Ctrl+Shift+Z"],
  ["Duplicate", "Ctrl+D"],
  ["Group / Ungroup", "Ctrl+G / Ctrl+Shift+G"],
  ["Bring forward / Send backward", "Ctrl+] / Ctrl+["],
  ["Zoom in / out", "Ctrl++ / Ctrl+−"],
  ["Zoom to fit", "Shift+1"],
  ["Zoom to 100%", "Shift+0"],
  ["Pan", "Scroll, or Space+drag"],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fx-dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fx-panel fx-dialog" role="dialog" aria-label="Keyboard shortcuts">
        <div className="fx-dialog-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="fx-icon-button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <dl className="fx-shortcuts">
          {SHORTCUTS.map(([label, keys]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{keys}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
