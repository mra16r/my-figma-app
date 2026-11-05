import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useMenu } from "./Menu";
import { ColorPopover, FILL_TABS, MARKER_COLORS, STICKY_COLORS, fillMode, strokeForFill, withFillMode, type Swatch } from "./Palette";
import {
  ArrowTool,
  Caret,
  CurvedTool,
  DiamondTool,
  ElbowTool,
  EllipseTool,
  EraserMini,
  HandTool,
  ImageTool,
  LineTool,
  MarkerArt,
  MarkerMini,
  MoveTool,
  RoundedShape,
  SectionTool,
  ShapesArt,
  SquareShape,
  StickyArt,
  TextTool,
  ThickLine,
  ThinLine,
  TriangleDownShape,
  TriangleShape,
} from "./icons";
import { activeShape, CONNECTORS, isConnector, selectShape, SHAPE_LABELS, SHAPES, type ShapeKind } from "./shapes";
import { applyToolStyle, MARKER_THICK, MARKER_THIN, setToolStyles, useToolStyles } from "./toolStyles";

export type ToolId = "selection" | "hand" | "freedraw" | "eraser" | "sticky" | "shapes" | "text" | "frame" | "image";

type Tool = { id: ToolId; label: string; shortcut?: string; icon?: ReactNode };

export const TOOLS: Record<ToolId, Tool> = {
  selection: { id: "selection", label: "Select", shortcut: "V", icon: <MoveTool /> },
  hand: { id: "hand", label: "Hand tool", shortcut: "H", icon: <HandTool /> },
  freedraw: { id: "freedraw", label: "Marker", shortcut: "P" },
  eraser: { id: "eraser", label: "Eraser", shortcut: "E" },
  sticky: { id: "sticky", label: "Sticky note", shortcut: "S" },
  shapes: { id: "shapes", label: "Shapes and connectors", shortcut: "R" },
  text: { id: "text", label: "Text", shortcut: "T", icon: <TextTool /> },
  frame: { id: "frame", label: "Section", shortcut: "Shift+S", icon: <SectionTool /> },
  image: { id: "image", label: "Place image", icon: <ImageTool /> },
};

export const SHAPE_ICONS: Record<ShapeKind, ReactNode> = {
  elbow: <ElbowTool />,
  curved: <CurvedTool />,
  straight: <ArrowTool />,
  line: <LineTool />,
  square: <SquareShape />,
  rounded: <RoundedShape />,
  circle: <EllipseTool />,
  diamond: <DiamondTool />,
  triangle: <TriangleShape />,
  "triangle-down": <TriangleDownShape />,
};

const SHAPE_KEYS: Partial<Record<ShapeKind, string>> = {
  elbow: "X",
  line: "L",
  square: "R",
  circle: "O",
  diamond: "D",
};

/** Selects a tool from the bottom toolbar (shapes: the last shape used). */
export function selectTool(api: ExcalidrawImperativeAPI, id: ToolId, lastShape: ShapeKind = "square"): void {
  if (id === "sticky") api.setActiveTool({ type: "custom", customType: "sticky" });
  else if (id === "shapes") selectShape(api, lastShape);
  else api.setActiveTool({ type: id });
  applyToolStyle(api);
}

/** The tool currently active in the canvas, in toolbar terms. */
export function activeToolId(api: ExcalidrawImperativeAPI): ToolId {
  if (activeShape(api)) return "shapes";
  const tool = api.getAppState().activeTool;
  if (tool.type === "custom") return tool.customType === "sticky" ? "sticky" : "selection";
  return (tool.type in TOOLS ? tool.type : "selection") as ToolId;
}

export function Toolbar({ api }: { api: ExcalidrawImperativeAPI }) {
  const [active, setActive] = useState<ToolId>(() => activeToolId(api));
  const [shape, setShape] = useState<ShapeKind | null>(() => activeShape(api));
  const [lastShape, setLastShape] = useState<ShapeKind>("square");
  const styles = useToolStyles();

  useEffect(() => {
    const sync = () => {
      const tool = activeToolId(api);
      const s = activeShape(api);
      setActive((cur) => (cur === tool ? cur : tool));
      setShape((cur) => (cur === s ? cur : s));
      if (s) setLastShape(s);
      applyToolStyle(api); // also when a tool was picked with a keyboard shortcut
    };
    sync();
    return api.onChange(sync);
  }, [api]);

  const choose = (id: ToolId) => {
    selectTool(api, id, lastShape);
    setActive(id);
  };

  const marker = active === "freedraw" || active === "eraser";
  return (
    <div className="fx-toolbar-stack">
      {marker && <MarkerTray api={api} eraser={active === "eraser"} />}
      {active === "sticky" && <StickyTray />}
      {active === "shapes" && <ShapeTray api={api} current={shape} />}
      <div className="fx-panel fx-toolbar" role="toolbar" aria-label="Tools">
        <ToolButton tool={TOOLS.selection} active={active === "selection"} onClick={() => choose("selection")} />
        <ToolButton tool={TOOLS.hand} active={active === "hand"} onClick={() => choose("hand")} />
        <span className="fx-divider" />
        <CreateButton
          kind="marker"
          tool={TOOLS.freedraw}
          active={marker}
          onClick={() => choose(active === "eraser" ? "eraser" : "freedraw")}
          art={<MarkerArt color={styles.markerColor} />}
        />
        <CreateButton kind="sticky" tool={TOOLS.sticky} active={active === "sticky"} onClick={() => choose("sticky")} art={<StickyArt color={styles.stickyColor} />} />
        <CreateButton
          kind="shapes"
          tool={TOOLS.shapes}
          active={active === "shapes"}
          onClick={() => choose("shapes")}
          art={
            <ShapesArt
              fill={styles.shapeFill === "transparent" ? "#fff" : styles.shapeFill}
              stroke={strokeForFill(styles.shapeFill) ?? "#757575"}
            />
          }
        />
        <span className="fx-divider" />
        <ToolButton tool={TOOLS.text} active={active === "text"} onClick={() => choose("text")} />
        <ToolButton tool={TOOLS.frame} active={active === "frame"} onClick={() => choose("frame")} />
        <ToolButton tool={TOOLS.image} active={active === "image"} onClick={() => choose("image")} />
      </div>
    </div>
  );
}

const tipFor = (tool: Tool) => (tool.shortcut ? `${tool.label}  ${tool.shortcut}` : tool.label);

function ToolButton({ tool, active, onClick }: { tool: Tool; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="fx-tool"
      data-tool={tool.id}
      data-active={active || undefined}
      data-tip={tipFor(tool)}
      aria-label={tool.label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {tool.icon}
    </button>
  );
}

/** The marker, sticky notes and shapes: pictures that rise when picked. */
function CreateButton({
  kind,
  tool,
  active,
  onClick,
  art,
}: {
  kind: "marker" | "sticky" | "shapes";
  tool: Tool;
  active: boolean;
  onClick: () => void;
  art: ReactNode;
}) {
  return (
    <button
      type="button"
      className="fx-create"
      data-kind={kind}
      data-active={active || undefined}
      data-tip={tipFor(tool)}
      aria-label={tool.label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <span className="fx-create-art">{art}</span>
    </button>
  );
}

// ---- Trays (the row above the toolbar while a drawing tool is picked) ----

function ColorDots({ colors, value, onPick, label }: { colors: Swatch[]; value: string; onPick: (c: string) => void; label: string }) {
  return (
    <div className="fx-tray-colors" role="radiogroup" aria-label={label}>
      {colors.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={c.value.toLowerCase() === value.toLowerCase()}
          className="fx-tray-dot"
          data-selected={c.value.toLowerCase() === value.toLowerCase() || undefined}
          data-tip={c.name}
          aria-label={c.name}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c.value)}
        >
          <span style={{ ["--c" as string]: c.value }} />
        </button>
      ))}
    </div>
  );
}

function MarkerTray({ api, eraser }: { api: ExcalidrawImperativeAPI; eraser: boolean }) {
  const styles = useToolStyles();
  const custom = useRef<HTMLInputElement>(null);
  const pickColor = (c: string) => {
    setToolStyles({ markerColor: c });
    if (eraser) api.setActiveTool({ type: "freedraw" });
    applyToolStyle(api);
  };
  const pickWidth = (w: number) => {
    setToolStyles({ markerWidth: w });
    if (eraser) api.setActiveTool({ type: "freedraw" });
    applyToolStyle(api);
  };
  const known = MARKER_COLORS.some((c) => c.value.toLowerCase() === styles.markerColor.toLowerCase());
  return (
    <div className="fx-panel fx-tray" role="toolbar" aria-label="Marker">
      <button
        type="button"
        className="fx-tray-pick"
        data-active={!eraser || undefined}
        data-tip="Marker  P"
        aria-label="Marker"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => api.setActiveTool({ type: "freedraw" })}
      >
        <MarkerMini color={styles.markerColor} />
      </button>
      <button
        type="button"
        className="fx-tray-pick"
        data-active={eraser || undefined}
        data-tip="Eraser  E"
        aria-label="Eraser"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => api.setActiveTool({ type: "eraser" })}
      >
        <EraserMini />
      </button>
      <span className="fx-divider" />
      <button
        type="button"
        className="fx-tray-pick"
        data-active={styles.markerWidth === MARKER_THIN || undefined}
        data-tip="Thin"
        aria-label="Thin"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pickWidth(MARKER_THIN)}
      >
        <ThinLine />
      </button>
      <button
        type="button"
        className="fx-tray-pick"
        data-active={styles.markerWidth === MARKER_THICK || undefined}
        data-tip="Thick"
        aria-label="Thick"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pickWidth(MARKER_THICK)}
      >
        <ThickLine />
      </button>
      <span className="fx-divider" />
      <ColorDots colors={MARKER_COLORS} value={styles.markerColor} onPick={pickColor} label="Marker color" />
      <button
        type="button"
        className="fx-tray-dot"
        data-selected={!known || undefined}
        data-tip="Custom"
        aria-label="Custom color"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => custom.current?.click()}
      >
        <span className="fx-color-custom" />
      </button>
      <input
        ref={custom}
        type="color"
        className="fx-color-input"
        value={/^#[0-9a-f]{6}$/i.test(styles.markerColor) ? styles.markerColor : "#000000"}
        onChange={(e) => pickColor(e.target.value)}
        tabIndex={-1}
        aria-hidden
      />
    </div>
  );
}

function StickyTray() {
  const styles = useToolStyles();
  return (
    <div className="fx-panel fx-tray" role="toolbar" aria-label="Sticky note color">
      <ColorDots colors={STICKY_COLORS} value={styles.stickyColor} onPick={(c) => setToolStyles({ stickyColor: c })} label="Sticky note color" />
    </div>
  );
}

/** The row above the toolbar while drawing shapes: color, connectors, shapes. */
function ShapeTray({ api, current }: { api: ExcalidrawImperativeAPI; current: ShapeKind | null }) {
  const menu = useMenu();
  const styles = useToolStyles();
  const forConnector = current ? isConnector(current) : false;
  const color = forConnector ? styles.connectorColor : styles.shapeFill;
  const mode = fillMode(color);
  const setFill = (c: string) => {
    setToolStyles({ shapeFill: c });
    applyToolStyle(api);
  };

  return (
    <div className="fx-panel fx-tray" role="toolbar" aria-label="Shapes">
      <button
        type="button"
        className="fx-tray-color"
        data-tip={forConnector ? "Connector color" : "Color"}
        aria-label={forConnector ? "Connector color" : "Color"}
        data-open={!!menu.anchor || undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        <span
          className="fx-tray-swatch"
          data-none={color === "transparent" || undefined}
          style={{ ["--c" as string]: color, ["--s" as string]: forConnector ? color : (strokeForFill(color) ?? "#757575") }}
        />
        <Caret />
      </button>
      <span className="fx-divider" />
      {[...CONNECTORS, ...SHAPES].map((kind) => (
        <button
          key={kind}
          type="button"
          className="fx-tray-shape"
          data-active={current === kind || undefined}
          data-tip={SHAPE_KEYS[kind] ? `${SHAPE_LABELS[kind]}  ${SHAPE_KEYS[kind]}` : SHAPE_LABELS[kind]}
          aria-label={SHAPE_LABELS[kind]}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            selectShape(api, kind);
            applyToolStyle(api);
          }}
        >
          {SHAPE_ICONS[kind]}
        </button>
      ))}
      {menu.anchor &&
        (forConnector ? (
          <ColorPopover
            anchor={menu.anchor}
            value={color}
            onClose={menu.close}
            onPick={(c) => {
              setToolStyles({ connectorColor: c });
              applyToolStyle(api);
            }}
          />
        ) : (
          <ColorPopover
            anchor={menu.anchor}
            value={color}
            tabs={FILL_TABS}
            tab={mode}
            onTab={(m) => setFill(withFillMode(mode === "none" ? "#ffffff" : color, m))}
            onPick={(c) => setFill(withFillMode(c, mode === "none" ? "fill" : mode))}
            onClose={menu.close}
          />
        ))}
    </div>
  );
}
