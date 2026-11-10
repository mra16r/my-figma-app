/// <reference types="google.accounts" />
import { DRIVE_SCOPE, GOOGLE_CLIENT_ID } from "../config";

// Google sign-in without a server, using Google Identity Services.
// It gives us a short-lived access token (about 1 hour) and no refresh token.
// keepSignedIn() gets a new one before it runs out: Google only gives one
// through a popup, which the browser only allows right after a click, so it
// happens on the first click once the token is close to running out (a Google
// window flashes for a moment). "Reconnect" is only needed if that fails, for
// example when the user signed out of Google.

const TOKEN_KEY = "mfa.token";
const EMAIL_KEY = "mfa.email";
const EXPIRY_MARGIN_MS = 60_000;
/** Start renewing this long before the token runs out. */
const RENEW_BEFORE_MS = 10 * 60_000;
/** Clicks here don't renew: sign-in buttons, and controls that need the click for
 * themselves (file and color pickers, typing, menus); the popup would take it. */
const NO_RENEW_TARGETS =
  'input, textarea, select, label, [contenteditable="true"], [role="toolbar"], [role="menu"], .context-menu, [data-signin], [data-gesture]';

type StoredToken = { accessToken: string; expiresAt: number };

/** Why a sign-in didn't work ("popup_failed_to_open" = blocked by the browser). */
export class SignInError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "SignInError";
  }
}

let memoryToken: StoredToken | null = null;
let gisReady: Promise<void> | null = null;
const renewedListeners = new Set<() => void>();

/** Loads Google's sign-in script once. Call early so sign-in clicks are instant. */
export function loadGoogleSignIn(): Promise<void> {
  if (gisReady) return gisReady;
  gisReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisReady = null;
      script.remove();
      reject(new Error("Could not load Google sign-in. Check your connection."));
    };
    document.head.appendChild(script);
  });
  return gisReady;
}

export function isGoogleSignInLoaded(): boolean {
  return typeof window.google !== "undefined" && !!window.google.accounts?.oauth2;
}

function readToken(): StoredToken | null {
  if (memoryToken) return memoryToken;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    memoryToken = raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

/** Returns the current token if it is still valid for at least a minute. */
export function getValidToken(): string | null {
  const token = readToken();
  if (!token || Date.now() > token.expiresAt - EXPIRY_MARGIN_MS) return null;
  return token.accessToken;
}

/** Milliseconds until the current token should be treated as expired (0 if none). */
export function msUntilExpiry(): number {
  const token = readToken();
  return token ? Math.max(0, token.expiresAt - EXPIRY_MARGIN_MS - Date.now()) : 0;
}

export function clearToken(): void {
  memoryToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
  scheduleRenewal(); // still the remembered account: get a new one on the next click
}

export function getRememberedEmail(): string | undefined {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberEmail(email: string): void {
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    /* storage unavailable */
  }
}

export function signOut(): void {
  clearToken();
  try {
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* storage unavailable */
  }
  scheduleRenewal();
}

/** Called whenever a new token arrives (signing in, renewing, reconnecting). */
export function onTokenRenewed(listener: () => void): () => void {
  renewedListeners.add(listener);
  return () => renewedListeners.delete(listener);
}

/**
 * Opens Google's sign-in popup. Must be called directly from a click handler,
 * otherwise the browser blocks the popup. `quiet`: never ask the user anything
 * (fails instead), for renewing in the background.
 */
export function requestAccessToken({ quiet = false } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isGoogleSignInLoaded()) {
      reject(new SignInError("Google sign-in is still loading. Try again in a moment.", "not_loaded"));
      return;
    }
    const email = getRememberedEmail();
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      login_hint: email,
      callback: (response) => {
        if (response.error) {
          reject(new SignInError(response.error_description || response.error, response.error));
          return;
        }
        if (!google.accounts.oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
          reject(
            new SignInError(
              "The app needs permission to its own Drive files. Sign in again and keep that box ticked.",
              "missing_scope",
            ),
          );
          return;
        }
        memoryToken = {
          accessToken: response.access_token,
          expiresAt: Date.now() + Number(response.expires_in) * 1000,
        };
        try {
          localStorage.setItem(TOKEN_KEY, JSON.stringify(memoryToken));
        } catch {
          /* storage unavailable: the in-memory token still works */
        }
        resolve(response.access_token);
        scheduleRenewal();
        renewedListeners.forEach((listener) => listener());
      },
      error_callback: (error) => {
        reject(
          new SignInError(
            error.type === "popup_closed"
              ? "The sign-in window was closed."
              : error.type === "popup_failed_to_open"
                ? "The sign-in popup was blocked. Allow popups for this site and try again."
                : "Sign-in failed.",
            error.type,
          ),
        );
      },
    });
    // "none" = no screens at all; "" = only show the consent screen the first time.
    client.requestAccessToken({ prompt: quiet ? "none" : email ? "" : "select_account" });
  });
}

// ---- Staying signed in ----

let keeping = false;
let renewTimer: number | undefined;
let armed = false;
let renewing = false;

/** Keeps the Google sign-in fresh for as long as the app is open. Call once. */
export function keepSignedIn(): void {
  if (keeping) return;
  keeping = true;
  scheduleRenewal();
}

/** Waits until the token is close to running out, then renews on the next click. */
function scheduleRenewal(): void {
  if (!keeping) return;
  window.clearTimeout(renewTimer);
  disarm();
  const token = readToken();
  // Signed out on purpose (no token, no remembered account): nothing to keep.
  if (!token && !getRememberedEmail()) return;
  const wait = token ? token.expiresAt - RENEW_BEFORE_MS - Date.now() : 0;
  if (wait > 0) renewTimer = window.setTimeout(arm, wait);
  else arm();
}

function arm(): void {
  if (armed) return;
  armed = true;
  window.addEventListener("pointerup", renewOnClick, true);
}

function disarm(): void {
  armed = false;
  window.removeEventListener("pointerup", renewOnClick, true);
}

function renewOnClick(event: PointerEvent): void {
  if (renewing || event.button !== 0) return;
  if ((event.target as Element | null)?.closest?.(NO_RENEW_TARGETS)) return;
  // The popup is only allowed right after a click (a long drag can outlast that).
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (activation && !activation.isActive) return;
  if (!isGoogleSignInLoaded()) return;
  disarm();
  renewing = true;
  requestAccessToken({ quiet: true })
    .catch((err) => {
      // Blocked anyway: try again on the next click. Anything else (signed out of
      // Google, access removed): stop; the app shows "Reconnect" once it runs out.
      if (err instanceof SignInError && err.code === "popup_failed_to_open") arm();
      else console.warn("Could not renew the Google sign-in", err);
    })
    .finally(() => {
      renewing = false;
    });
}
