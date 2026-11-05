import { useEffect, useState, type ReactNode } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Menu, useMenu } from "./Menu";
import { ColorPopover, FILL_TABS, fillMode, withFillMode } from "./Palette";
import {
  ArrowTool,
  ChevronDown,
  CurvedTool,
  DiamondTool,
  ElbowTool,
  EllipseTool,
  EraserTool,
  HandTool,
  ImageTool,
  LineTool,
  MoveTool,
  PenTool,
  RoundedShape,
  SectionTool,
  ShapesTool,
  SquareShape,
  StickyTool,
  TextTool,
  TriangleDownShape,
  TriangleShape,
} from "./icons";
import { activeShape, CONNECTORS, isConnector, selectShape, SHAPE_LABELS, SHAPES, type ShapeKind } from "./shapes";

export type ToolId = "selection" | "hand" | "freedraw" | "eraser" | "sticky" | "shapes" | "text" | "frame" | "image";

type Tool = { id: ToolId; label: string; shortcut?: string; icon: ReactNode };

export const TOOLS: Record<ToolId, Tool> = {
  selection: { id: "selection", label: "Move", shortcut: "V", icon: <MoveTool /> },
  hand: { id: "hand", label: "Hand", shortcut: "H", icon: <HandTool /> },
  freedraw: { id: "freedraw", label: "Marker", shortcut: "P", icon: <PenTool /> },
  eraser: { id: "eraser", label: "Eraser", shortcut: "E", icon: <EraserTool /> },
  sticky: { id: "sticky", label: "Sticky note", shortcut: "S", icon: <StickyTool size={30} /> },
  shapes: { id: "shapes", label: "Shapes and connectors", shortcut: "R", icon: <ShapesTool /> },
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

/** Tool groups, separated by dividers; inner arrays share one button with a flyout. */
const LAYOUT: (ToolId | ToolId[])[][] = [
  ["selection", "hand"],
  [["freedraw", "eraser"], "sticky", "shapes"],
  ["text", "frame", "image"],
];

/** Selects a tool from the bottom toolbar (shapes: the last shape used). */
export function selectTool(api: ExcalidrawImperativeAPI, id: ToolId, lastShape: ShapeKind = "square"): void {
  if (id === "sticky") api.setActiveTool({ type: "custom", customType: "sticky" });
  else if (id === "shapes") selectShape(api, lastShape);
  else api.setActiveTool({ type: id });
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

  useEffect(() => {
    const sync = () => {
      const tool = activeToolId(api);
      const s = activeShape(api);
      setActive((cur) => (cur === tool ? cur : tool));
      setShape((cur) => (cur === s ? cur : s));
      if (s) setLastShape(s);
    };
    sync();
    return api.onChange(sync);
  }, [api]);

  const choose = (id: ToolId) => {
    selectTool(api, id, lastShape);
    setActive(id);
  };

  return (
    <div className="fx-toolbar-stack">
      {active === "shapes" && <ShapeTray api={api} current={shape} />}
      <div className="fx-panel fx-toolbar" role="toolbar" aria-label="Tools">
        {LAYOUT.map((section, s) => (
          <div key={s} className="fx-toolbar-section">
            {section.map((item) =>
              Array.isArray(item) ? (
                <ToolGroup key={item.join()} ids={item} active={active} onChoose={choose} />
              ) : (
                <ToolButton
                  key={item}
                  tool={item === "shapes" ? { ...TOOLS.shapes, icon: <ShapesTool /> } : TOOLS[item]}
                  active={active === item}
                  onClick={() => choose(item)}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The row above the toolbar while drawing shapes: color, connectors, shapes. */
function ShapeTray({ api, current }: { api: ExcalidrawImperativeAPI; current: ShapeKind | null }) {
  const menu = useMenu();
  const forConnector = current ? isConnector(current) : false;
  const read = () => {
    const s = api.getAppState();
    return forConnector ? s.currentItemStrokeColor : s.currentItemBackgroundColor;
  };
  const [color, setColor] = useState(read);
  useEffect(() => {
    setColor(read());
    return api.onChange(() => setColor(read()));
  }, [api, forConnector]); // eslint-disable-line react-hooks/exhaustive-deps
  const mode = fillMode(color);
  const setFill = (c: string) => api.updateScene({ appState: { currentItemBackgroundColor: c } });

  return (
    <div className="fx-panel fx-shape-tray" role="toolbar" aria-label="Shapes">
      <button
        type="button"
        className="fx-tray-color"
        data-tip={forConnector ? "Connector color" : "Shape color"}
        aria-label="Color for new shapes"
        data-open={!!menu.anchor || undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        <span className="fx-swatch" data-none={color === "transparent" || undefined} style={{ ["--c" as string]: color }} />
        <ChevronDown size={10} />
      </button>
      <span className="fx-tray-divider" />
      {[...CONNECTORS, null, ...SHAPES].map((kind, i) =>
        kind === null ? (
          <span key={`d${i}`} className="fx-tray-divider" />
        ) : (
          <button
            key={kind}
            type="button"
            className="fx-tray-item"
            data-active={current === kind || undefined}
            data-tip={SHAPE_KEYS[kind] ? `${SHAPE_LABELS[kind]}  ${SHAPE_KEYS[kind]}` : SHAPE_LABELS[kind]}
            aria-label={SHAPE_LABELS[kind]}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectShape(api, kind)}
          >
            {SHAPE_ICONS[kind]}
          </button>
        ),
      )}
      {menu.anchor &&
        (forConnector ? (
          <ColorPopover
            anchor={menu.anchor}
            value={color}
            onClose={menu.close}
            onPick={(c) => api.updateScene({ appState: { currentItemStrokeColor: c } })}
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

function ToolButton({ tool, active, onClick }: { tool: Tool; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="fx-tool"
      data-tool={tool.id}
      data-active={active || undefined}
      data-tip={tool.shortcut ? `${tool.label}  ${tool.shortcut}` : tool.label}
      aria-label={tool.label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {tool.icon}
    </button>
  );
}

function ToolGroup({ ids, active, onChoose }: { ids: ToolId[]; active: ToolId; onChoose: (id: ToolId) => void }) {
  const [shown, setShown] = useState<ToolId>(ids[0]);
  const menu = useMenu();
  const isActive = ids.includes(active);

  useEffect(() => {
    if (ids.includes(active)) setShown(active);
  }, [active, ids]);

  return (
    <div className="fx-tool-group" data-active={isActive || undefined}>
      <ToolButton tool={TOOLS[shown]} active={isActive} onClick={() => onChoose(shown)} />
      <button
        type="button"
        className="fx-tool-caret"
        aria-label={`More ${TOOLS[shown].label.toLowerCase()} tools`}
        data-open={!!menu.anchor || undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => menu.toggle(e.currentTarget.parentElement!)}
      >
        <ChevronDown size={10} />
      </button>
      {menu.anchor && (
        <Menu
          anchor={menu.anchor}
          side="above"
          onClose={menu.close}
          entries={ids.map((id) => ({
            label: TOOLS[id].label,
            shortcut: TOOLS[id].shortcut,
            checked: id === shown,
            onSelect: () => onChoose(id),
          }))}
        />
      )}
    </div>
  );
}
