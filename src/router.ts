import { useSyncExternalStore } from "react";

// Hash-based routes, so they work on GitHub Pages without a server:
//   #/            home (last used workspace)
//   #/f/<id>      a workspace or folder
//   #/b/<id>      a board

export type Route = { kind: "home"; containerId?: string } | { kind: "board"; boardId: string };

function parse(hash: string): Route {
  const board = hash.match(/^#\/b\/([\w-]+)/);
  if (board) return { kind: "board", boardId: board[1] };
  const folder = hash.match(/^#\/f\/([\w-]+)/);
  if (folder) return { kind: "home", containerId: folder[1] };
  return { kind: "home" };
}

let cachedHash = "";
let cachedRoute: Route = { kind: "home" };

function getRoute(): Route {
  if (window.location.hash !== cachedHash) {
    cachedHash = window.location.hash;
    cachedRoute = parse(cachedHash);
  }
  return cachedRoute;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute);
}

export function goToFolder(id: string): void {
  window.location.hash = `#/f/${id}`;
}

export function goToBoard(id: string): void {
  window.location.hash = `#/b/${id}`;
}
