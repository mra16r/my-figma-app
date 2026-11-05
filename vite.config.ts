import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The site is served from https://mra16r.github.io/my-figma-app/,
// so every asset URL must start with /my-figma-app/.
export default defineConfig({
  base: "/my-figma-app/",
  plugins: [react()],
  // Excalidraw is one big library; large chunks are expected.
  build: { chunkSizeWarningLimit: 2500 },
  server: {
    // Port 5173 is the localhost origin registered in Google Cloud.
    port: 5173,
    strictPort: true,
  },
});
