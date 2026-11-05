import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
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
  LINE_TABS,
  PALETTE,
  STICKY_COLORS,
  STROKE_TABS,
  baseColor,
  fillMode,
  strokeForFill,
  withFillMode,
  type StrokeMode,
  type Swatch,
} from "./Palette";
import {
  AlignIcon,
  BoldIcon,
  ChevronDown,
  FitIcon,
  FontIcon,
  LineStyleIcon,
  LinkIcon,
  ListIcon,
  LockIcon,
  ShapeSwitchIcon,
  StrikeIcon,
} from "./icons";
import { canConvert, convertShapes, SHAPE_LABELS, SHAPES, shapeOf, type ShapeKind } from "./shapes";
import { activeRichEditor, paragraphSizes, withoutSizes } from "./richText";
import { INTER_FONT, placeLabel, type TextLike } from "./textLayout";
import { SHAPE_ICONS } from "./Toolbar";

const PEN_WIDTHS = [
  { label: "Thin", value: 1 },
  { label: "Thick", value: 3 },
];

const LINE_WIDTHS = [
  { label: "Thin", value: 2 },
  { label: "Regular", value: 4 },
  { label: "Thick", value: 8 },
];

// FigJam's sizes (and how its menu previews them).
const FONT_SIZES = [
  { label: "Small", value: 16, preview: { fontSize: 12, lineHeight: "16px" } },
  { label: "Medium", value: 24, preview: { fontSize: 13, lineHeight: "24px" } },
  { label: "Large", value: 40, preview: { fontSize: 14, lineHeight: "24px" } },
  { label: "Extra large", value: 64, preview: { fontSize: 16, lineHeight: "24px" } },
  { label: "Huge", value: 96, preview: { fontSize: 18, lineHeight: "24px" } },
];

// lineHeight: each font's own (as Excalidraw sets it when the font changes).
const FONTS = [
  { label: "Simple", value: INTER_FONT, css: "Inter", weight: undefined as number | undefined, lineHeight: 1.5 },
  { label: "Rounded", value: FONT_FAMILY.Nunito, css: "Nunito", lineHeight: 1.35 },
  { label: "Handwritten", value: FONT_FAMILY.Excalifont, css: "Excalifont", lineHeight: 1.25 },
  { label: "Comic", value: FONT_FAMILY["Comic Shanns"], css: "Comic Shanns", lineHeight: 1.25 },
  { label: "Bookish", value: FONT_FAMILY["Lilita One"], css: "Lilita One", lineHeight: 1.15 },
  { label: "Technical", value: FONT_FAMILY.Cascadia, css: "Cascadia", lineHeight: 1.2 },
  { label: "Classic", value: FONT_FAMILY["Liberation Sans"], css: "Liberation Sans", lineHeight: 1.15 },
];

/** Text is measured when it changes, so the font has to be loaded first. */
async function ensureFont(css: string, weight = 400) {
  try {
    await Promise.race([document.fonts.load(`${weight} 20px "${css}"`), new Promise((r) => setTimeout(r, 3000))]);
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

/** Applies a change to the selected elements (and their text), as one undo step. */
function update(
  api: ExcalidrawImperativeAPI,
  patchSelected: ((el: ExcalidrawElement) => Patch | null) | null,
  patchText?: (el: ExcalidrawElement) => Patch | null,
) {
  const selectedIds = targetIds(api);
  const all = api.getSceneElementsIncludingDeleted();
  const remeasure: ExcalidrawElement[] = [];
  let next = all.map((el) => {
    let patch: Patch | null = null;
    const isLabel = el.type === "text" && el.containerId && selectedIds[el.containerId];
    if (selectedIds[el.id] && patchSelected && !isLabel) patch = patchSelected(el);
    if (!patch && patchText && el.type === "text" && (selectedIds[el.id] || isLabel)) patch = patchText(el);
    if (!patch) return el;
    const resizes = ["fontSize", "fontFamily", "lineHeight", "textAlign", "customData", "originalText"].some((k) => k in patch);
    // Re-wrap from the text as typed, not from its current line breaks (which
    // a bigger size may have added).
    const rewrap = el.type === "text" && resizes && !("text" in patch) ? { text: el.originalText } : {};
    const updated = newElementWith(el, { ...rewrap, ...patch } as never);
    if (el.type === "text" && resizes) remeasure.push(updated);
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
      const { width, height, text: wrapped, fontSize, customData } = t as TextLike & { text: string };
      // (customData carries the size of each line when the text has mixed sizes)
      const patch: Patch = { width, height, text: wrapped, fontSize, customData };
      // …and put labels back in place inside their shape (growing it if needed).
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

/** What the toolbar acts on: the selection, or the text being typed (and its shape). */
function targetIds(api: ExcalidrawImperativeAPI): Record<string, true> {
  const s = api.getAppState();
  const ids = { ...(s.selectedElementIds as Record<string, true>) };
  const editing = s.editingTextElement as (ExcalidrawElement & { containerId?: string | null }) | null;
  if (editing) {
    ids[editing.id] = true;
    if (editing.containerId) ids[editing.containerId] = true;
  }
  return ids;
}

const GAP = 36; // between the selection and the toolbar
const HEIGHT = 40;
const EDGE = 8;
const SECTION_PILL = 34; // the name pill above a section

export function SelectionToolbar({ api }: { api: ExcalidrawImperativeAPI }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const lastKey = useRef("");
  const dragging = useRef(false);
  const bar = useRef<HTMLDivElement>(null);
  const centerX = useRef(0);

  useEffect(() => {
    const check = () => {
      const s = api.getAppState();
      const ids = targetIds(api);
      const editing = !!s.editingTextElement;
      let key = "";
      // Shown while typing too, like FigJam (the text tool stays picked while typing new text).
      if (Object.keys(ids).length && !dragging.current && (s.activeTool.type === "selection" || editing)) {
        const versions = api
          .getSceneElements()
          .filter((el) => ids[el.id] || (el.type === "text" && el.containerId && ids[el.containerId]))
          .map((el) => `${el.id}:${el.version}`)
          .join(",");
        // While typing, the size shown follows the selected lines.
        const sizes = editing ? (activeRichEditor()?.selectedSizes().join("/") ?? "") : "";
        key = `${versions}|${sizes}|${s.scrollX}|${s.scrollY}|${s.zoom.value}|${s.width}|${s.height}`;
      }
      if (key !== lastKey.current) {
        lastKey.current = key;
        rerender();
      }
    };
    document.addEventListener("selectionchange", check);
    const offs = [
      () => document.removeEventListener("selectionchange", check),
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

  // Keep the bar on screen once its width is known.
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const w = el.offsetWidth;
    el.style.left = `${Math.max(EDGE, Math.min(centerX.current - w / 2, window.innerWidth - w - EDGE))}px`;
  });

  if (!lastKey.current) return null;

  const s = api.getAppState();
  const elements = api.getSceneElements();
  const ids = targetIds(api);
  const isLabel = (el: ExcalidrawElement) => el.type === "text" && !!el.containerId && !!ids[el.containerId];
  const selected = elements.filter((el) => ids[el.id] && !isLabel(el));
  if (!selected.length) return null;
  const labels = elements.filter(isLabel);
  const editor = s.editingTextElement ? activeRichEditor() : null;
  const kinds = new Set(selected.map(kindOf));
  const only = (...k: Kind[]) => [...kinds].every((x) => k.includes(x));

  const [x1, y1, x2, y2] = getCommonBounds([...selected, ...labels]);
  const top = sceneCoordsToViewportCoords({ sceneX: (x1 + x2) / 2, sceneY: y1 }, s);
  const bottom = sceneCoordsToViewportCoords({ sceneX: (x1 + x2) / 2, sceneY: y2 }, s);
  // Like FigJam: above the selection, or under it when there's no room above.
  const lift = selected.some((el) => kindOf(el) === "section") ? SECTION_PILL : 0;
  const belowTop = bottom.y + GAP;
  const aboveTop = top.y - lift - GAP - HEIGHT;
  const roomBelow = belowTop + HEIGHT <= window.innerHeight - 72;
  const roomAbove = aboveTop >= 68;
  const below = !roomAbove && roomBelow;
  const barTop = below ? belowTop : Math.max(aboveTop, 68);
  centerX.current = top.x;
  const side = below ? "below" : "above";

  const first = selected[0];
  const text = (selected.find((el) => el.type === "text") ?? labels[0]) as TextLike | undefined;
  const groups: ReactNode[][] = [];

  if (only("shape")) {
    const current = shapeOf(first)!;
    groups.push([
      <ShapeSwitch
        key="shape"
        side={side}
        current={current}
        allowed={(k) => selected.every((el) => canConvert(el, k))}
        onPick={(k) => convertShapes(api, k)}
      />,
    ]);
    groups.push([
      <FillButton
        key="fill"
        side={side}
        value={first.backgroundColor}
        onChange={(c) =>
          update(api, (el) => {
            const stroke = el.strokeColor !== "transparent" && strokeForFill(c === "transparent" ? "#ffffff" : c);
            return { backgroundColor: c, fillStyle: "solid", ...(stroke ? { strokeColor: stroke } : {}) };
          })
        }
      />,
      <StrokeButton key="stroke" side={side} color={first.strokeColor} style={first.strokeStyle} onChange={(p) => update(api, () => p)} />,
    ]);
  } else if (only("section")) {
    groups.push([
      <FillButton key="fill" side={side} value={first.backgroundColor} onChange={(c) => update(api, () => ({ backgroundColor: c }))} />,
      <StrokeButton key="stroke" side={side} color={first.strokeColor} style="solid" onChange={(p) => update(api, () => p)} />,
    ]);
    groups.push([
      <IconButton key="fit" label="Resize to fit contents" icon={<FitIcon />} onClick={() => fitSections(api, selected)} />,
      <Toggle
        key="lock"
        label={first.locked ? "Unlock section" : "Lock section"}
        on={!!first.locked}
        icon={<LockIcon open={!first.locked} />}
        onClick={() => update(api, () => ({ locked: !first.locked }))}
      />,
    ]);
  } else if (only("sticky")) {
    groups.push([
      <ColorButton
        key="sticky"
        side={side}
        label="Change color"
        value={first.backgroundColor}
        colors={[STICKY_COLORS]}
        custom={false}
        onPick={(c) => update(api, () => ({ backgroundColor: c }))}
      />,
    ]);
  } else if (only("text")) {
    groups.push([
      <ColorButton key="ink" side={side} label="Text color" value={first.strokeColor} onPick={(c) => update(api, () => ({ strokeColor: c }))} />,
    ]);
  } else if (only("line", "pen")) {
    const widths = only("pen") ? PEN_WIDTHS : LINE_WIDTHS;
    groups.push([
      <ColorButton
        key="ink"
        side={side}
        label="Change color"
        value={first.strokeColor}
        tabs={only("line") ? LINE_TABS : undefined}
        tab={first.strokeStyle === "dashed" ? "dashed" : first.strokeStyle === "dotted" ? "dotted" : "solid"}
        onTab={(t) => update(api, () => ({ strokeStyle: t }))}
        onPick={(c) => update(api, () => ({ strokeColor: c }))}
      />,
      <Dropdown
        key="width"
        side={side}
        label="Thickness"
        display={<LineStyleIcon />}
        entries={widths.map((o) => ({
          label: o.label,
          checked: first.strokeWidth === o.value,
          onSelect: () => update(api, () => ({ strokeWidth: o.value })),
        }))}
      />,
    ]);
  }

  if (text && only("text", "sticky", "shape")) {
    // Sizes in play: of the selected lines while typing, of the whole text otherwise.
    const inPlay = editor ? editor.selectedSizes() : [...new Set(paragraphSizes(text) ?? [text.fontSize])];
    const mixed = inPlay.length > 1;
    const size = FONT_SIZES.find((f) => f.value === inPlay[0]);
    // A size typed in shows as its number, like FigJam (and the menu then lists each preset's size).
    const custom = !mixed && !size;
    const sizeLabel = mixed ? "Mixed sizes" : (size?.label ?? `${inPlay[0]}`);
    const applySize = (value: number) => {
      const font = FONTS.find((x) => x.value === text.fontFamily);
      void (font ? ensureFont(font.css, font.weight) : Promise.resolve()).then(() => {
        // While typing: just the selected lines (like FigJam). Otherwise: all of it.
        const typing = activeRichEditor();
        if (typing) typing.setSelectedSize(value);
        else update(api, null, (el) => ({ fontSize: value, customData: withoutSizes(el.customData) }));
      });
    };
    const font = FONTS.find((f) => f.value === text.fontFamily);
    groups.push([
      <Dropdown
        key="font"
        side={side}
        label={`Typeface${font ? `, ${font.label.toLowerCase()}` : ""}`}
        display={<FontIcon />}
        entries={FONTS.map((f) => ({
          label: f.label,
          labelStyle: { fontFamily: `"${f.css}", var(--fx-font)`, fontWeight: f.weight, fontSize: 13 },
          checked: text.fontFamily === f.value,
          onSelect: () =>
            void ensureFont(f.css, f.weight).then(() => update(api, null, () => ({ fontFamily: f.value, lineHeight: f.lineHeight }))),
        }))}
      />,
    ]);
    groups.push([
      <Dropdown
        key="size"
        side={side}
        label="Font size"
        wide
        display={<span className="fx-st-text">{sizeLabel}</span>}
        entries={FONT_SIZES.map((f) => ({
          label: f.label,
          labelStyle: f.preview,
          shortcut: custom ? String(f.value) : undefined,
          checked: !mixed && inPlay[0] === f.value,
          onSelect: () => applySize(f.value),
        }))}
        footer={<SizeField value={mixed ? null : inPlay[0]} onApply={applySize} />}
      />,
    ]);
    groups.push([
      <Toggle
        key="bold"
        label="Bold"
        on={!!text.customData?.bold}
        icon={<BoldIcon />}
        onClick={() => update(api, null, (el) => ({ customData: { ...el.customData, bold: !text.customData?.bold } }))}
      />,
      <Toggle
        key="strike"
        label="Strikethrough"
        on={!!text.customData?.strike}
        icon={<StrikeIcon />}
        onClick={() => update(api, null, (el) => ({ customData: { ...el.customData, strike: !text.customData?.strike } }))}
      />,
      <LinkButton key="link" side={side} value={first.link ?? ""} onChange={(link) => update(api, () => ({ link }))} />,
      <Toggle
        key="list"
        label="Bulleted list"
        on={hasBullets(text)}
        icon={<ListIcon />}
        onClick={() => {
          const add = !hasBullets(text);
          update(api, null, (el) => {
            const next = toggleBullets((el as TextLike & { originalText: string }).originalText, add);
            return { originalText: next, text: next };
          });
        }}
      />,
    ]);
    // Sticky notes keep their text at the top left, like FigJam.
    if (!only("sticky"))
      groups.push([
        <Dropdown
          key="align"
          side={side}
          label="Text alignment"
          display={<AlignIcon align={(text.textAlign as "left") ?? "center"} />}
          entries={ALIGNS.map((a) => ({
            label: a.label,
            checked: text.textAlign === a.value,
            onSelect: () => update(api, null, () => ({ textAlign: a.value })),
          }))}
        />,
      ]);
  }

  if (!groups.length) return null;

  return (
    <div
      ref={bar}
      className="fx-selection-toolbar"
      role="toolbar"
      aria-label="Selection properties"
      style={{ top: barTop, left: centerX.current }}
      // Keep focus where it is (canvas or text being typed), except for fields in
      // menus opened from here (React passes their events up through this bar).
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
    >
      {groups.map((group, i) => [i > 0 && <span key={`d${i}`} className="fx-st-divider" />, ...group])}
    </div>
  );
}

// ---- Controls ----------------------------------------------------------------

type Side = "above" | "below";

function Swatch({ value }: { value: string }) {
  return (
    <span className="fx-st-swatch-ring">
      <span className="fx-st-swatch" data-none={value === "transparent" || undefined} style={{ ["--c" as string]: value }} />
    </span>
  );
}

/** A full-height button with the visible (hover) area inside it, like FigJam. */
function StButton({
  label,
  tip,
  open,
  on,
  wide,
  square,
  onClick,
  children,
}: {
  label: string;
  tip?: string;
  open?: boolean;
  on?: boolean;
  wide?: boolean;
  square?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="fx-st-btn"
      data-tip={tip ?? label}
      aria-label={label}
      aria-pressed={on}
      data-open={open || undefined}
      data-on={on || undefined}
      data-wide={wide || undefined}
      data-square={square || undefined}
      onClick={onClick}
    >
      <span className="fx-st-inner">{children}</span>
    </button>
  );
}

function IconButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <StButton label={label} square onClick={onClick}>
      {icon}
    </StButton>
  );
}

function Toggle({ label, on, icon, onClick }: { label: string; on: boolean; icon: ReactNode; onClick: () => void }) {
  return (
    <StButton label={label} on={on} square onClick={onClick}>
      {icon}
    </StButton>
  );
}

function ShapeSwitch({
  side,
  current,
  allowed,
  onPick,
}: {
  side: Side;
  current: ShapeKind;
  allowed: (k: ShapeKind) => boolean;
  onPick: (k: ShapeKind) => void;
}) {
  const menu = useMenu();
  return (
    <>
      <StButton label={`Shape, ${SHAPE_LABELS[current].toLowerCase()}`} tip="Shape" open={!!menu.anchor} onClick={(e) => menu.toggle(e.currentTarget)}>
        <ShapeSwitchIcon />
        <ChevronDown />
      </StButton>
      {menu.anchor && (
        <Popover anchor={menu.anchor} side={side} onClose={menu.close}>
          <div className="fx-shape-grid">
            {SHAPES.map((k) => (
              <button
                key={k}
                type="button"
                className="fx-shape-cell"
                data-active={k === current || undefined}
                disabled={!allowed(k)}
                data-tip={allowed(k) ? SHAPE_LABELS[k] : `${SHAPE_LABELS[k]} (remove its text or connectors first)`}
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

function FillButton({ side, value, onChange }: { side: Side; value: string; onChange: (color: string) => void }) {
  const menu = useMenu();
  const mode = fillMode(value);
  return (
    <>
      <StButton label="Change color" open={!!menu.anchor} onClick={(e) => menu.toggle(e.currentTarget)}>
        <Swatch value={value} />
        <ChevronDown />
      </StButton>
      {menu.anchor && (
        <ColorPopover
          anchor={menu.anchor}
          side={side}
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
  side,
  color,
  style,
  onChange,
}: {
  side: Side;
  color: string;
  style: string;
  onChange: (p: { strokeColor?: string; strokeStyle?: string }) => void;
}) {
  const menu = useMenu();
  const mode: StrokeMode = color === "transparent" ? "none" : style === "dashed" ? "dashed" : "solid";
  return (
    <>
      <StButton label="Line style" open={!!menu.anchor} onClick={(e) => menu.toggle(e.currentTarget)}>
        <LineStyleIcon />
        <ChevronDown />
      </StButton>
      {menu.anchor && (
        <ColorPopover
          anchor={menu.anchor}
          side={side}
          value={color}
          tabs={STROKE_TABS}
          tab={mode}
          onTab={(t) =>
            onChange(
              t === "none"
                ? { strokeColor: "transparent" }
                : { strokeStyle: t, ...(color === "transparent" ? { strokeColor: "#757575" } : {}) },
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
  side,
  label,
  value,
  colors = PALETTE,
  custom,
  tabs,
  tab,
  onTab,
  onPick,
}: {
  side: Side;
  label: string;
  value: string;
  colors?: Swatch[][];
  custom?: boolean;
  tabs?: { id: T; label: string; icon: ReactNode }[];
  tab?: T;
  onTab?: (t: T) => void;
  onPick: (color: string) => void;
}) {
  const menu = useMenu();
  return (
    <>
      <StButton label={label} open={!!menu.anchor} onClick={(e) => menu.toggle(e.currentTarget)}>
        <Swatch value={baseColor(value)} />
        <ChevronDown />
      </StButton>
      {menu.anchor && (
        <ColorPopover
          anchor={menu.anchor}
          side={side}
          value={value}
          colors={colors}
          custom={custom}
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
  footer,
}: {
  side: Side;
  label: string;
  display: ReactNode;
  entries: MenuEntry[];
  wide?: boolean;
  footer?: ReactNode;
}) {
  const menu = useMenu();
  const close = () => {
    menu.close();
    // While typing in a shape, go back to the text (a field in the menu may have had focus).
    const typing = activeRichEditor();
    if (typing && document.activeElement !== typing) typing.focus();
  };
  return (
    <>
      <StButton label={label} tip={label.split(",")[0]} wide={wide} open={!!menu.anchor} onClick={(e) => menu.toggle(e.currentTarget)}>
        {display}
        <ChevronDown />
      </StButton>
      {/* Like FigJam, pickers open under the toolbar (above it only when there's no room). */}
      {menu.anchor && <Menu anchor={menu.anchor} side="below" compact onClose={close} entries={entries} footer={footer} />}
    </>
  );
}

const MIN_SIZE = 1;
const MAX_SIZE = 1000;

/**
 * FigJam's "type a size" field at the bottom of the size menu. The size applies as
 * you type (and right away on Enter); empty with "Size" when the text has several.
 * (The class names tell Excalidraw's text editor that clicking here doesn't end typing.)
 */
function SizeField({ value, onApply }: { value: number | null; onApply: (size: number) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => {
    if (document.activeElement !== input.current) setDraft(value === null ? "" : String(value));
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const apply = (raw: string, now: boolean) => {
    window.clearTimeout(timer.current);
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < MIN_SIZE) return;
    const size = Math.min(MAX_SIZE, Math.round(n * 10) / 10);
    if (now) onApply(size);
    else timer.current = window.setTimeout(() => onApply(size), 250);
  };
  return (
    <div className="fx-menu-field properties-content">
      <input
        ref={input}
        className="fx-size-input properties-trigger"
        type="number"
        inputMode="decimal"
        min={MIN_SIZE}
        max={MAX_SIZE}
        placeholder="Size"
        aria-label="Custom font size"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          apply(e.target.value, false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply(draft, true);
          }
        }}
      />
    </div>
  );
}

const BULLET = "• ";

function hasBullets(text: TextLike): boolean {
  const lines = ((text as TextLike & { originalText?: string }).originalText ?? "").split("\n").filter((l) => l.trim());
  return lines.length > 0 && lines.every((l) => l.startsWith(BULLET));
}

/** Adds or removes "• " at the start of every non-empty line. */
function toggleBullets(source: string, add: boolean): string {
  return source
    .split("\n")
    .map((line) => {
      if (!line.trim()) return line;
      if (add) return line.startsWith(BULLET) ? line : BULLET + line;
      return line.startsWith(BULLET) ? line.slice(BULLET.length) : line;
    })
    .join("\n");
}

/** Shrinks or grows sections to wrap what's inside them, with some room. */
function fitSections(api: ExcalidrawImperativeAPI, sections: readonly ExcalidrawElement[]) {
  const ROOM = 40;
  const ids = new Set(sections.map((s) => s.id));
  const all = api.getSceneElementsIncludingDeleted();
  const next = all.map((el) => {
    if (!ids.has(el.id)) return el;
    const inside = all.filter((c) => !c.isDeleted && c.frameId === el.id);
    if (!inside.length) return el;
    const [x1, y1, x2, y2] = getCommonBounds(inside);
    return newElementWith(el, {
      x: x1 - ROOM,
      y: y1 - ROOM,
      width: x2 - x1 + ROOM * 2,
      height: y2 - y1 + ROOM * 2,
    } as never);
  });
  api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
}

function LinkButton({ side, value, onChange }: { side: Side; value: string; onChange: (link: string | null) => void }) {
  const menu = useMenu();
  const [draft, setDraft] = useState(value);
  const save = () => {
    const url = draft.trim();
    onChange(url ? (/^[a-z][\w+.-]*:/i.test(url) ? url : `https://${url}`) : null);
    menu.close();
  };
  return (
    <>
      <StButton
        label={value ? "Edit link" : "Create link"}
        on={!!value}
        open={!!menu.anchor}
        square
        onClick={(e) => {
          setDraft(value);
          menu.toggle(e.currentTarget);
        }}
      >
        <LinkIcon />
      </StButton>
      {menu.anchor && (
        <Popover anchor={menu.anchor} side={side} onClose={menu.close} allowInput>
          <form
            className="fx-link-form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              className="fx-link-input"
              value={draft}
              placeholder="Paste a link"
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button type="submit" className="fx-link-save">
              Save
            </button>
            {value && (
              <button
                type="button"
                className="fx-link-remove"
                onClick={() => {
                  onChange(null);
                  menu.close();
                }}
              >
                Remove
              </button>
            )}
          </form>
        </Popover>
      )}
    </>
  );
}

/** Small dark popover next to a toolbar button (shape grid, link field). */
function Popover({
  anchor,
  side,
  onClose,
  children,
  allowInput,
}: {
  anchor: DOMRect;
  side: Side;
  onClose: () => void;
  children: ReactNode;
  /** Let clicks focus inputs inside (otherwise the canvas keeps focus). */
  allowInput?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.top });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const bar = el.parentElement?.closest(".fx-selection-toolbar")?.getBoundingClientRect() ?? anchor;
    let top = side === "above" ? bar.top - height - 8 : bar.bottom + 8;
    if (top < 8) top = bar.bottom + 8;
    if (top + height > window.innerHeight - 8) top = bar.top - height - 8;
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 8));
    setPos({ left, top });
  }, [anchor, side]);
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
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => {
        if (!(allowInput && e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
    >
      {children}
    </div>
  );
}
