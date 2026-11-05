import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  FONT_FAMILY,
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  getNonDeletedElements,
  getSceneVersion,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";
import { msUntilExpiry, requestAccessToken } from "../../google/auth";
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
import { CanvasOverlay, STICKY_SIZE, useArrowCursor, useDotGrid } from "./CanvasFeel";
import { FilePanel, type PageMeta } from "./FilePanel";
import type { MenuEntry } from "./Menu";
import { SelectionToolbar, STICKY_COLORS } from "./SelectionToolbar";
import { selectTool, Toolbar } from "./Toolbar";
import { TopRightBar, type SaveStatus } from "./TopRightBar";
import { ZoomControls, zoomTo, zoomToFit } from "./ZoomControls";
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
  currentItemFontFamily: FONT_FAMILY["Liberation Sans"],
  currentItemFontSize: 20,
  currentItemStrokeColor: "#1e1e1e",
  currentItemBackgroundColor: "#ffffff", // filled, so a click anywhere inside selects it
  currentItemFillStyle: "solid",
  currentItemStrokeWidth: 2,
  currentItemRoundness: "round",
  currentItemArrowType: "elbow",
};

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

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, "-");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

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
            elements: cover,
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

  // Show "Reconnect" as soon as the Google sign-in runs out.
  useEffect(() => {
    const id = window.setTimeout(() => {
      expired.current = true;
      setStatus("expired");
    }, msUntilExpiry());
    return () => window.clearTimeout(id);
  }, [status === "expired"]);

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

  const reconnect = () => {
    requestAccessToken()
      .then(() => {
        expired.current = false;
        setErrorText("");
        if (currentSig.current !== savedSig.current) void saveRef.current();
        else setStatus("saved");
      })
      .catch((err) => setErrorText(err instanceof Error ? err.message : String(err)));
  };

  const pageName = pages.find((p) => p.id === currentPage)?.name ?? "Page";
  const exportPage = async (type: "png" | "svg") => {
    if (!api) return;
    const elements = api.getSceneElements();
    if (elements.length === 0) {
      api.setToast({ message: "This page is empty.", duration: 2000 });
      return;
    }
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

  const mainMenu: MenuEntry[] = [
    { label: "Back to files", onSelect: goBack },
    { separator: true },
    { label: "Rename board", onSelect: () => setRenameSignal((n) => n + 1) },
    { label: "Add page", onSelect: addPage },
    { separator: true },
    { label: "Export page as PNG", onSelect: () => void exportPage("png") },
    { label: "Export page as SVG", onSelect: () => void exportPage("svg") },
    { separator: true },
    { label: "Keyboard shortcuts", shortcut: "?", onSelect: () => setShowHelp(true) },
    { separator: true },
    { label: "Sign out", onSelect: signOut },
  ];

  // ---- Sticky notes ----
  const stickyColor = STICKY_COLORS[0].value;
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
          backgroundColor: stickyColor,
          fillStyle: "solid",
          strokeColor: "transparent",
          strokeWidth: 1,
          roughness: 0,
          roundness: null,
          customData: { kind: "sticky" },
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
  }, [api, pageEl, stickyColor]);

  // ---- Extra shortcuts (on top of Excalidraw's own) ----
  useEffect(() => {
    if (!api) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (api.getAppState().editingTextElement || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      let handled = true;
      if (key === "s" && !e.shiftKey) selectTool(api, "sticky");
      else if (key === "s" && e.shiftKey) selectTool(api, "frame");
      else if (key === "x" && !e.shiftKey) selectTool(api, "arrow");
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

  return (
    <div className="fx-board" ref={setPageEl}>
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={setApi}
        onChange={onChange}
        name={name}
        theme="light"
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
          </div>
          <div className="fx-bottom">
            <Toolbar api={api} />
          </div>
          <ZoomControls api={api} onHelp={() => setShowHelp(true)} />
          <SelectionToolbar api={api} />
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
