import { useEffect, useReducer, useRef, type ReactNode } from "react";
import {
  CaptureUpdateAction,
  FONT_FAMILY,
  getCommonBounds,
  newElementWith,
  restoreElements,
  sceneCoordsToViewportCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Menu, useMenu, type MenuEntry } from "./Menu";
import {
  ColorPopover,
  FILL_TABS,
  PALETTE,
  STROKE_TABS,
  baseColor,
  fillMode,
  withFillMode,
  type StrokeMode,
} from "./Palette";
import { AlignIcon, ChevronDown, DotsIcon, FontIcon, StrokeIcon } from "./icons";
import { canConvert, convertShapes, SHAPE_LABELS, SHAPES, shapeOf, type ShapeKind } from "./shapes";
import { SHAPE_ICONS } from "./Toolbar";

export const STICKY_COLORS = [
  { name: "Yellow", value: "#fff2a6" },
  { name: "Orange", value: "#ffd9b3" },
  { name: "Red", value: "#ffc9c9" },
  { name: "Pink", value: "#ffd1ec" },
  { name: "Violet", value: "#e2d4ff" },
  { name: "Blue", value: "#c9e2ff" },
  { name: "Teal", value: "#c2eee6" },
  { name: "Green", value: "#cfefc6" },
  { name: "Gray", value: "#e6e6e6" },
  { name: "White", value: "#ffffff" },
];

const STROKE_WIDTHS = [
  { label: "Thin", value: 1 },
  { label: "Medium", value: 2 },
  { label: "Thick", value: 4 },
];

const FONT_SIZES = [
  { label: "Small", value: 16 },
  { label: "Medium", value: 20 },
  { label: "Large", value: 28 },
  { label: "Extra large", value: 36 },
];

const FONTS = [
  { label: "Sans", value: FONT_FAMILY["Liberation Sans"], css: "Liberation Sans" },
  { label: "Rounded", value: FONT_FAMILY.Nunito, css: "Nunito" },
  { label: "Handwritten", value: FONT_FAMILY.Excalifont, css: "Excalifont" },
  { label: "Comic", value: FONT_FAMILY["Comic Shanns"], css: "Comic Shanns" },
  { label: "Display", value: FONT_FAMILY["Lilita One"], css: "Lilita One" },
  { label: "Code", value: FONT_FAMILY.Cascadia, css: "Cascadia" },
];

/** Text is measured when it changes, so the font has to be loaded first. */
async function ensureFont(css: string) {
  try {
    await Promise.race([document.fonts.load(`20px "${css}"`), new Promise((r) => setTimeout(r, 3000))]);
  } catch {
    /* measure with whatever is available */
  }
}

const ALIGNS = [
  { label: "Left", value: "left" as const },
  { label: "Center", value: "center" as const },
  { label: "Right", value: "right" as const },
];

type Kind = "sticky" | "shape" | "text" | "line" | "pen" | "image" | "section" | "other";

function kindOf(el: ExcalidrawElement): Kind {
  if (el.customData?.kind === "sticky") return "sticky";
  if (shapeOf(el)) return "shape";
  switch (el.type) {
    case "text":
      return "text";
    case "arrow":
    case "line":
      return "line";
    case "freedraw":
      return "pen";
    case "image":
      return "image";
    case "frame":
    case "magicframe":
      return "section";
    default:
      return "other";
  }
}

type Patch = Record<string, unknown>;
type TextLike = ExcalidrawElement & { fontSize: number; fontFamily: number; textAlign: string; verticalAlign: string };

// Where text sits inside a shape (same rules as Excalidraw's own layout).
const PAD = 5;
function labelArea(c: ExcalidrawElement) {
  const k = c.type === "ellipse" ? Math.SQRT2 / 2 : c.type === "diamond" ? 0.5 : 1;
  const ox = PAD + (c.type === "ellipse" ? (c.width / 2) * (1 - Math.SQRT2 / 2) : c.type === "diamond" ? c.width / 4 : 0);
  const oy = PAD + (c.type === "ellipse" ? (c.height / 2) * (1 - Math.SQRT2 / 2) : c.type === "diamond" ? c.height / 4 : 0);
  const maxW = (k === 1 ? c.width : Math.round(c.width * k)) - PAD * 2;
  const maxH = (k === 1 ? c.height : Math.round(c.height * k)) - PAD * 2;
  return { x: c.x + ox, y: c.y + oy, maxW, maxH, k };
}

/** Grows the shape if its text no longer fits, then centers the text again. */
function placeLabel(text: TextLike, container: ExcalidrawElement): { text: Patch; container?: Patch } {
  let c = container;
  let area = labelArea(c);
  let containerPatch: Patch | undefined;
  if (text.height > area.maxH) {
    const height = (text.height + PAD * 2) / area.k;
    containerPatch = { height };
    c = { ...c, height } as ExcalidrawElement;
    area = labelArea(c);
  }
  const y =
    text.verticalAlign === "top"
      ? area.y
      : text.verticalAlign === "bottom"
        ? area.y + area.maxH - text.height
        : area.y + area.maxH / 2 - text.height / 2;
  const x =
    text.textAlign === "left"
      ? area.x
      : text.textAlign === "right"
        ? area.x + area.maxW - text.width
        : area.x + area.maxW / 2 - text.width / 2;
  return { text: { x, y }, container: containerPatch };
}

/** Applies a change to the selected elements (and their text), as one undo step. */
function update(
  api: ExcalidrawImperativeAPI,
  patchSelected: ((el: ExcalidrawElement) => Patch | null) | null,
  patchText?: (el: ExcalidrawElement) => Patch | null,
) {
  const selectedIds = api.getAppState().selectedElementIds;
  const all = api.getSceneElementsIncludingDeleted();
  const remeasure: ExcalidrawElement[] = [];
  let next = all.map((el) => {
    let patch: Patch | null = null;
    if (selectedIds[el.id] && patchSelected) patch = patchSelected(el);
    const isLabel = el.type === "text" && el.containerId && selectedIds[el.containerId];
    if (!patch && patchText && el.type === "text" && (selectedIds[el.id] || isLabel)) patch = patchText(el);
    if (!patch) return el;
    const updated = newElementWith(el, patch as never);
    if (el.type === "text" && ("fontSize" in patch || "fontFamily" in patch || "textAlign" in patch)) remeasure.push(updated);
    return updated;
  });
  if (remeasure.length) {
    // Text changed: measure it again (labels need their container to wrap)…
    const byId = new Map<string, ExcalidrawElement>(next.map((el) => [el.id, el]));
    const containers: ExcalidrawElement[] = [];
    for (const t of remeasure) {
      const container = t.type === "text" && t.containerId ? byId.get(t.containerId) : undefined;
      if (container) containers.push(container);
    }
    // (Excalidraw only re-measures when binding repair is on too.)
    const refreshed = restoreElements([...remeasure, ...containers], null, {
      refreshDimensions: true,
      repairBindings: true,
    });
    const patches = new Map<string, Patch>();
    for (const t of refreshed) {
      if (t.type !== "text") continue;
      const { width, height, text: wrapped } = t as TextLike & { text: string };
      const patch: Patch = { width, height, text: wrapped };
      // …and put labels back in the middle of their shape (growing it if needed).
      const container = t.containerId ? byId.get(t.containerId) : undefined;
      if (container) {
        const placed = placeLabel(t as TextLike, container);
        Object.assign(patch, placed.text);
        if (placed.container) patches.set(container.id, placed.container);
      }
      patches.set(t.id, patch);
    }
    next = next.map((el) => {
      const patch = patches.get(el.id);
      return patch ? newElementWith(el, patch as never) : el;
    });
  }
  api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
}

/** Runs one of Excalidraw's keyboard actions (they handle bindings, order…). */
function press(init: KeyboardEventInit) {
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

export function SelectionToolbar({ api }: { api: ExcalidrawImperativeAPI }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const lastKey = useRef("");
  const dragging = useRef(false);

  useEffect(() => {
    const check = () => {
      const s = api.getAppState();
      const ids = Object.keys(s.selectedElementIds);
      let key = "";
      if (ids.length && !dragging.current && s.activeTool.type === "selection" && !s.editingTextElement) {
        const versions = api
          .getSceneElements()
          .filter((el) => s.selectedElementIds[el.id] || (el.type === "text" && el.containerId && s.selectedElementIds[el.containerId]))
          .map((el) => `${el.id}:${el.version}`)
          .join(",");
        key = `${versions}|${s.scrollX}|${s.scrollY}|${s.zoom.value}|${s.width}|${s.height}`;
      }
      if (key !== lastKey.current) {
        lastKey.current = key;
        rerender();
      }
    };
    const offs = [
      api.onChange(check),
      api.onScrollChange(check),
      api.onPointerDown(() => {
        dragging.current = true;
        check();
      }),
      api.onPointerUp(() => {
        dragging.current = false;
        check();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [api]);

  if (!lastKey.current) return null;

  const s = api.getAppState();
  const elements = api.getSceneElements();
  const selected = elements.filter((el) => s.selectedElementIds[el.id]);
  if (!selected.length) return null;
  const labels = elements.filter((el) => el.type === "text" && el.containerId && s.selectedElementIds[el.containerId]);
  const kinds = new Set(selected.map(kindOf));
  const only = (...k: Kind[]) => [...kinds].every((x) => k.includes(x));

  const [x1, y1, x2, y2] = getCommonBounds([...selected, ...labels]);
  const top = sceneCoordsToViewportCoords({ sceneX: (x1 + x2) / 2, sceneY: y1 }, s);
  const bottom = sceneCoordsToViewportCoords({ sceneX: (x1 + x2) / 2, sceneY: y2 }, s);
  const above = top.y - 60 > 64;
  const style = {
    left: Math.min(Math.max(top.x, 200), window.innerWidth - 200),
    top: above ? top.y - 56 : Math.min(bottom.y + 16, window.innerHeight - 140),
  };

  const first = selected[0];
  const text = (selected.find((el) => el.type === "text") ?? labels[0]) as TextLike | undefined;
  const shapes = only("shape");
  const groups: ReactNode[] = [];

  if (shapes) {
    const current = shapeOf(first)!;
    groups.push(
      <ShapeSwitch
        key="shape"
        current={current}
        allowed={(k) => selected.every((el) => canConvert(el, k))}
        onPick={(k) => convertShapes(api, k)}
      />,
      <span key="d1" className="fx-st-divider" />,
      <FillButton key="fill" value={first.backgroundColor} onChange={(c) => update(api, () => ({ backgroundColor: c, fillStyle: "solid" }))} />,
      <StrokeButton
        key="stroke"
        color={first.strokeColor}
        style={first.strokeStyle}
        onChange={(p) => update(api, () => p)}
      />,
    );
  } else if (only("sticky")) {
    groups.push(
      <ColorButton
        key="sticky"
        label="Color"
        value={first.backgroundColor}
        colors={[STICKY_COLORS]}
        onPick={(c) => update(api, () => ({ backgroundColor: c }))}
      />,
    );
  } else if (only("text")) {
    groups.push(
      <ColorButton key="ink" label="Text color" value={first.strokeColor} onPick={(c) => update(api, () => ({ strokeColor: c }))} />,
    );
  } else if (only("line", "pen")) {
    groups.push(
      <ColorButton
        key="ink"
        label="Color"
        value={first.strokeColor}
        tabs={only("line") ? LINE_TABS : undefined}
        tab={first.strokeStyle === "dashed" ? "dashed" : first.strokeStyle === "dotted" ? "dotted" : "solid"}
        onTab={(t) => update(api, () => ({ strokeStyle: t }))}
        onPick={(c) => update(api, () => ({ strokeColor: c }))}
      />,
      <Dropdown
        key="width"
        label="Thickness"
        display={<span className="fx-stroke-sample" style={{ height: Math.max(1, first.strokeWidth) }} />}
        entries={STROKE_WIDTHS.map((o) => ({
          label: o.label,
          checked: first.strokeWidth === o.value,
          onSelect: () => update(api, () => ({ strokeWidth: o.value })),
        }))}
      />,
    );
  }

  if (text && only("text", "sticky", "shape")) {
    const size = FONT_SIZES.find((f) => f.value === text.fontSize);
    groups.push(
      <span key="d2" className="fx-st-divider" />,
      <Dropdown
        key="font"
        label="Font"
        display={<FontIcon />}
        entries={FONTS.map((f) => ({
          label: f.label,
          checked: text.fontFamily === f.value,
          onSelect: () => void ensureFont(f.css).then(() => update(api, null, () => ({ fontFamily: f.value }))),
        }))}
      />,
      <Dropdown
        key="size"
        label="Text size"
        wide
        display={<span className="fx-st-text">{size?.label ?? `${Math.round(text.fontSize)} px`}</span>}
        entries={FONT_SIZES.map((f) => ({
          label: f.label,
          checked: text.fontSize === f.value,
          onSelect: () => {
            const css = FONTS.find((x) => x.value === text.fontFamily)?.css;
            void (css ? ensureFont(css) : Promise.resolve()).then(() => update(api, null, () => ({ fontSize: f.value })));
          },
        }))}
      />,
      <Dropdown
        key="align"
        label="Alignment"
        display={<AlignIcon align={(text.textAlign as "left") ?? "center"} />}
        entries={ALIGNS.map((a) => ({
          label: a.label,
          checked: text.textAlign === a.value,
          onSelect: () => update(api, null, () => ({ textAlign: a.value })),
        }))}
      />,
    );
  }

  const ctrl = { ctrlKey: true, metaKey: true };
  const more: MenuEntry[] = [
    { label: "Bring to front", shortcut: "Ctrl+Shift+]", onSelect: () => press({ key: "]", code: "BracketRight", shiftKey: true, ...ctrl }) },
    { label: "Send to back", shortcut: "Ctrl+Shift+[", onSelect: () => press({ key: "[", code: "BracketLeft", shiftKey: true, ...ctrl }) },
    { separator: true },
    { label: "Duplicate", shortcut: "Ctrl+D", onSelect: () => press({ key: "d", code: "KeyD", ...ctrl }) },
    { label: "Delete", shortcut: "Del", onSelect: () => press({ key: "Delete", code: "Delete" }) },
  ];
  if (groups.length) groups.push(<span key="d3" className="fx-st-divider" />);
  groups.push(<Dropdown key="more" label="More" display={<DotsIcon />} noCaret entries={more} />);

  return (
    <div className="fx-selection-toolbar" style={style} onMouseDown={(e) => e.preventDefault()}>
      {groups}
    </div>
  );
}

// ---- Controls ----------------------------------------------------------------

const LINE_TABS: { id: "solid" | "dashed" | "dotted"; label: string; icon: ReactNode }[] = [
  { id: "solid", label: "Solid", icon: STROKE_TABS[0].icon },
  { id: "dashed", label: "Dashed", icon: STROKE_TABS[1].icon },
  {
    id: "dotted",
    label: "Dotted",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="currentColor">
        <circle cx="3" cy="11" r="1" />
        <circle cx="7" cy="7" r="1" />
        <circle cx="11" cy="3" r="1" />
      </svg>
    ),
  },
];

function Swatch({ value }: { value: string }) {
  return <span className="fx-swatch" data-none={value === "transparent" || undefined} style={{ ["--c" as string]: value }} />;
}

function ShapeSwitch({
  current,
  allowed,
  onPick,
}: {
  current: ShapeKind;
  allowed: (k: ShapeKind) => boolean;
  onPick: (k: ShapeKind) => void;
}) {
  const menu = useMenu();
  return (
    <>
      <button
        type="button"
        className="fx-st-btn"
        data-tip="Shape"
        aria-label="Shape"
        data-open={!!menu.anchor || undefined}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        {SHAPE_ICONS[current]}
        <ChevronDown size={10} />
      </button>
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close}>
          <div className="fx-shape-grid">
            {SHAPES.map((k) => (
              <button
                key={k}
                type="button"
                className="fx-shape-cell"
                data-active={k === current || undefined}
                disabled={!allowed(k)}
                title={allowed(k) ? SHAPE_LABELS[k] : `${SHAPE_LABELS[k]} (remove its text or connectors first)`}
                aria-label={SHAPE_LABELS[k]}
                onClick={() => {
                  menu.close();
                  onPick(k);
                }}
              >
                {SHAPE_ICONS[k]}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function FillButton({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const menu = useMenu();
  const mode = fillMode(value);
  return (
    <>
      <button
        type="button"
        className="fx-st-btn"
        data-tip="Fill"
        aria-label="Fill"
        data-open={!!menu.anchor || undefined}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        <Swatch value={value} />
        <ChevronDown size={10} />
      </button>
      {menu.anchor && (
        <ColorPopover
          anchor={menu.anchor}
          value={value}
          tabs={FILL_TABS}
          tab={mode}
          onTab={(m) => onChange(withFillMode(mode === "none" ? "#ffffff" : value, m))}
          onPick={(c) => onChange(withFillMode(c, mode === "none" ? "fill" : mode))}
          onClose={menu.close}
        />
      )}
    </>
  );
}

function StrokeButton({
  color,
  style,
  onChange,
}: {
  color: string;
  style: string;
  onChange: (p: { strokeColor?: string; strokeStyle?: string }) => void;
}) {
  const menu = useMenu();
  const mode: StrokeMode = color === "transparent" ? "none" : style === "dashed" ? "dashed" : "solid";
  return (
    <>
      <button
        type="button"
        className="fx-st-btn"
        data-tip="Outline"
        aria-label="Outline"
        data-open={!!menu.anchor || undefined}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        <StrokeIcon />
        <ChevronDown size={10} />
      </button>
      {menu.anchor && (
        <ColorPopover
          anchor={menu.anchor}
          value={color}
          tabs={STROKE_TABS}
          tab={mode}
          onTab={(t) =>
            onChange(
              t === "none"
                ? { strokeColor: "transparent" }
                : { strokeStyle: t, ...(color === "transparent" ? { strokeColor: "#1e1e1e" } : {}) },
            )
          }
          onPick={(c) => onChange({ strokeColor: c, ...(mode === "none" ? { strokeStyle: "solid" } : {}) })}
          onClose={menu.close}
        />
      )}
    </>
  );
}

function ColorButton<T extends string>({
  label,
  value,
  colors = PALETTE,
  tabs,
  tab,
  onTab,
  onPick,
}: {
  label: string;
  value: string;
  colors?: { name: string; value: string }[][];
  tabs?: { id: T; label: string; icon: ReactNode }[];
  tab?: T;
  onTab?: (t: T) => void;
  onPick: (color: string) => void;
}) {
  const menu = useMenu();
  return (
    <>
      <button
        type="button"
        className="fx-st-btn"
        data-tip={label}
        aria-label={label}
        data-open={!!menu.anchor || undefined}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        <Swatch value={baseColor(value)} />
        <ChevronDown size={10} />
      </button>
      {menu.anchor && (
        <ColorPopover
          anchor={menu.anchor}
          value={value}
          colors={colors}
          tabs={tabs}
          tab={tab}
          onTab={onTab}
          onPick={onPick}
          onClose={menu.close}
        />
      )}
    </>
  );
}

function Dropdown({
  label,
  display,
  entries,
  wide,
  noCaret,
}: {
  label: string;
  display: ReactNode;
  entries: MenuEntry[];
  wide?: boolean;
  noCaret?: boolean;
}) {
  const menu = useMenu();
  return (
    <>
      <button
        type="button"
        className="fx-st-btn"
        data-wide={wide || undefined}
        data-tip={label}
        aria-label={label}
        data-open={!!menu.anchor || undefined}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        {display}
        {!noCaret && <ChevronDown size={10} />}
      </button>
      {menu.anchor && <Menu anchor={menu.anchor} side="above" onClose={menu.close} entries={entries} />}
    </>
  );
}

/** Small dark popover above a button (used for the shape grid). */
function Popover({ anchor, onClose, children }: { anchor: DOMRect; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="fx-dark-pop"
      style={{ left: anchor.left + anchor.width / 2, top: anchor.top - 8 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}
