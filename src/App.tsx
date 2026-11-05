import { useCallback, useEffect, useRef, useState } from "react";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import BoardView from "./components/BoardView";
import SignInScreen from "./components/SignInScreen";
import {
  getValidToken,
  isGoogleSignInLoaded,
  loadGoogleSignIn,
  rememberEmail,
  requestAccessToken,
  signOut,
} from "./google/auth";
import { AuthExpiredError, getUser } from "./google/drive";
import { ensureAppFolder, ensureDefaultBoard, loadBoard, type BoardRef } from "./storage/boards";

type View =
  | { kind: "starting" }
  | { kind: "signedOut"; error?: string }
  | { kind: "loading" }
  | { kind: "ready"; board: BoardRef; data: ExcalidrawInitialDataState; email: string }
  | { kind: "failed"; error: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function App() {
  const [view, setView] = useState<View>({ kind: "starting" });
  const [gisLoaded, setGisLoaded] = useState(isGoogleSignInLoaded());
  const started = useRef(false);

  const openBoard = useCallback(async () => {
    setView({ kind: "loading" });
    try {
      const user = await getUser();
      rememberEmail(user.emailAddress);
      const folder = await ensureAppFolder();
      const board = await ensureDefaultBoard(folder.id);
      const data = await loadBoard(board.id);
      setView({ kind: "ready", board, data, email: user.emailAddress });
    } catch (err) {
      if (err instanceof AuthExpiredError) setView({ kind: "signedOut" });
      else setView({ kind: "failed", error: message(err) });
    }
  }, []);

  useEffect(() => {
    if (started.current) return; // React dev mode runs effects twice
    started.current = true;
    loadGoogleSignIn()
      .then(() => setGisLoaded(true))
      .catch((err) => setView({ kind: "signedOut", error: message(err) }));
    if (getValidToken()) void openBoard();
    else setView({ kind: "signedOut" });
  }, [openBoard]);

  // Called straight from the button click so the Google popup isn't blocked.
  const handleSignIn = () => {
    requestAccessToken()
      .then(openBoard)
      .catch((err) => setView({ kind: "signedOut", error: message(err) }));
  };

  const handleSignOut = () => {
    signOut();
    setView({ kind: "signedOut" });
  };

  switch (view.kind) {
    case "starting":
      return null;
    case "signedOut":
      return <SignInScreen ready={gisLoaded} error={view.error} onSignIn={handleSignIn} />;
    case "loading":
      return (
        <div className="screen">
          <p className="muted">Opening your board…</p>
        </div>
      );
    case "failed":
      return (
        <div className="screen">
          <div className="card">
            <h1>Couldn't open your board</h1>
            <p className="error">{view.error}</p>
            <button type="button" className="primary" onClick={openBoard}>
              Try again
            </button>
            <button type="button" className="link" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      );
    case "ready":
      return (
        <BoardView
          key={view.board.id}
          board={view.board}
          initialData={view.data}
          email={view.email}
          onSignOut={handleSignOut}
        />
      );
  }
}
