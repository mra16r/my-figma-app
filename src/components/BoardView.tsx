import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  FONT_FAMILY,
  MainMenu,
  WelcomeScreen,
  getSceneVersion,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawInitialDataState, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { msUntilExpiry, requestAccessToken } from "../google/auth";
import { AuthExpiredError } from "../google/drive";
import { saveBoard, type BoardRef } from "../storage/boards";

type ChangeArgs = Parameters<NonNullable<ExcalidrawProps["onChange"]>>;
type SaveStatus = "saved" | "unsaved" | "saving" | "expired" | "error";

// Clean, FigJam-like defaults instead of Excalidraw's hand-drawn look.
// Everything here can still be changed per element from the style panel.
const CLEAN_DEFAULTS = {
  currentItemRoughness: 0,
  currentItemFontFamily: FONT_FAMILY.Nunito,
  currentItemStrokeWidth: 1,
};

const SAVE_DELAY_MS = 1000;
const RETRY_DELAY_MS = 10_000;

type Props = {
  board: BoardRef;
  initialData: ExcalidrawInitialDataState;
  email: string;
  onSignOut: () => void;
};

export default function BoardView({ board, initialData, email, onSignOut }: Props) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [errorText, setErrorText] = useState("");

  const latest = useRef<ChangeArgs | null>(null);
  const currentSig = useRef<string | null>(null);
  const savedSig = useRef<string | null>(null);
  const saving = useRef(false);
  const expired = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const data = useMemo<ExcalidrawInitialDataState>(
    () => ({
      ...initialData,
      appState: { ...initialData.appState, ...CLEAN_DEFAULTS },
      scrollToContent: true,
    }),
    [initialData],
  );

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (saving.current || expired.current || !latest.current) return;
    const sig = currentSig.current;
    if (sig === savedSig.current) {
      setStatus("saved");
      return;
    }
    saving.current = true;
    setStatus("saving");
    const [elements, appState, files] = latest.current;
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
      saving.current = false;
    }
    // More edits may have happened while this save was running.
    if (currentSig.current !== savedSig.current) {
      setStatus("unsaved");
      timer.current = window.setTimeout(save, SAVE_DELAY_MS);
    } else {
      setStatus("saved");
    }
  }, [board.id]);

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
      if (expired.current) return;
      setStatus((s) => (s === "saving" ? s : "unsaved"));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(save, SAVE_DELAY_MS);
    },
    [save],
  );

  // Show "Reconnect" as soon as the Google session runs out.
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
      window.clearTimeout(timer.current);
    };
  }, [save]);

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
  );

  return (
    <Excalidraw
      initialData={data}
      onChange={onChange}
      name={board.name}
      renderTopRightUI={renderTopRightUI}
    >
      <MainMenu>
        <MainMenu.Group title={email}>
          <MainMenu.Item onSelect={onSignOut}>Sign out</MainMenu.Item>
        </MainMenu.Group>
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
      </MainMenu>
      <WelcomeScreen>
        <WelcomeScreen.Hints.MenuHint />
        <WelcomeScreen.Hints.ToolbarHint />
        <WelcomeScreen.Hints.HelpHint />
        <WelcomeScreen.Center>
          <WelcomeScreen.Center.Heading>{board.name}</WelcomeScreen.Center.Heading>
          <WelcomeScreen.Center.Menu>
            <WelcomeScreen.Center.MenuItemHelp />
          </WelcomeScreen.Center.Menu>
        </WelcomeScreen.Center>
      </WelcomeScreen>
    </Excalidraw>
  );
}
