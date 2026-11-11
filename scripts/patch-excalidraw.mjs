// Small changes to Excalidraw 0.18.1, applied after `npm install` (also on GitHub):
//  1. More room around text inside shapes (padding 5px → 14px).
//  2. Bold text: a text element with customData.bold is drawn and measured bold.
//  3. Strikethrough: a text element with customData.strike gets a line through it.
//  4. Selection like FigJam: a 2px outline on the shape's edge (not 4px outside it)
//     and bigger handles (10px, 1.5px border) centered on its corners.
//  5. Connector points in FigJam blue instead of Excalidraw purple.
//  6. Inter (FigJam's font, already loaded by the page) as font family 11,
//     with FigJam's 150% line height.
//  7. Text height reads the size from the "16px" part of the font text, so a
//     weight in front of it ("bold 16px") doesn't break it.
//  8. Mixed text sizes, like FigJam: lines are drawn (canvas and SVG) at their own
//     size, the app lays out such text itself, and the in-place text editor can be
//     the app's rich editor (which shows each line at its size while typing).
//     SVG export also keeps bold text bold.
//  9. Dark mode colors chosen by the app (src/components/board/darkInk.ts) instead
//     of inverting the whole canvas: shapes, text and pen strokes are drawn with
//     the colors __mfaInk gives, images aren't re-inverted, and cached shapes
//     remember which colors they were made with (light, dark or export), so
//     exports stay light.
// 10. Bold and strikethrough on parts of a text: lines with pieces
//     (customData.lineRuns, from the app's layout) are drawn piece by piece,
//     on the canvas (__mfaDrawRuns) and in SVG exports (__mfaSvgRuns).
// 11. New text in a shape gets the size the app asks for (__mfaLabelSize: sticky
//     notes start at Medium, like FigJam asks for here).
// 12. Snap guides in FigJam blue, without Excalidraw's little crosses.
// 13. Copy puts the real text on the clipboard: the app writes it (__mfaCopy, see
//     src/components/board/clipboard.ts) and keeps the board data for pasting back
//     in, which paste reads first (__mfaPasteData).
// 14. Dropping several images places them all (__mfaDropImages, see
//     src/components/board/imageDrop.ts); Excalidraw only takes the first file.
// 15. Clicking inside a section picks what's there (an image, a shape) before the
//     section itself.
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

// Drawing text lines: each line can have its own size (customData.lineSizes, one per
// drawn line, set by the app's mixed-size layout), and strikethrough is drawn per line.
const LINES_PROD =
  "{let __ls=e.customData?.lineSizes,__m=Array.isArray(__ls)&&__ls.length===s.length,__y=0;for(let U=0;U<s.length;U++){let __f=__m?__ls[U]:e.fontSize,__k=__f/e.fontSize,__Y=(__m?__y:U*c)+l*__k;__m&&(n.font=Ee({...e,fontSize:__f}));let __rd=globalThis.__mfaDrawRuns?.(n,e,U,s.length,d,__Y,__f,Ee);__rd||n.fillText(s[U],d,__Y);if(!__rd&&e.customData?.strike){let W=n.measureText(s[U]).width,X=e.textAlign===\"center\"?d-W/2:e.textAlign===\"right\"?d-W:d;n.fillRect(X,__Y-__f*.3,W,Math.max(1,__f/14))}__y+=c*__k}}n.restore()";
const LINES_DEV = `        {
          const __ls = element.customData?.lineSizes;
          const __mixed = Array.isArray(__ls) && __ls.length === lines.length;
          let __y = 0;
          for (let index = 0; index < lines.length; index++) {
            const __fs = __mixed ? __ls[index] : element.fontSize;
            const __k = __fs / element.fontSize;
            const __lineY = (__mixed ? __y : index * lineHeightPx) + verticalOffset * __k;
            if (__mixed) context.font = getFontString({ ...element, fontSize: __fs });
            const __rd = globalThis.__mfaDrawRuns?.(context, element, index, lines.length, horizontalOffset, __lineY, __fs, getFontString);
            if (!__rd) context.fillText(lines[index], horizontalOffset, __lineY);
            if (!__rd && element.customData?.strike) {
              const w = context.measureText(lines[index]).width;
              const x = element.textAlign === "center" ? horizontalOffset - w / 2 : element.textAlign === "right" ? horizontalOffset - w : horizontalOffset;
              context.fillRect(x, __lineY - __fs * 0.3, w, Math.max(1, __fs / 14));
            }
            __y += lineHeightPx * __k;
          }
        }`;

// Text layout: the app lays out text with mixed sizes itself (globalThis.__mfaMixedLayout,
// see src/components/board/richText.ts); Excalidraw's own layout is used otherwise.
const MIXED_CALL = (el, text, maxW, fns) => `globalThis.__mfaMixedLayout?.(${el}, ${text}, ${maxW}, ${fns})`;

// Connector points and "connect here" highlights: FigJam blue instead of Excalidraw purple.
const BLUE = "#0d99ff";
const BLUE_FILL = "rgba(13, 153, 255, 0.9)";
const BLUE_SOFT = "rgba(13, 153, 255, 0.5)";
const BLUE_HIGHLIGHT = "rgba(13, 153, 255, 0.4)";

// Inter: font family 11. Metrics of Inter 4 (the Google Fonts version the page loads).
const INTER_ID = 11;
const INTER_METRICS = "unitsPerEm: 2048, ascender: 1984, descender: -494, lineHeight: 1.5";
// Weight in front of the size when the text is bold. (FigJam uses Inter Medium, but its
// renderer draws thinner than the browser: Regular here looks the same on screen.)
const WEIGHT = `\${o.customData?.bold ? "bold " : ""}`;
const WEIGHT_MIN = `\${o.customData?.bold?"bold ":""}`;
// The size is the number right before "px".
const SIZE_OF = (v) => `parseFloat((${v}.match(/([\\d.]+)px/) || [])[1] ?? ${v})`;

// 15. Sections are filled, so Excalidraw would count a click anywhere inside one as a
//     click on the section (and sections sit above what's in them). Sections now come
//     last: what's under the pointer inside them is picked first.
const IS_FRAME = (v) => `(${v}.type==="frame"||${v}.type==="magicframe")`;

const HANDLES_DEV = (width) =>
  `      context.lineWidth = ${width} / appState.zoom.value;\n      if (renderConfig.selectionColor) {\n        context.strokeStyle = renderConfig.selectionColor;\n      }\n      if (key === "rotation") {`;
const HANDLES_PROD = (width) =>
  `e.save(),e.lineWidth=${width}/t.zoom.value,o.selectionColor&&(e.strokeStyle=o.selectionColor),i==="rotation"`;

// 9. Dark mode: which colors a cached shape was made with ("x" = for an export).
const INK_KEY_PROD = '__key=n?.isExporting?"x":globalThis.__mfaInkKey?.()??"",__keys=Xe.__keys||(Xe.__keys=new WeakMap)';
const INK_KEY_DEV =
  '__key = renderConfig?.isExporting ? "x" : globalThis.__mfaInkKey?.() ?? "", __keys = _ShapeCache.__keys || (_ShapeCache.__keys = new WeakMap())';

const patches = [
  {
    file: "dist/prod/chunk-K2UTITRG.js",
    edits: [
      ["excalidrawLibrary:2},Se=5,", "excalidrawLibrary:2},Se=14,"],
      [
        "Ee=({fontSize:e,fontFamily:t})=>`${e}px ${ea({fontFamily:t})}`",
        `Ee=(o)=>\`${WEIGHT_MIN}\${o.fontSize}px \${ea({fontFamily:o.fontFamily})}\``,
      ],
      ["for(let U=0;U<s.length;U++)n.fillText(s[U],d,U*c+l);n.restore()", LINES_PROD],
      [
        "Ga=(e,t,n,r=e.text)=>{if(e.isDeleted)return;(t||",
        `Ga=(e,t,n,r=e.text)=>{if(e.isDeleted)return;{let __x=${MIXED_CALL("e", "r", "t?Tt(t,e):e.autoResize?1/0:e.width", "{font:Ee,wrap:en,measure:ht}")};if(__x)return __x}(t||`,
      ],
      [
        "let a=ht(i.text,Ee(e),e.lineHeight);if(e.autoResize&&(i.width=a.width)",
        `let a=ht(i.text,Ee(e),e.lineHeight);{let __x=${MIXED_CALL("e", "e.originalText", "t?Tt(t,e):e.autoResize?1/0:e.width", "{font:Ee,wrap:en,measure:ht}")};__x&&(i.text=__x.text,a={width:__x.width,height:__x.height},i.customData=__x.customData,__x.fontSize&&(i.fontSize=__x.fontSize))}if(e.autoResize&&(i.width=a.width)`,
      ],
      [
        "let p=ht(a,Ee(i),i.lineHeight);s=p.height,d=p.width}if(s>l){",
        `let p=ht(a,Ee(i),i.lineHeight);s=p.height,d=p.width;{let __x=${MIXED_CALL("i", "i.originalText", "c", "{font:Ee,wrap:en,measure:ht}")};__x&&(a=__x.text,s=__x.height,d=__x.width,Y(i,{customData:__x.customData}))}}if(s>l){`,
      ],
      [
        'for(let B=0;B<w.length;B++){let _=r.ownerDocument.createElementNS(re,"text");_.textContent=w[B],_.setAttribute("x",`${S}`),_.setAttribute("y",`${B*I+v}`),_.setAttribute("font-family",ea(e)),_.setAttribute("font-size",`${e.fontSize}px`),',
        'let __ls=e.customData?.lineSizes,__m=Array.isArray(__ls)&&__ls.length===w.length,__y=0;for(let B=0;B<w.length;B++){let __f=__m?__ls[B]:e.fontSize,__k=__f/e.fontSize,_=r.ownerDocument.createElementNS(re,"text");_.textContent=w[B],_.setAttribute("x",`${S}`),_.setAttribute("y",`${(__m?__y:B*I)+v*__k}`),__y+=I*__k,_.setAttribute("font-family",ea(e)),_.setAttribute("font-size",`${__f}px`),e.customData?.bold&&_.setAttribute("font-weight","bold"),globalThis.__mfaSvgRuns?.(_,e,B,w.length),',
      ],
      ["mouse:8,pen:16,touch:28", "mouse:10,pen:16,touch:28"],
      ["o=parseFloat(t),i=B6(r,o,n)", `o=${SIZE_OF("t")},i=B6(r,o,n)`],
      [
        "let i=ae(e)?br+8:Ye(e)?0:br;return Ki(C(e,n,!0),e.angle,t,r,o,i,Ye(e)?0:void 0)",
        "let i=ae(e)?br+8:0;return Ki(C(e,n,!0),e.angle,t,r,o,i,ae(e)?void 0:0)",
      ],
      ['"Comic Shanns":8,"Liberation Sans":9},', `"Comic Shanns":8,"Liberation Sans":9,Inter:${INTER_ID}},`],
      [
        "deprecated:!0,local:!0},[Ie.Cascadia]:",
        `deprecated:!0,local:!0},[Ie.Inter]:{metrics:{${INTER_METRICS.replace(/ /g, "")}},icon:la,local:!0},[Ie.Cascadia]:`,
      ],
      ['n("Helvetica",...dc),', 'n("Helvetica",...dc),n("Inter",...dc),'],
      [
        'P(Xe,"generateElementShape",(t,n)=>{let r=n?.isExporting?void 0:Xe.get(t);',
        `P(Xe,"generateElementShape",(t,n)=>{let ${INK_KEY_PROD},r=n?.isExporting||__keys.get(t)!==__key?void 0:Xe.get(t);`,
      ],
      ["return Xe.cache.set(t,o),o});var he=Xe;", "return Xe.cache.set(t,o),__keys.set(t,__key),o});var he=Xe;"],
      [
        "vd=(e,t,{isExporting:n,canvasBackgroundColor:r,embedsValidationStatus:o})=>{switch(e.type){",
        'vd=(e,t,{isExporting:n,canvasBackgroundColor:r,embedsValidationStatus:o})=>{if(globalThis.__mfaInk&&!n&&e.type!=="freedraw")e=globalThis.__mfaInk(e);switch(e.type){',
      ],
      [
        'ni=(e,t,n,r,o)=>{switch(e.type){case"rectangle":case"iframe":case"embeddable":case"diamond":case"ellipse":{',
        'ni=(e,t,n,r,o)=>{let __ink=globalThis.__mfaInk&&!r?.isExporting?globalThis.__mfaInk(e).strokeColor:e.strokeColor;switch(e.type){case"rectangle":case"iframe":case"embeddable":case"diamond":case"ellipse":{',
      ],
      [
        'case"freedraw":{n.save(),n.fillStyle=e.strokeColor;let i=Bm(e),a=he.get(e);a&&t.draw(a),n.fillStyle=e.strokeColor',
        'case"freedraw":{n.save(),n.fillStyle=__ink;let i=Bm(e),a=he.get(e);a&&t.draw(a),n.fillStyle=__ink',
      ],
      ["n.font=Ee(e),n.fillStyle=e.strokeColor,n.textAlign=e.textAlign", "n.font=Ee(e),n.fillStyle=__ink,n.textAlign=e.textAlign"],
      ["A1=(e,t,n)=>n.theme===ke.DARK&&", "A1=(e,t,n)=>!globalThis.__mfaInk&&n.theme===ke.DARK&&"],
      [
        "Np=async(e,t,n)=>{await hs(W7({elements:e,files:t}),n)}",
        "Np=async(e,t,n)=>{let __j=W7({elements:e,files:t});if(globalThis.__mfaCopy&&await globalThis.__mfaCopy(e,__j,n))return;await hs(__j,n)}",
      ],
      [
        "vK=async(e,t=!1)=>{let n=await j7(e,t);",
        "vK=async(e,t=!1)=>{let __b=globalThis.__mfaPasteData?.(e,t);if(__b)return __b;let n=await j7(e,t);",
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
      [
        'd=document.createElement("textarea");d.dir="auto"',
        'd=globalThis.__mfaCreateEditor?globalThis.__mfaCreateEditor(n):document.createElement("textarea");d.dir="auto"',
      ],
      [
        "u=this.state.currentItemFontSize;if(!c&&l&&i&&!Ne(i)){",
        "u=(l&&i&&globalThis.__mfaLabelSize?.(i))||this.state.currentItemFontSize;if(!c&&l&&i&&!Ne(i)){",
      ],
      ['var c5="#ff6b6b",d5="#ff0000",G1=1,Y1=2,', `var c5="${BLUE}",d5="${BLUE}",G1=1,Y1=0,`],
      [
        'C(this,"handleAppOnDrop",async t=>{let{file:r,fileHandle:n}=await Ox(t)',
        'C(this,"handleAppOnDrop",async t=>{if(globalThis.__mfaDropImages?.(t,this))return;let{file:r,fileHandle:n}=await Ox(t)',
      ],
      [
        ".filter(c=>Qr(c)?(a.push(c),!1):!0).concat(a)}getElementHitThreshold(){",
        `.filter(c=>Qr(c)?(a.push(c),!1):!0).concat(a).sort((c,m)=>${IS_FRAME("m")}-${IS_FRAME("c")})}getElementHitThreshold(){`,
      ],
    ],
  },
  {
    file: "dist/dev/chunk-4FTI6OG3.js",
    edits: [
      ["var BOUND_TEXT_PADDING = 5;", "var BOUND_TEXT_PADDING = 14;"],
      [
        "var getFontString = ({\n  fontSize,\n  fontFamily\n}) => {\n  return `${fontSize}px ${getFontFamilyString({ fontFamily })}`;\n};",
        `var getFontString = (o) => {\n  return \`${WEIGHT}\${o.fontSize}px \${getFontFamilyString({ fontFamily: o.fontFamily })}\`;\n};`,
      ],
      [
        "        for (let index = 0; index < lines.length; index++) {\n          context.fillText(\n            lines[index],\n            horizontalOffset,\n            index * lineHeightPx + verticalOffset\n          );\n        }",
        LINES_DEV,
      ],
      [
        "var refreshTextDimensions = (textElement, container, elementsMap, text = textElement.text) => {\n  if (textElement.isDeleted) {\n    return;\n  }",
        `var refreshTextDimensions = (textElement, container, elementsMap, text = textElement.text) => {\n  if (textElement.isDeleted) {\n    return;\n  }\n  {\n    const __x = ${MIXED_CALL("textElement", "text", "container ? getBoundTextMaxWidth(container, textElement) : textElement.autoResize ? Infinity : textElement.width", "{ font: getFontString, wrap: wrapText, measure: measureText }")};\n    if (__x) return __x;\n  }`,
      ],
      [
        "  const metrics = measureText(\n    boundTextUpdates.text,\n    getFontString(textElement),\n    textElement.lineHeight\n  );",
        `  let metrics = measureText(\n    boundTextUpdates.text,\n    getFontString(textElement),\n    textElement.lineHeight\n  );\n  {\n    const __x = ${MIXED_CALL("textElement", "textElement.originalText", "container ? getBoundTextMaxWidth(container, textElement) : textElement.autoResize ? Infinity : textElement.width", "{ font: getFontString, wrap: wrapText, measure: measureText }")};\n    if (__x) {\n      boundTextUpdates.text = __x.text;\n      metrics = { width: __x.width, height: __x.height };\n      boundTextUpdates.customData = __x.customData;\n      if (__x.fontSize) boundTextUpdates.fontSize = __x.fontSize;\n    }\n  }`,
      ],
      [
        "      const metrics = measureText(\n        text,\n        getFontString(textElement),\n        textElement.lineHeight\n      );\n      nextHeight = metrics.height;\n      nextWidth = metrics.width;",
        `      const metrics = measureText(\n        text,\n        getFontString(textElement),\n        textElement.lineHeight\n      );\n      nextHeight = metrics.height;\n      nextWidth = metrics.width;\n      const __x = ${MIXED_CALL("textElement", "textElement.originalText", "maxWidth", "{ font: getFontString, wrap: wrapText, measure: measureText }")};\n      if (__x) {\n        text = __x.text;\n        nextHeight = __x.height;\n        nextWidth = __x.width;\n        mutateElement(textElement, { customData: __x.customData });\n      }`,
      ],
      [
        '          text.setAttribute("x", `${horizontalOffset}`);\n          text.setAttribute("y", `${i * lineHeightPx + verticalOffset}`);\n          text.setAttribute("font-family", getFontFamilyString(element));\n          text.setAttribute("font-size", `${element.fontSize}px`);',
        '          const __ls = element.customData?.lineSizes;\n          const __mixed = Array.isArray(__ls) && __ls.length === lines.length;\n          const __fs = __mixed ? __ls[i] : element.fontSize;\n          const __y = __mixed ? __ls.slice(0, i).reduce((sum, f) => sum + lineHeightPx * f / element.fontSize, 0) : i * lineHeightPx;\n          text.setAttribute("x", `${horizontalOffset}`);\n          text.setAttribute("y", `${__y + verticalOffset * __fs / element.fontSize}`);\n          text.setAttribute("font-family", getFontFamilyString(element));\n          text.setAttribute("font-size", `${__fs}px`);\n          if (element.customData?.bold) text.setAttribute("font-weight", "bold");\n          globalThis.__mfaSvgRuns?.(text, element, i, lines.length);',
      ],
      ["var transformHandleSizes = {\n  mouse: 8,", "var transformHandleSizes = {\n  mouse: 10,"],
      [
        "  const fontSize = parseFloat(font);\n  const height = getTextHeight(_text, fontSize, lineHeight);",
        `  const fontSize = ${SIZE_OF("font")};\n  const height = getTextHeight(_text, fontSize, lineHeight);`,
      ],
      [
        "  const margin = isLinearElement(element) ? DEFAULT_TRANSFORM_HANDLE_SPACING + 8 : isImageElement(element) ? 0 : DEFAULT_TRANSFORM_HANDLE_SPACING;\n  return getTransformHandlesFromCoords(\n    getElementAbsoluteCoords(element, elementsMap, true),\n    element.angle,\n    zoom,\n    pointerType,\n    omitSides,\n    margin,\n    isImageElement(element) ? 0 : void 0\n  );",
        "  const margin = isLinearElement(element) ? DEFAULT_TRANSFORM_HANDLE_SPACING + 8 : 0;\n  return getTransformHandlesFromCoords(\n    getElementAbsoluteCoords(element, elementsMap, true),\n    element.angle,\n    zoom,\n    pointerType,\n    omitSides,\n    margin,\n    isLinearElement(element) ? void 0 : 0\n  );",
      ],
      ['  "Liberation Sans": 9\n};', `  "Liberation Sans": 9,\n  Inter: ${INTER_ID}\n};`],
      [
        "    deprecated: true,\n    local: true\n  },\n  [FONT_FAMILY.Cascadia]: {",
        `    deprecated: true,\n    local: true\n  },\n  [FONT_FAMILY.Inter]: {\n    metrics: { ${INTER_METRICS} },\n    icon: FontFamilyNormalIcon,\n    local: true\n  },\n  [FONT_FAMILY.Cascadia]: {`,
      ],
      [
        '    init("Helvetica", ...HelveticaFontFaces);\n',
        '    init("Helvetica", ...HelveticaFontFaces);\n    init("Inter", ...HelveticaFontFaces);\n',
      ],
      [
        '__publicField(_ShapeCache, "generateElementShape", (element, renderConfig) => {\n  const cachedShape = renderConfig?.isExporting ? void 0 : _ShapeCache.get(element);',
        `__publicField(_ShapeCache, "generateElementShape", (element, renderConfig) => {\n  const ${INK_KEY_DEV};\n  const cachedShape = renderConfig?.isExporting || __keys.get(element) !== __key ? void 0 : _ShapeCache.get(element);`,
      ],
      [
        "  _ShapeCache.cache.set(element, shape);\n  return shape;\n});\nvar ShapeCache = _ShapeCache;",
        "  _ShapeCache.cache.set(element, shape);\n  __keys.set(element, __key);\n  return shape;\n});\nvar ShapeCache = _ShapeCache;",
      ],
      [
        "var _generateElementShape = (element, generator, {\n  isExporting,\n  canvasBackgroundColor,\n  embedsValidationStatus\n}) => {\n",
        'var _generateElementShape = (element, generator, {\n  isExporting,\n  canvasBackgroundColor,\n  embedsValidationStatus\n}) => {\n  if (globalThis.__mfaInk && !isExporting && element.type !== "freedraw") element = globalThis.__mfaInk(element);\n',
      ],
      [
        "var drawElementOnCanvas = (element, rc, context, renderConfig, appState) => {\n",
        "var drawElementOnCanvas = (element, rc, context, renderConfig, appState) => {\n  const __ink = globalThis.__mfaInk && !renderConfig?.isExporting ? globalThis.__mfaInk(element).strokeColor : element.strokeColor;\n",
      ],
      [
        "      context.save();\n      context.fillStyle = element.strokeColor;\n      const path = getFreeDrawPath2D(element);\n      const fillShape = ShapeCache.get(element);\n      if (fillShape) {\n        rc.draw(fillShape);\n      }\n      context.fillStyle = element.strokeColor;",
        "      context.save();\n      context.fillStyle = __ink;\n      const path = getFreeDrawPath2D(element);\n      const fillShape = ShapeCache.get(element);\n      if (fillShape) {\n        rc.draw(fillShape);\n      }\n      context.fillStyle = __ink;",
      ],
      [
        "        context.font = getFontString(element);\n        context.fillStyle = element.strokeColor;",
        "        context.font = getFontString(element);\n        context.fillStyle = __ink;",
      ],
      [
        "  return appState.theme === THEME.DARK && isInitializedImageElement(element)",
        "  return !globalThis.__mfaInk && appState.theme === THEME.DARK && isInitializedImageElement(element)",
      ],
      [
        "var copyToClipboard = async (elements, files, clipboardEvent) => {\n  await copyTextToSystemClipboard(\n    serializeAsClipboardJSON({ elements, files }),\n    clipboardEvent\n  );\n};",
        "var copyToClipboard = async (elements, files, clipboardEvent) => {\n  const __json = serializeAsClipboardJSON({ elements, files });\n  if (globalThis.__mfaCopy && await globalThis.__mfaCopy(elements, __json, clipboardEvent)) return;\n  await copyTextToSystemClipboard(__json, clipboardEvent);\n};",
      ],
      [
        "var parseClipboard = async (event, isPlainPaste = false) => {\n",
        "var parseClipboard = async (event, isPlainPaste = false) => {\n  const __board = globalThis.__mfaPasteData?.(event, isPlainPaste);\n  if (__board) return __board;\n",
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
      [
        '  const editable = document.createElement("textarea");\n  editable.dir = "auto";',
        '  const editable = globalThis.__mfaCreateEditor ? globalThis.__mfaCreateEditor(element) : document.createElement("textarea");\n  editable.dir = "auto";',
      ],
      [
        "      const fontSize = this.state.currentItemFontSize;\n      if (!existingTextElement && shouldBindToContainer && container && !isArrowElement(container)) {",
        "      const fontSize = shouldBindToContainer && container && globalThis.__mfaLabelSize?.(container) || this.state.currentItemFontSize;\n      if (!existingTextElement && shouldBindToContainer && container && !isArrowElement(container)) {",
      ],
      [
        'var SNAP_COLOR_LIGHT = "#ff6b6b";\nvar SNAP_COLOR_DARK = "#ff0000";\nvar SNAP_WIDTH = 1;\nvar SNAP_CROSS_SIZE = 2;',
        `var SNAP_COLOR_LIGHT = "${BLUE}";\nvar SNAP_COLOR_DARK = "${BLUE}";\nvar SNAP_WIDTH = 1;\nvar SNAP_CROSS_SIZE = 0;`,
      ],
      [
        '    __publicField(this, "handleAppOnDrop", async (event) => {\n',
        '    __publicField(this, "handleAppOnDrop", async (event) => {\n      if (globalThis.__mfaDropImages?.(event, this)) return;\n',
      ],
      [
        "    }).concat(iframeLikes);\n    return elements;\n  }\n  getElementHitThreshold() {",
        `    }).concat(iframeLikes);\n    elements.sort((a, b) => ${IS_FRAME("b")} - ${IS_FRAME("a")});\n    return elements;\n  }\n  getElementHitThreshold() {`,
      ],
    ],
  },
];

let changed = false;
for (const { file, edits } of patches) {
  const path = join(pkgDir, file);
  const original = readFileSync(path, "utf8");
  let source = original;
  for (const [find, replace] of edits) {
    // Already applied? (Some replacements keep the original text and add after it.)
    if (source.includes(replace) && (replace.includes(find) || !source.includes(find))) continue;
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
