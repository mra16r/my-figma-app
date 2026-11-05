// Small changes to Excalidraw 0.18.1, applied after `npm install` (also on GitHub):
//  1. More room around text inside shapes (padding 5px → 14px).
//  2. Bold text: a text element with customData.bold is drawn and measured bold.
//  3. Strikethrough: a text element with customData.strike gets a line through it.
// Each change is an exact text replacement; if Excalidraw changes, this stops
// with a clear message instead of silently doing nothing.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "node_modules", "@excalidraw", "excalidraw");
const MARK = "/*mfa-patched*/";
const EXPECTED_VERSION = "0.18.1";

const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
if (version !== EXPECTED_VERSION) {
  throw new Error(`patch-excalidraw: expected Excalidraw ${EXPECTED_VERSION}, found ${version}. Update the patches.`);
}

const STRIKE_PROD =
  "if(e.customData?.strike){let W=n.measureText(s[U]).width,X=e.textAlign===\"center\"?d-W/2:e.textAlign===\"right\"?d-W:d;n.fillRect(X,U*c+l-e.fontSize*.3,W,Math.max(1,e.fontSize/14))}";
const STRIKE_DEV =
  "if (element.customData?.strike) { const w = context.measureText(lines[index]).width; const x = element.textAlign === \"center\" ? horizontalOffset - w / 2 : element.textAlign === \"right\" ? horizontalOffset - w : horizontalOffset; context.fillRect(x, index * lineHeightPx + verticalOffset - element.fontSize * 0.3, w, Math.max(1, element.fontSize / 14)); }";

const patches = [
  {
    file: "dist/prod/chunk-K2UTITRG.js",
    edits: [
      ["excalidrawLibrary:2},Se=5,", "excalidrawLibrary:2},Se=14,"],
      [
        "Ee=({fontSize:e,fontFamily:t})=>`${e}px ${ea({fontFamily:t})}`",
        'Ee=(o)=>`${o.customData?.bold?"bold ":""}${o.fontSize}px ${ea({fontFamily:o.fontFamily})}`',
      ],
      [
        "for(let U=0;U<s.length;U++)n.fillText(s[U],d,U*c+l);n.restore()",
        `for(let U=0;U<s.length;U++){n.fillText(s[U],d,U*c+l);${STRIKE_PROD}}n.restore()`,
      ],
    ],
  },
  {
    file: "dist/dev/chunk-4FTI6OG3.js",
    edits: [
      ["var BOUND_TEXT_PADDING = 5;", "var BOUND_TEXT_PADDING = 14;"],
      [
        "var getFontString = ({\n  fontSize,\n  fontFamily\n}) => {\n  return `${fontSize}px ${getFontFamilyString({ fontFamily })}`;\n};",
        'var getFontString = (o) => {\n  return `${o.customData?.bold ? "bold " : ""}${o.fontSize}px ${getFontFamilyString({ fontFamily: o.fontFamily })}`;\n};',
      ],
      [
        "        for (let index = 0; index < lines.length; index++) {\n          context.fillText(\n            lines[index],\n            horizontalOffset,\n            index * lineHeightPx + verticalOffset\n          );\n        }",
        `        for (let index = 0; index < lines.length; index++) {\n          context.fillText(\n            lines[index],\n            horizontalOffset,\n            index * lineHeightPx + verticalOffset\n          );\n          ${STRIKE_DEV}\n        }`,
      ],
    ],
  },
];

let changed = false;
for (const { file, edits } of patches) {
  const path = join(pkgDir, file);
  let source = readFileSync(path, "utf8");
  if (source.startsWith(MARK)) continue; // already patched
  for (const [find, replace] of edits) {
    const count = source.split(find).length - 1;
    if (count !== 1) throw new Error(`patch-excalidraw: expected 1 match in ${file}, found ${count}: ${find.slice(0, 60)}…`);
    source = source.replace(find, () => replace);
  }
  writeFileSync(path, MARK + source);
  changed = true;
  console.log(`patch-excalidraw: patched ${file}`);
}

// The dev server caches pre-bundled dependencies; drop it so the patch shows up.
const viteCache = join(root, "node_modules", ".vite");
if (changed && existsSync(viteCache)) rmSync(viteCache, { recursive: true, force: true });
if (!changed) console.log("patch-excalidraw: already patched");
