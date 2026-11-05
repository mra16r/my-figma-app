// Icons for the board UI. Drawn for this app (24×24, stroke follows text color).

type P = { size?: number };

const svg = (size = 24) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

// Same mark as public/favicon.svg.
export const AppLogo = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <rect x="2" y="2" width="9.5" height="9.5" rx="2.6" fill="#ff5a36" />
    <circle cx="17.25" cy="6.75" r="4.75" fill="#a66bff" />
    <circle cx="6.75" cy="17.25" r="4.75" fill="#29b6f6" />
    <rect x="12.5" y="12.5" width="9.5" height="9.5" rx="2.6" fill="#14c98b" />
  </svg>
);

export const ChevronDown = ({ size = 12 }: P) => (
  <svg {...svg(size)} viewBox="0 0 12 12" strokeWidth={1.4}>
    <path d="M3 4.5l3 3 3-3" />
  </svg>
);

export const PanelIcon = ({ size = 20 }: P) => (
  <svg {...svg(size)} viewBox="0 0 20 20" strokeWidth={1.3}>
    <rect x="3" y="4" width="14" height="12" rx="2" />
    <path d="M8 4v12" />
  </svg>
);

export const PlusIcon = ({ size = 16 }: P) => (
  <svg {...svg(size)} viewBox="0 0 16 16" strokeWidth={1.3}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);

export const MinusIcon = ({ size = 16 }: P) => (
  <svg {...svg(size)} viewBox="0 0 16 16" strokeWidth={1.3}>
    <path d="M3.5 8h9" />
  </svg>
);

export const DotsIcon = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <circle cx="3.5" cy="8" r="1.2" />
    <circle cx="8" cy="8" r="1.2" />
    <circle cx="12.5" cy="8" r="1.2" />
  </svg>
);

export const CheckIcon = ({ size = 16 }: P) => (
  <svg {...svg(size)} viewBox="0 0 16 16" strokeWidth={1.4}>
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

export const TrashIcon = ({ size = 18 }: P) => (
  <svg {...svg(size)} viewBox="0 0 18 18" strokeWidth={1.3}>
    <path d="M3.5 5h11M7 5V3.5h4V5M5 5l.7 9.5h6.6L13 5" />
  </svg>
);

export const HelpIcon = ({ size = 18 }: P) => (
  <svg {...svg(size)} viewBox="0 0 18 18" strokeWidth={1.3}>
    <circle cx="9" cy="9" r="6.5" />
    <path d="M7.2 7.2a1.9 1.9 0 0 1 3.7.6c0 1.3-1.9 1.6-1.9 2.8" />
    <circle cx="9" cy="12.8" r=".4" fill="currentColor" />
  </svg>
);

// ---- Tools ----

export const MoveTool = ({ size }: P) => (
  <svg {...svg(size)} strokeWidth={1.4}>
    <path d="M6.5 4.5l11 5.2-4.9 1.4-1.6 4.9z" fill="currentColor" fillOpacity={0} />
    <path d="M6.5 4.5l11 5.2-4.9 1.4-1.6 4.9z" />
  </svg>
);

export const HandTool = ({ size }: P) => (
  <svg {...svg(size)} strokeWidth={1.35}>
    <path d="M8.5 12V6.2a1.25 1.25 0 0 1 2.5 0V11m0-5.8V4.7a1.25 1.25 0 0 1 2.5 0V11m0-5.3a1.25 1.25 0 0 1 2.5 0V12m0-3.5a1.25 1.25 0 0 1 2.5 0v4.8a6 6 0 0 1-6 6h-.6a5.6 5.6 0 0 1-4.3-2l-3.2-3.9a1.3 1.3 0 0 1 2-1.6l1.6 1.7" />
  </svg>
);

export const PenTool = ({ size }: P) => (
  <svg {...svg(size)} strokeWidth={1.4}>
    <path d="M15.2 4.8l4 4L9 19H5v-4z" />
    <path d="M13 7l4 4" />
  </svg>
);

export const EraserTool = ({ size }: P) => (
  <svg {...svg(size)} strokeWidth={1.4}>
    <path d="M8.5 19.5l-4-4a1.5 1.5 0 0 1 0-2.1l8.9-8.9a1.5 1.5 0 0 1 2.1 0l4 4a1.5 1.5 0 0 1 0 2.1l-8 8.9z" />
    <path d="M8.5 19.5h11M8 10l6 6" />
  </svg>
);

export const StickyTool = ({ size }: P) => (
  <svg width={size ?? 24} height={size ?? 24} viewBox="0 0 24 24" aria-hidden>
    <path d="M5 4.5h14a.5.5 0 0 1 .5.5v9.6L14.6 19.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5z" fill="#ffe27a" stroke="#d9b13a" strokeWidth="1" />
    <path d="M19.5 14.6h-4.4a.5.5 0 0 0-.5.5v4.4" fill="#f5cd4c" stroke="#d9b13a" strokeWidth="1" strokeLinejoin="round" />
  </svg>
);

export const RectTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <rect x="4.5" y="5.5" width="15" height="13" rx="1.5" />
  </svg>
);

export const EllipseTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <circle cx="12" cy="12" r="7.5" />
  </svg>
);

export const DiamondTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M12 3.8l8.2 8.2-8.2 8.2L3.8 12z" />
  </svg>
);

export const ConnectorTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M5 18.5V12a2 2 0 0 1 2-2h11" />
    <path d="M15 7l3 3-3 3" />
  </svg>
);

/** Bottom toolbar: one button for all shapes and connectors. */
export const ShapesTool = ({ size }: P) => (
  <svg {...svg(size)} strokeWidth={1.4}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    <circle cx="16.5" cy="16.5" r="4" />
    <path d="M14.5 4.5h4a1 1 0 0 1 1 1v4M17.5 7.5l2 2 2-2" />
  </svg>
);

export const ElbowTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M5 19v-5.5a2 2 0 0 1 2-2h8.5a2 2 0 0 0 2-2V5" />
    <path d="M15 7.5l2.5-2.5 2.5 2.5" />
  </svg>
);

export const CurvedTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M5 19c0-7 4-6 7-8s5-3 5.5-6" />
    <path d="M15 7.2l2.6-2.4 2.3 2.7" />
  </svg>
);

export const ArrowTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M5.5 18.5l12-12M11 6.5h6.5V13" />
  </svg>
);

export const SquareShape = ({ size }: P) => (
  <svg {...svg(size)}>
    <rect x="5" y="5" width="14" height="14" />
  </svg>
);

export const RoundedShape = ({ size }: P) => (
  <svg {...svg(size)}>
    <rect x="5" y="5" width="14" height="14" rx="4" />
  </svg>
);

export const TriangleShape = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M12 4.5l8 14H4z" />
  </svg>
);

export const TriangleDownShape = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M12 19.5l8-14H4z" />
  </svg>
);

export const StrokeIcon = ({ size = 18 }: P) => (
  <svg {...svg(size)} viewBox="0 0 18 18" strokeWidth={1.3}>
    <path d="M3 5h12M3 9h12M3 13h12" />
  </svg>
);

export const FontIcon = ({ size = 18 }: P) => (
  <svg {...svg(size)} viewBox="0 0 18 18" strokeWidth={1.3}>
    <path d="M2.5 13.5L6 4.5l3.5 9M3.8 10.5h4.4M12.5 8.2c.5-.5 1.1-.7 1.8-.7 1.2 0 1.9.7 1.9 1.9v4.1M16.2 11.2c-.6-.3-1.3-.4-2-.3-1 .1-1.7.7-1.7 1.5 0 .7.6 1.2 1.4 1.2 1 0 1.7-.6 2.3-1.3" />
  </svg>
);

export const AlignIcon = ({ size = 18, align = "center" }: P & { align?: "left" | "center" | "right" }) => (
  <svg {...svg(size)} viewBox="0 0 18 18" strokeWidth={1.3}>
    {align === "left" && <path d="M3 4.5h12M3 9h7M3 13.5h10" />}
    {align === "center" && <path d="M3 4.5h12M5.5 9h7M4.5 13.5h9" />}
    {align === "right" && <path d="M3 4.5h12M8 9h7M5 13.5h10" />}
  </svg>
);

export const LineTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M5.5 18.5l13-13" />
  </svg>
);

export const TextTool = ({ size }: P) => (
  <svg {...svg(size)} strokeWidth={1.4}>
    <path d="M6 6.5V5h12v1.5M12 5v14M9.5 19h5" />
  </svg>
);

export const SectionTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M4 9.5h5.5a1 1 0 0 0 1-1V4" />
  </svg>
);

export const ImageTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M20 16l-4.5-4.5L7 19" />
  </svg>
);
