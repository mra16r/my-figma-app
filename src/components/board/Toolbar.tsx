import { useEffect, useState, type ReactNode } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Menu, useMenu } from "./Menu";
import {
  ChevronDown,
  ConnectorTool,
  DiamondTool,
  EllipseTool,
  EraserTool,
  HandTool,
  ImageTool,
  LineTool,
  MoveTool,
  PenTool,
  RectTool,
  SectionTool,
  StickyTool,
  TextTool,
} from "./icons";

export type ToolId =
  | "selection"
  | "hand"
  | "freedraw"
  | "eraser"
  | "sticky"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "line"
  | "text"
  | "frame"
  | "image";

type Tool = { id: ToolId; label: string; shortcut?: string; icon: ReactNode };

export const TOOLS: Record<ToolId, Tool> = {
  selection: { id: "selection", label: "Move", shortcut: "V", icon: <MoveTool /> },
  hand: { id: "hand", label: "Hand", shortcut: "H", icon: <HandTool /> },
  freedraw: { id: "freedraw", label: "Marker", shortcut: "P", icon: <PenTool /> },
  eraser: { id: "eraser", label: "Eraser", shortcut: "E", icon: <EraserTool /> },
  sticky: { id: "sticky", label: "Sticky note", shortcut: "S", icon: <StickyTool size={30} /> },
  rectangle: { id: "rectangle", label: "Rectangle", shortcut: "R", icon: <RectTool /> },
  ellipse: { id: "ellipse", label: "Ellipse", shortcut: "O", icon: <EllipseTool /> },
  diamond: { id: "diamond", label: "Diamond", shortcut: "D", icon: <DiamondTool /> },
  arrow: { id: "arrow", label: "Connector", shortcut: "X", icon: <ConnectorTool /> },
  line: { id: "line", label: "Line", shortcut: "L", icon: <LineTool /> },
  text: { id: "text", label: "Text", shortcut: "T", icon: <TextTool /> },
  frame: { id: "frame", label: "Section", shortcut: "Shift+S", icon: <SectionTool /> },
  image: { id: "image", label: "Place image", icon: <ImageTool /> },
};

/** Tool groups, separated by dividers; inner arrays share one button with a flyout. */
const LAYOUT: (ToolId | ToolId[])[][] = [
  ["selection", "hand"],
  [["freedraw", "eraser"], "sticky", ["rectangle", "ellipse", "diamond"], ["arrow", "line"]],
  ["text", "frame", "image"],
];

export function selectTool(api: ExcalidrawImperativeAPI, id: ToolId): void {
  if (id === "sticky") api.setActiveTool({ type: "custom", customType: "sticky" });
  else api.setActiveTool({ type: id });
}

/** The tool currently active in the canvas, in toolbar terms. */
export function activeToolId(api: ExcalidrawImperativeAPI): ToolId {
  const tool = api.getAppState().activeTool;
  if (tool.type === "custom") return tool.customType === "sticky" ? "sticky" : "selection";
  return (tool.type in TOOLS ? tool.type : "selection") as ToolId;
}

export function Toolbar({ api }: { api: ExcalidrawImperativeAPI }) {
  const [active, setActive] = useState<ToolId>(() => activeToolId(api));

  useEffect(() => {
    setActive(activeToolId(api));
    return api.onChange(() => {
      const next = activeToolId(api);
      setActive((cur) => (cur === next ? cur : next));
    });
  }, [api]);

  const choose = (id: ToolId) => {
    selectTool(api, id);
    setActive(id);
  };

  return (
    <div className="fx-panel fx-toolbar" role="toolbar" aria-label="Tools">
      {LAYOUT.map((section, s) => (
        <div key={s} className="fx-toolbar-section">
          {section.map((item) =>
            Array.isArray(item) ? (
              <ToolGroup key={item.join()} ids={item} active={active} onChoose={choose} />
            ) : (
              <ToolButton key={item} tool={TOOLS[item]} active={active === item} onClick={() => choose(item)} />
            ),
          )}
        </div>
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

  // The group shows whichever of its tools was picked last (also via shortcut).
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
