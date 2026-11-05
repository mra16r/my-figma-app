import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Excalidraw's own styles first, then ours so they can override.
import "@excalidraw/excalidraw/index.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
