/// <reference types="google.accounts" />
import { DRIVE_SCOPE, GOOGLE_CLIENT_ID } from "../config";

// Google sign-in without a server, using Google Identity Services.
// It gives us a short-lived access token (about 1 hour). There is no
// refresh token, so when it expires the user clicks "Reconnect".

const TOKEN_KEY = "mfa.token";
const EMAIL_KEY = "mfa.email";
const EXPIRY_MARGIN_MS = 60_000;

type StoredToken = { accessToken: string; expiresAt: number };

let memoryToken: StoredToken | null = null;
let gisReady: Promise<void> | null = null;

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
}

/**
 * Opens Google's sign-in popup. Must be called directly from a click handler,
 * otherwise the browser blocks the popup.
 */
export function requestAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isGoogleSignInLoaded()) {
      reject(new Error("Google sign-in is still loading. Try again in a moment."));
      return;
    }
    const email = getRememberedEmail();
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      login_hint: email,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        if (!google.accounts.oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
          reject(
            new Error(
              "The app needs permission to its own Drive files. Sign in again and keep that box ticked.",
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
      },
      error_callback: (error) => {
        reject(
          new Error(
            error.type === "popup_closed"
              ? "The sign-in window was closed."
              : error.type === "popup_failed_to_open"
                ? "The sign-in popup was blocked. Allow popups for this site and try again."
                : "Sign-in failed.",
          ),
        );
      },
    });
    // "" = only show the consent screen the first time.
    client.requestAccessToken({ prompt: email ? "" : "select_account" });
  });
}
