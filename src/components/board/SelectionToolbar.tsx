import { useEffect, useReducer, useRef, type ReactNode } from "react";
import {
  CaptureUpdateAction,
  getCommonBounds,
  newElementWith,
  restoreElements,
  sceneCoordsToViewportCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Menu, useMenu } from "./Menu";
import { ChevronDown, TrashIcon } from "./icons";

// Palettes picked for this app.
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

const FILL_COLORS = [{ name: "None", value: "transparent" }, ...STICKY_COLORS];

const INK_COLORS = [
  { name: "Black", value: "#1e1e1e" },
  { name: "Gray", value: "#8a8a8a" },
  { name: "Red", value: "#e5484d" },
  { name: "Orange", value: "#f2994a" },
  { name: "Yellow", value: "#e8b400" },
  { name: "Green", value: "#2ea043" },
  { name: "Blue", value: "#0d99ff" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Pink", value: "#e84bb3" },
  { name: "White", value: "#ffffff" },
];

const STROKES = [
  { label: "Thin", value: 1 },
  { label: "Medium", value: 2 },
  { label: "Thick", value: 4 },
];

const FONT_SIZES = [
  { label: "Small", short: "S", value: 16 },
  { label: "Medium", short: "M", value: 20 },
  { label: "Large", short: "L", value: 28 },
  { label: "Extra large", short: "XL", value: 36 },
];

type Kind = "sticky" | "shape" | "text" | "line" | "pen" | "image" | "section" | "other";

function kindOf(el: ExcalidrawElement): Kind {
  if (el.customData?.kind === "sticky") return "sticky";
  switch (el.type) {
    case "rectangle":
    case "ellipse":
    case "diamond":
      return "shape";
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

/** Applies a change to the selected elements (and their labels), as one undo step. */
function update(
  api: ExcalidrawImperativeAPI,
  patchSelected: ((el: ExcalidrawElement) => Patch | null) | null,
  patchLabels?: (el: ExcalidrawElement) => Patch | null,
) {
  const selectedIds = api.getAppState().selectedElementIds;
  const all = api.getSceneElementsIncludingDeleted();
  const changedText: ExcalidrawElement[] = [];
  let next = all.map((el) => {
    let patch: Patch | null = null;
    if (selectedIds[el.id] && patchSelected) patch = patchSelected(el);
    const isLabel = el.type === "text" && el.containerId && selectedIds[el.containerId];
    if (!patch && patchLabels && (selectedIds[el.id] || isLabel) && el.type === "text") patch = patchLabels(el);
    if (!patch) return el;
    const updated = newElementWith(el, patch as never);
    if (el.type === "text" && "fontSize" in patch) changedText.push(updated);
    return updated;
  });
  if (changedText.length) {
    // Re-measure text after a size change (labels need their container).
    const byId = new Map<string, ExcalidrawElement>(next.map((el) => [el.id, el]));
    const containers: ExcalidrawElement[] = [];
    for (const t of changedText) {
      const container = t.type === "text" && t.containerId ? byId.get(t.containerId) : undefined;
      if (container) containers.push(container);
    }
    const refreshed = restoreElements([...changedText, ...containers], null, { refreshDimensions: true });
    const fresh = new Map<string, ExcalidrawElement>(
      refreshed.filter((el) => el.type === "text").map((el) => [el.id, el]),
    );
    next = next.map((el) => (fresh.get(el.id) as typeof el | undefined) ?? el);
  }
  api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
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
          .filter((el) => s.selectedElementIds[el.id])
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
  const above = top.y - 56 > 64;
  const style = {
    left: Math.min(Math.max(top.x, 160), window.innerWidth - 160),
    top: above ? top.y - 52 : Math.min(bottom.y + 12, window.innerHeight - 140),
  };

  const first = selected[0];
  const firstText = (selected.find((el) => el.type === "text") ?? labels[0]) as
    | (ExcalidrawElement & { fontSize: number })
    | undefined;

  const showFill = only("sticky", "shape");
  const showInk = only("text", "line", "pen", "shape");
  const showStroke = only("line", "pen", "shape");
  const showSize = only("text", "sticky", "shape") && !!firstText;

  return (
    <div className="fx-panel fx-selection-toolbar" style={style} onMouseDown={(e) => e.preventDefault()}>
      {showFill && (
        <ColorPicker
          label={only("sticky") ? "Color" : "Fill"}
          value={first.backgroundColor}
          colors={only("sticky") ? STICKY_COLORS : FILL_COLORS}
          onPick={(c) => update(api, () => ({ backgroundColor: c, fillStyle: "solid" }))}
        />
      )}
      {showInk && (
        <ColorPicker
          label={only("text") ? "Text color" : "Stroke"}
          value={first.strokeColor}
          ring
          colors={INK_COLORS}
          onPick={(c) =>
            update(
              api,
              (el) => (el.type === "text" || kindOf(el) !== "sticky" ? { strokeColor: c } : null),
              () => (only("text") ? { strokeColor: c } : null),
            )
          }
        />
      )}
      {showStroke && (
        <Dropdown
          label="Stroke width"
          display={<span className="fx-stroke-sample" style={{ height: Math.max(1, first.strokeWidth) }} />}
          options={STROKES.map((o) => ({
            label: o.label,
            checked: first.strokeWidth === o.value,
            onSelect: () => update(api, () => ({ strokeWidth: o.value })),
          }))}
        />
      )}
      {showSize && firstText && (
        <Dropdown
          label="Text size"
          display={<span className="fx-size-label">{FONT_SIZES.find((f) => f.value === firstText.fontSize)?.short ?? Math.round(firstText.fontSize)}</span>}
          options={FONT_SIZES.map((o) => ({
            label: o.label,
            checked: firstText.fontSize === o.value,
            onSelect: () => update(api, null, () => ({ fontSize: o.value })),
          }))}
        />
      )}
      {(showFill || showInk || showStroke || showSize) && <span className="fx-panel-divider" />}
      <button
        type="button"
        className="fx-icon-button"
        data-tip="Delete  Del"
        aria-label="Delete"
        onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }))}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function ColorPicker({
  label,
  value,
  colors,
  ring,
  onPick,
}: {
  label: string;
  value: string;
  colors: { name: string; value: string }[];
  ring?: boolean;
  onPick: (color: string) => void;
}) {
  const menu = useMenu();
  return (
    <>
      <button
        type="button"
        className="fx-swatch-button"
        data-tip={label}
        aria-label={label}
        data-open={!!menu.anchor || undefined}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        <span className="fx-swatch" data-ring={ring || undefined} data-none={value === "transparent" || undefined} style={{ ["--c" as string]: value }} />
      </button>
      {menu.anchor && (
        <SwatchPopover anchor={menu.anchor} colors={colors} value={value} ring={ring} onClose={menu.close} onPick={onPick} />
      )}
    </>
  );
}

function SwatchPopover({
  anchor,
  colors,
  value,
  ring,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  colors: { name: string; value: string }[];
  value: string;
  ring?: boolean;
  onPick: (c: string) => void;
  onClose: () => void;
}) {
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
      className="fx-panel fx-swatches"
      style={{ left: anchor.left + anchor.width / 2, top: anchor.top - 8 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {colors.map((c) => (
        <button
          key={c.value}
          type="button"
          className="fx-swatch-button"
          data-tip={c.name}
          aria-label={c.name}
          data-selected={c.value.toLowerCase() === value.toLowerCase() || undefined}
          onClick={() => {
            onPick(c.value);
            onClose();
          }}
        >
          <span className="fx-swatch" data-ring={ring || undefined} data-none={c.value === "transparent" || undefined} style={{ ["--c" as string]: c.value }} />
        </button>
      ))}
    </div>
  );
}

function Dropdown({
  label,
  display,
  options,
}: {
  label: string;
  display: ReactNode;
  options: { label: string; checked: boolean; onSelect: () => void }[];
}) {
  const menu = useMenu();
  return (
    <>
      <button
        type="button"
        className="fx-dropdown-button"
        data-tip={label}
        aria-label={label}
        data-open={!!menu.anchor || undefined}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        {display}
        <ChevronDown size={10} />
      </button>
      {menu.anchor && <Menu anchor={menu.anchor} side="above" onClose={menu.close} entries={options} />}
    </>
  );
}
