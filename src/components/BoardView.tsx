import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  FONT_FAMILY,
  MainMenu,
  WelcomeScreen,
  exportToBlob,
  getNonDeletedElements,
  getSceneVersion,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawInitialDataState, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { msUntilExpiry, requestAccessToken } from "../google/auth";
import { AuthExpiredError } from "../google/drive";
import { removeThumbnail, saveBoard, saveThumbnail } from "../storage/boards";
import { renameNode } from "../storage/library";
import { NameDialog } from "./Dialogs";
import { BackIcon } from "./icons";

type ChangeArgs = Parameters<NonNullable<ExcalidrawProps["onChange"]>>;
type SaveStatus = "saved" | "unsaved" | "saving" | "expired" | "error";

export type BoardInfo = { id: string; name: string; parentId: string | null };

// Clean, FigJam-like defaults instead of Excalidraw's hand-drawn look.
// Everything here can still be changed per element from the style panel.
const CLEAN_DEFAULTS = {
  currentItemRoughness: 0,
  currentItemFontFamily: FONT_FAMILY.Nunito,
  currentItemStrokeWidth: 1,
};

const SAVE_DELAY_MS = 1000;
const RETRY_DELAY_MS = 10_000;
const THUMB_INTERVAL_MS = 20_000;
const THUMB_WAIT_ON_LEAVE_MS = 4000;

type Props = {
  board: BoardInfo;
  hasThumbnail: boolean;
  initialData: ExcalidrawInitialDataState;
  email: string;
  onBack: () => void;
  onSignOut: () => void;
};

export default function BoardView({ board, hasThumbnail, initialData, email, onBack, onSignOut }: Props) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [errorText, setErrorText] = useState("");
  const [name, setName] = useState(board.name);
  const [renaming, setRenaming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const latest = useRef<ChangeArgs | null>(null);
  const currentSig = useRef<string | null>(null);
  const savedSig = useRef<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const expired = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const thumbDirty = useRef(!hasThumbnail);
  const thumbAt = useRef(0);
  const thumbInflight = useRef<Promise<void> | null>(null);

  const data = useMemo<ExcalidrawInitialDataState>(
    () => ({
      ...initialData,
      appState: { ...initialData.appState, ...CLEAN_DEFAULTS },
      scrollToContent: true,
    }),
    [initialData],
  );

  useEffect(() => {
    document.title = `${name} – My Figma App`;
  }, [name]);

  // ---- Thumbnail (small preview for the home screen) ----
  const updateThumbnail = useCallback(
    async (force: boolean) => {
      if (thumbInflight.current) await thumbInflight.current;
      if (!latest.current || !thumbDirty.current) return;
      if (!force && Date.now() - thumbAt.current < THUMB_INTERVAL_MS) return;
      const [elements, appState, files] = latest.current;
      thumbDirty.current = false;
      thumbAt.current = Date.now();
      const job = (async () => {
        try {
          const visible = getNonDeletedElements(elements);
          if (visible.length === 0) {
            await removeThumbnail(board.id);
            return;
          }
          const png = await exportToBlob({
            elements: visible,
            appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
            files,
            mimeType: "image/png",
            maxWidthOrHeight: 480,
            exportPadding: 24,
          });
          await saveThumbnail(board.id, png);
        } catch (err) {
          thumbDirty.current = true; // try again next time
          console.warn("Could not update thumbnail", err);
        } finally {
          thumbInflight.current = null;
        }
      })();
      thumbInflight.current = job;
      await job;
    },
    [board.id],
  );

  // ---- Saving to Drive ----
  const save = useCallback((): Promise<void> => {
    window.clearTimeout(timer.current);
    if (inflight.current) return inflight.current; // it re-checks for new edits when done
    if (expired.current || !latest.current) return Promise.resolve();
    const sig = currentSig.current;
    if (sig === savedSig.current) {
      setStatus("saved");
      return Promise.resolve();
    }
    setStatus("saving");
    const [elements, appState, files] = latest.current;
    const job = (async () => {
      try {
        await saveBoard(board.id, serializeAsJSON(elements, appState, files, "local"));
        savedSig.current = sig;
        setErrorText("");
      } catch (err) {
        if (err instanceof AuthExpiredError) {
          expired.current = true;
          setStatus("expired");
        } else {
          setErrorText(err instanceof Error ? err.message : String(err));
          setStatus("error");
          timer.current = window.setTimeout(save, RETRY_DELAY_MS);
        }
        return;
      } finally {
        inflight.current = null;
      }
      void updateThumbnail(false);
      // More edits may have happened while this save was running.
      if (currentSig.current !== savedSig.current) {
        setStatus("unsaved");
        timer.current = window.setTimeout(save, SAVE_DELAY_MS);
      } else {
        setStatus("saved");
      }
    })();
    inflight.current = job;
    return job;
  }, [board.id, updateThumbnail]);

  /** Waits until everything is saved (or saving is impossible). */
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    if (!expired.current && currentSig.current !== savedSig.current) await save();
  }, [save]);

  const onChange = useCallback<NonNullable<ExcalidrawProps["onChange"]>>(
    (elements, appState, files) => {
      latest.current = [elements, appState, files];
      const sig = `${getSceneVersion(elements)}|${Object.keys(files).length}|${appState.viewBackgroundColor}`;
      if (savedSig.current === null) {
        // First call after loading: this is what's already in Drive.
        savedSig.current = sig;
        currentSig.current = sig;
        return;
      }
      if (sig === currentSig.current) return; // only selection/scroll changed
      currentSig.current = sig;
      thumbDirty.current = true;
      if (expired.current) return;
      setStatus((s) => (s === "saving" ? s : "unsaved"));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(save, SAVE_DELAY_MS);
    },
    [save],
  );

  // Show "Reconnect" as soon as the Google sign-in runs out.
  useEffect(() => {
    const id = window.setTimeout(() => {
      expired.current = true;
      setStatus("expired");
    }, msUntilExpiry());
    return () => window.clearTimeout(id);
  }, [status === "expired"]);

  // Save right away when the tab is hidden; warn before closing with unsaved work.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void save();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (currentSig.current !== savedSig.current) e.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [save]);

  // Leaving via the browser's back button: finish saving in the background.
  useEffect(() => {
    return () => {
      void flush().then(() => updateThumbnail(true));
    };
  }, [flush, updateThumbnail]);

  const goBack = async () => {
    if (leaving) return;
    setLeaving(true);
    await flush();
    if (
      currentSig.current !== savedSig.current &&
      !window.confirm("Some changes aren't saved to Google Drive yet. Leave anyway?")
    ) {
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
        if (currentSig.current !== savedSig.current) void save();
        else setStatus("saved");
      })
      .catch((err) => {
        setErrorText(err instanceof Error ? err.message : String(err));
      });
  };

  const renderTopRightUI = () => (
    <div className="board-topright">
      <div className="save-status" data-status={status} title={errorText || undefined}>
        {status === "saved" && "Saved"}
        {status === "unsaved" && "Unsaved changes"}
        {status === "saving" && "Saving…"}
        {status === "error" && "Couldn't save, retrying"}
        {status === "expired" && (
          <>
            <span>Sign-in expired</span>
            <button type="button" onClick={reconnect}>
              Reconnect
            </button>
          </>
        )}
      </div>
      <button type="button" className="board-back" onClick={goBack} disabled={leaving} title="Back to all boards">
        <BackIcon size={16} />
        <span>{leaving ? "Saving…" : "Boards"}</span>
      </button>
    </div>
  );

  return (
    <div className="board-page">
      <Excalidraw initialData={data} onChange={onChange} name={name} renderTopRightUI={renderTopRightUI}>
        <MainMenu>
          <MainMenu.Item onSelect={goBack}>Back to all boards</MainMenu.Item>
          <MainMenu.Item onSelect={() => setRenaming(true)}>Rename board…</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveToActiveFile />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.Separator />
          <MainMenu.Group title={email}>
            <MainMenu.Item onSelect={signOut}>Sign out</MainMenu.Item>
          </MainMenu.Group>
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Hints.HelpHint />
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>{name}</WelcomeScreen.Center.Heading>
            <WelcomeScreen.Center.Menu>
              <WelcomeScreen.Center.MenuItemHelp />
            </WelcomeScreen.Center.Menu>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>

      {renaming && (
        <NameDialog
          title="Rename board"
          initial={name}
          confirmLabel="Rename"
          onClose={() => setRenaming(false)}
          onAuthExpired={() => {
            expired.current = true;
            setStatus("expired");
            setRenaming(false);
          }}
          onSubmit={async (newName) => {
            await renameNode({ id: board.id, kind: "board" }, newName);
            setName(newName);
          }}
        />
      )}
    </div>
  );
}
