# My Figma App

A personal FigJam-style whiteboard. It runs entirely in the browser, has no server, and is hosted on GitHub Pages.

**Live:** https://mra16r.github.io/my-figma-app/

## Status

| # | Phase | State |
|---|---|---|
| 1 | Blank board online (Excalidraw canvas, clean style) | ✅ |
| 2 | Google sign-in + saving to Drive | ⏳ |
| 3 | Home screen: workspaces → folders → boards | ⏳ |
| 4 | Images stored as separate Drive files | ⏳ |
| 5 | Polish: sticky notes, saved indicator, local cache | ⏳ |

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173/my-figma-app/

## Deploy

Every push to `main` builds the app and publishes it to GitHub Pages (`.github/workflows/deploy.yml`).
