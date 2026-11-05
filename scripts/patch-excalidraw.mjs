// Small changes to Excalidraw 0.18.1, applied after `npm install` (also on GitHub):
//  1. More room around text inside shapes (padding 5px → 14px).
//  2. Bold text: a text element with customData.bold is drawn and measured bold.
//  3. Strikethrough: a text element with customData.strike gets a line through it.
//  4. Selection like FigJam: a 2px outline on the shape's edge (not 4px outside it)
//     and bigger handles (10px, 1.5px border) centered on its corners.
//  5. Connector points in FigJam blue instead of Excalidraw purple.
// Each change is an exact text replacement; if Excalidraw changes, this stops
// with a clear message instead of silently doing nothing. Changes already in
// place are skipped, so new ones can be added to an installed copy.

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

// Connector points and "connect here" highlights: FigJam blue instead of Excalidraw purple.
const BLUE = "#0d99ff";
const BLUE_FILL = "rgba(13, 153, 255, 0.9)";
const BLUE_SOFT = "rgba(13, 153, 255, 0.5)";
const BLUE_HIGHLIGHT = "rgba(13, 153, 255, 0.4)";

const HANDLES_DEV = (width) =>
  `      context.lineWidth = ${width} / appState.zoom.value;\n      if (renderConfig.selectionColor) {\n        context.strokeStyle = renderConfig.selectionColor;\n      }\n      if (key === "rotation") {`;
const HANDLES_PROD = (width) =>
  `e.save(),e.lineWidth=${width}/t.zoom.value,o.selectionColor&&(e.strokeStyle=o.selectionColor),i==="rotation"`;

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
      ["mouse:8,pen:16,touch:28", "mouse:10,pen:16,touch:28"],
      [
        "let i=ae(e)?br+8:Ye(e)?0:br;return Ki(C(e,n,!0),e.angle,t,r,o,i,Ye(e)?0:void 0)",
        "let i=ae(e)?br+8:0;return Ki(C(e,n,!0),e.angle,t,r,o,i,ae(e)?void 0:0)",
      ],
    ],
  },
  {
    file: "dist/prod/index.js",
    edits: [
      ["e.lineWidth=(p?4:1)/o.zoom.value", "e.lineWidth=(p?4:2)/o.zoom.value"],
      [HANDLES_PROD(1), HANDLES_PROD(1.5)],
      [
        "padding:S.id===a.croppingElementId||xe(S)?0:void 0",
        'padding:S.id===a.croppingElementId||S.type!=="line"&&S.type!=="arrow"?0:void 0',
      ],
      [
        'e.strokeStyle="#5e5ad8",e.setLineDash([]),e.fillStyle="rgba(255, 255, 255, 0.9)",n?e.fillStyle="rgba(134, 131, 226, 0.9)":i&&(e.fillStyle="rgba(177, 151, 252, 0.7)")',
        `e.strokeStyle="${BLUE}",e.setLineDash([]),e.fillStyle="rgba(255, 255, 255, 0.9)",n?e.fillStyle="${BLUE_FILL}":i&&(e.fillStyle="${BLUE_SOFT}")`,
      ],
      ["rgba(105, 101, 219, 0.4)", BLUE_HIGHLIGHT],
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
      ["var transformHandleSizes = {\n  mouse: 8,", "var transformHandleSizes = {\n  mouse: 10,"],
      [
        "  const margin = isLinearElement(element) ? DEFAULT_TRANSFORM_HANDLE_SPACING + 8 : isImageElement(element) ? 0 : DEFAULT_TRANSFORM_HANDLE_SPACING;\n  return getTransformHandlesFromCoords(\n    getElementAbsoluteCoords(element, elementsMap, true),\n    element.angle,\n    zoom,\n    pointerType,\n    omitSides,\n    margin,\n    isImageElement(element) ? 0 : void 0\n  );",
        "  const margin = isLinearElement(element) ? DEFAULT_TRANSFORM_HANDLE_SPACING + 8 : 0;\n  return getTransformHandlesFromCoords(\n    getElementAbsoluteCoords(element, elementsMap, true),\n    element.angle,\n    zoom,\n    pointerType,\n    omitSides,\n    margin,\n    isLinearElement(element) ? void 0 : 0\n  );",
      ],
    ],
  },
  {
    file: "dist/dev/index.js",
    edits: [
      [
        "context.lineWidth = (activeEmbeddable ? 4 : 1) / appState.zoom.value;",
        "context.lineWidth = (activeEmbeddable ? 4 : 2) / appState.zoom.value;",
      ],
      [HANDLES_DEV(1), HANDLES_DEV(1.5)],
      [
        "padding: element.id === appState.croppingElementId || isImageElement(element) ? 0 : void 0",
        'padding: element.id === appState.croppingElementId || element.type !== "line" && element.type !== "arrow" ? 0 : void 0',
      ],
      [
        '  context.strokeStyle = "#5e5ad8";\n  context.setLineDash([]);\n  context.fillStyle = "rgba(255, 255, 255, 0.9)";\n  if (isSelected) {\n    context.fillStyle = "rgba(134, 131, 226, 0.9)";\n  } else if (isPhantomPoint) {\n    context.fillStyle = "rgba(177, 151, 252, 0.7)";\n  }',
        `  context.strokeStyle = "${BLUE}";\n  context.setLineDash([]);\n  context.fillStyle = "rgba(255, 255, 255, 0.9)";\n  if (isSelected) {\n    context.fillStyle = "${BLUE_FILL}";\n  } else if (isPhantomPoint) {\n    context.fillStyle = "${BLUE_SOFT}";\n  }`,
      ],
      ["rgba(105, 101, 219, 0.4)", BLUE_HIGHLIGHT],
    ],
  },
];

let changed = false;
for (const { file, edits } of patches) {
  const path = join(pkgDir, file);
  const original = readFileSync(path, "utf8");
  let source = original;
  for (const [find, replace] of edits) {
    if (source.split(replace).length - 1 === 1 && !source.includes(find)) continue; // already applied
    const count = source.split(find).length - 1;
    if (count !== 1) throw new Error(`patch-excalidraw: expected 1 match in ${file}, found ${count}: ${find.slice(0, 60)}…`);
    source = source.replace(find, () => replace);
  }
  if (source === original) continue;
  writeFileSync(path, source.startsWith(MARK) ? source : MARK + source);
  changed = true;
  console.log(`patch-excalidraw: patched ${file}`);
}

// The dev server caches pre-bundled dependencies; drop it so the patch shows up.
const viteCache = join(root, "node_modules", ".vite");
if (changed && existsSync(viteCache)) rmSync(viteCache, { recursive: true, force: true });
if (!changed) console.log("patch-excalidraw: already patched");
