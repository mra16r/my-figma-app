import { useCallback, useEffect, useRef, useState } from "react";
import BoardView, { type BoardInfo } from "./components/board/BoardView";
import HomeScreen from "./components/HomeScreen";
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
import { goToFolder, useRoute } from "./router";
import { listBoardImages, loadBoard, type BoardContent, type BoardImage } from "./storage/boards";
import { getBoardInfo, loadLibrary, pathTo, type Library } from "./storage/library";

type Session =
  | { kind: "starting" }
  | { kind: "signedOut"; error?: string }
  | { kind: "signedIn"; email: string }
  | { kind: "failed"; error: string };

const LAST_CONTAINER_KEY = "mfa.lastContainer";
const EXPIRED_MESSAGE = "Your sign-in expired. Sign in again to continue.";
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function readLastContainer(): string | null {
  try {
    return localStorage.getItem(LAST_CONTAINER_KEY);
  } catch {
    return null;
  }
}

export default function App() {
  const route = useRoute();
  const [session, setSession] = useState<Session>({ kind: "starting" });
  const [gisLoaded, setGisLoaded] = useState(isGoogleSignInLoaded());
  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const started = useRef(false);

  const onAuthExpired = useCallback(() => setSession({ kind: "signedOut", error: EXPIRED_MESSAGE }), []);

  const refresh = useCallback(async () => {
    try {
      setLibrary(await loadLibrary());
      setLibraryError(null);
    } catch (err) {
      if (err instanceof AuthExpiredError) onAuthExpired();
      else setLibraryError(message(err));
    }
  }, [onAuthExpired]);

  const startSession = useCallback(async () => {
    try {
      const user = await getUser();
      rememberEmail(user.emailAddress);
      setSession({ kind: "signedIn", email: user.emailAddress });
      await refresh();
    } catch (err) {
      if (err instanceof AuthExpiredError) setSession({ kind: "signedOut" });
      else setSession({ kind: "failed", error: message(err) });
    }
  }, [refresh]);

  useEffect(() => {
    if (started.current) return; // React dev mode runs effects twice
    started.current = true;
    loadGoogleSignIn()
      .then(() => setGisLoaded(true))
      .catch((err) => setSession({ kind: "signedOut", error: message(err) }));
    if (getValidToken()) void startSession();
    else setSession({ kind: "signedOut" });
  }, [startSession]);

  // Coming back from a board: reload so names, dates and previews are fresh.
  const lastRouteKind = useRef(route.kind);
  useEffect(() => {
    if (lastRouteKind.current === "board" && route.kind === "home" && session.kind === "signedIn") {
      void refresh();
    }
    lastRouteKind.current = route.kind;
  }, [route.kind, session.kind, refresh]);

  // Called straight from the button click so the Google popup isn't blocked.
  const handleSignIn = () => {
    requestAccessToken()
      .then(startSession)
      .catch((err) => setSession({ kind: "signedOut", error: message(err) }));
  };

  const handleSignOut = () => {
    signOut();
    setLibrary(null);
    setSession({ kind: "signedOut" });
  };

  if (session.kind === "starting") return null;
  if (session.kind === "signedOut") {
    return <SignInScreen ready={gisLoaded} error={session.error} onSignIn={handleSignIn} />;
  }
  if (session.kind === "failed") {
    return <ErrorCard title="Couldn't connect to Google Drive" error={session.error} onRetry={startSession} onSignOut={handleSignOut} />;
  }
  if (!library) {
    return libraryError ? (
      <ErrorCard title="Couldn't load your boards" error={libraryError} onRetry={refresh} onSignOut={handleSignOut} />
    ) : (
      <Loading text="Opening your boards…" />
    );
  }

  if (route.kind === "board") {
    return (
      <BoardPage
        key={route.boardId}
        boardId={route.boardId}
        library={library}
        email={session.email}
        onSignOut={handleSignOut}
        onAuthExpired={onAuthExpired}
      />
    );
  }

  // Pick the folder to show: the one in the URL, else the last one used, else the first workspace.
  const isContainer = (id: string | null | undefined) => {
    const node = id ? library.nodes.get(id) : undefined;
    return !!node && node.kind !== "board";
  };
  const fromUrl = route.kind === "home" ? route.containerId : undefined;
  const containerId = [fromUrl, readLastContainer()].find(isContainer) ?? library.workspaces[0].id;
  try {
    localStorage.setItem(LAST_CONTAINER_KEY, containerId);
  } catch {
    /* storage unavailable */
  }

  return (
    <HomeScreen
      library={library}
      containerId={containerId}
      section={route.kind === "trash" ? "trash" : "folder"}
      email={session.email}
      onRefresh={refresh}
      onSignOut={handleSignOut}
      onAuthExpired={onAuthExpired}
    />
  );
}

function BoardPage({
  boardId,
  library,
  email,
  onSignOut,
  onAuthExpired,
}: {
  boardId: string;
  library: Library;
  email: string;
  onSignOut: () => void;
  onAuthExpired: () => void;
}) {
  type State =
    | { kind: "loading" }
    | { kind: "ready"; board: BoardInfo; data: BoardContent; images: BoardImage[] }
    | { kind: "failed"; error: string };
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [board, data, images] = await Promise.all([
          getBoardInfo(boardId),
          loadBoard(boardId),
          listBoardImages(boardId),
        ]);
        if (alive) setState({ kind: "ready", board, data, images });
      } catch (err) {
        if (!alive) return;
        if (err instanceof AuthExpiredError) onAuthExpired();
        else setState({ kind: "failed", error: message(err) });
      }
    })();
    return () => {
      alive = false;
    };
    // Load once per board; library updates shouldn't reload the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const backToFolder = (parentId: string | null) => {
    if (parentId && library.nodes.has(parentId)) goToFolder(parentId);
    else window.location.hash = "#/";
  };

  if (state.kind === "loading") return <Loading text="Opening board…" />;
  if (state.kind === "failed") {
    return (
      <div className="screen">
        <div className="card">
          <h1>Couldn't open this board</h1>
          <p className="error">{state.error}</p>
          <button type="button" className="primary" onClick={() => backToFolder(null)}>
            Back to boards
          </button>
        </div>
      </div>
    );
  }
  const location = state.board.parentId
    ? pathTo(library, state.board.parentId)
        .map((n) => n.name)
        .join(" / ")
    : "";
  return (
    <BoardView
      board={state.board}
      location={location}
      hasThumbnail={library.thumbs.has(boardId)}
      content={state.data}
      images={state.images}
      email={email}
      onBack={() => backToFolder(state.board.parentId)}
      onSignOut={onSignOut}
    />
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="screen">
      <p className="muted">{text}</p>
    </div>
  );
}

function ErrorCard({
  title,
  error,
  onRetry,
  onSignOut,
}: {
  title: string;
  error: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="screen">
      <div className="card">
        <h1>{title}</h1>
        <p className="error">{error}</p>
        <button type="button" className="primary" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="link" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
