import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Excalidraw's own styles first, then ours so they can override.
import "@excalidraw/excalidraw/index.css";
import "./index.css";

async function start() {
  // Local testing only: ?mock swaps Google Drive for an in-browser fake.
  // import.meta.env.DEV is false in the live build, so this code is left out.
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    if (params.has("mock")) {
      const { installMockDrive } = await import("./dev/mockDrive");
      installMockDrive(params.has("reset"));
    }
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
