// Icons for the board UI, drawn for this app. Most sit on a 24×24 grid with
// thin strokes that follow the text color, like the rest of the interface.

type P = { size?: number };

const svg = (size = 24, view = 24) => ({
  width: size,
  height: size,
  viewBox: `0 0 ${view} ${view}`,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

// Same mark as public/favicon.svg.
export const AppLogo = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="-2 -2 28 28" aria-hidden>
    <rect x="2" y="2" width="9.5" height="9.5" rx="2.6" fill="#ff5a36" />
    <circle cx="17.25" cy="6.75" r="4.75" fill="#a66bff" />
    <circle cx="6.75" cy="17.25" r="4.75" fill="#29b6f6" />
    <rect x="12.5" y="12.5" width="9.5" height="9.5" rx="2.6" fill="#14c98b" />
  </svg>
);

/** Small caret used next to labels and swatches (16×16 box). */
export const ChevronDown = ({ size = 16 }: P) => (
  <svg {...svg(size, 16)}>
    <path d="M6 7l2 2 2-2" />
  </svg>
);

/** Tiny caret (6×6) for the color button in the shapes tray. */
export const Caret = () => (
  <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden fill="currentColor">
    <path d="M0.5 1.75h5L3 4.5z" />
  </svg>
);

export const ChevronRight = ({ size = 24 }: P) => (
  <svg {...svg(size)}>
    <path d="M10.5 9l3 3-3 3" />
  </svg>
);

export const PanelIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)}>
    <rect x="5.5" y="6.5" width="13" height="11" rx="1.5" />
    <path d="M9.5 6.5v11" />
  </svg>
);

/** Two stacked pages (the pages button). */
export const PagesIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)} strokeWidth={1.2}>
    <rect x="4.5" y="7.5" width="12" height="12" rx="2" />
    <path d="M7.5 4.5h10a2 2 0 0 1 2 2v10" />
  </svg>
);

export const PlusIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)}>
    <path d="M12 6.5v11M6.5 12h11" />
  </svg>
);

export const MinusIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)}>
    <path d="M6.5 12h11" />
  </svg>
);

export const DotsIcon = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <circle cx="3.5" cy="8" r="1" />
    <circle cx="8" cy="8" r="1" />
    <circle cx="12.5" cy="8" r="1" />
  </svg>
);

export const CheckIcon = ({ size = 16 }: P) => (
  <svg {...svg(size, 16)} strokeWidth={1.2}>
    <path d="M4 8.2l2.6 2.6L12 5.4" />
  </svg>
);

export const HelpIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)} strokeWidth={1.2}>
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2-2.5 3.6" />
    <circle cx="12" cy="16.6" r=".6" fill="currentColor" stroke="none" />
  </svg>
);

// ---- Tools (bottom toolbar) ----

export const MoveTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M7.5 6.5l11 4.6-4.7 1.5-1.6 4.9z" />
  </svg>
);

export const HandTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M9 12.5V7.2a1.1 1.1 0 0 1 2.2 0v4.3m0-4.8V5.9a1.1 1.1 0 0 1 2.2 0v5.6m0-4.6a1.1 1.1 0 0 1 2.2 0v5.6m0-3.4a1.1 1.1 0 0 1 2.2 0v4.6a5.2 5.2 0 0 1-5.2 5.2h-.7a5 5 0 0 1-3.8-1.8l-2.6-3.2a1.15 1.15 0 0 1 1.8-1.4l1.1 1.3" />
  </svg>
);

export const TextTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M6.5 7.5V6h11v1.5M12 6v12M10 18h4" />
  </svg>
);

export const SectionTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
    <path d="M5.5 10h4a.5.5 0 0 0 .5-.5v-4" />
  </svg>
);

export const ImageTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <rect x="5.5" y="6.5" width="13" height="11" rx="1.5" />
    <circle cx="9.5" cy="10" r="1.2" />
    <path d="M18.5 15l-3.8-3.8-6.7 6.3" />
  </svg>
);

export const EraserTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M10 18.5l-3.6-3.6a1.2 1.2 0 0 1 0-1.7l7-7a1.2 1.2 0 0 1 1.7 0l3.6 3.6a1.2 1.2 0 0 1 0 1.7L12.6 18.5z" />
    <path d="M10 18.5h8M9.5 10l5 5" />
  </svg>
);

// ---- Toolbar pictures (the pen, sticky notes and shapes peek out of the toolbar) ----

/** A marker pen, drawn tall: only the top shows until the tool is picked. */
export const MarkerArt = ({ color = "#1e1e1e" }: { color?: string }) => (
  <svg width="32" height="72" viewBox="0 0 32 72" aria-hidden>
    <defs>
      <linearGradient id="fx-marker-body" x1="0" x2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.65" stopColor="#f7f7f7" />
        <stop offset="1" stopColor="#e3e3e3" />
      </linearGradient>
    </defs>
    <path d="M10.5 9.5L13.6 2.2a2.6 2.6 0 0 1 4.8 0l3.1 7.3z" fill={color} />
    <path d="M7 24L10.5 9.5h11L25 24z" fill="url(#fx-marker-body)" stroke="#d4d4d4" strokeWidth="1" strokeLinejoin="round" />
    <rect x="5" y="24" width="22" height="50" rx="3" fill="url(#fx-marker-body)" stroke="#d4d4d4" strokeWidth="1" />
    <rect x="5" y="28" width="22" height="3" fill={color} opacity="0.85" />
  </svg>
);

/** A small stack of sticky notes in the current color. */
export const StickyArt = ({ color = "#ffe299" }: { color?: string }) => (
  <svg width="62" height="62" viewBox="0 0 56 56" aria-hidden>
    <g transform="rotate(-8 28 30)">
      <rect x="9" y="11" width="38" height="38" rx="1.5" fill={color} opacity="0.55" />
    </g>
    <g transform="rotate(4 28 30)">
      <path d="M9 9h38v28.5L36.5 48H9z" fill={color} />
      <path d="M9 9h38v28.5L36.5 48H9z" fill="#000" opacity="0.04" />
      <path d="M47 37.5H38a1.5 1.5 0 0 0-1.5 1.5v9z" fill="#000" opacity="0.12" />
      <path d="M9 9h38v28.5L36.5 48H9z" fill="none" stroke="#000" strokeOpacity="0.08" />
    </g>
  </svg>
);

/** A square, a connector and a circle (the shapes tool), in the current shape color. */
export const ShapesArt = ({ fill = "#fff", stroke = "#757575" }: { fill?: string; stroke?: string }) => (
  <svg width="64" height="56" viewBox="0 0 64 56" aria-hidden stroke="#757575" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6.6" y="6.6" width="23" height="23" rx="2.4" fill={fill} stroke={stroke} />
    <path d="M41.5 16v-4.5a3 3 0 0 1 3-3h7.5" fill="none" />
    <path d="M49.5 5.5l3 3-3 3" fill="none" />
    <circle cx="47.5" cy="38.5" r="11" fill={fill} stroke={stroke} />
  </svg>
);

// ---- Shapes (tray and shape switcher, 24×24, fill follows --shape-fill) ----

const shape = (size = 24) => ({ ...svg(size), fill: "var(--shape-fill, none)" });

export const SquareShape = ({ size }: P) => (
  <svg {...shape(size)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="1" />
  </svg>
);

export const RoundedShape = ({ size }: P) => (
  <svg {...shape(size)}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="4" />
  </svg>
);

export const EllipseTool = ({ size }: P) => (
  <svg {...shape(size)}>
    <circle cx="12" cy="12" r="8.5" />
  </svg>
);

export const DiamondTool = ({ size }: P) => (
  <svg {...shape(size)}>
    <path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" />
  </svg>
);

export const TriangleShape = ({ size }: P) => (
  <svg {...shape(size)}>
    <path d="M12 3.5l9 16H3z" />
  </svg>
);

export const TriangleDownShape = ({ size }: P) => (
  <svg {...shape(size)}>
    <path d="M12 20.5l9-16H3z" />
  </svg>
);

export const ElbowTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M5 20.5v-6a2.5 2.5 0 0 1 2.5-2.5h7a2.5 2.5 0 0 0 2.5-2.5V4" />
    <path d="M14.5 6.5L17 4l2.5 2.5" />
  </svg>
);

export const CurvedTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M4.5 20.5c1-6 4-7.5 7-8.5s5.5-3 6-8" />
    <path d="M15 6.2L17.6 3.8l2.4 2.6" />
  </svg>
);

export const ArrowTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M4.5 19.5l15-15M12 4.5h7.5V12" />
  </svg>
);

export const LineTool = ({ size }: P) => (
  <svg {...svg(size)}>
    <path d="M4.5 19.5l15-15" />
  </svg>
);

// ---- Marker tray ----

/** Small picture of a pen for the marker tray. */
export const MarkerMini = ({ color = "#1e1e1e" }: { color?: string }) => (
  <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden>
    <path d="M5.5 5L7.1 1.3a1 1 0 0 1 1.8 0L10.5 5z" fill={color} />
    <path d="M3.5 12l2-7h5l2 7z" fill="#fff" stroke="#c7c7c7" strokeWidth="0.8" strokeLinejoin="round" />
    <rect x="2.5" y="12" width="11" height="10" rx="1.5" fill="#fff" stroke="#c7c7c7" strokeWidth="0.8" />
  </svg>
);

/** Small picture of an eraser for the marker tray. */
export const EraserMini = () => (
  <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden>
    <rect x="2.5" y="1.5" width="13" height="20" rx="3" fill="#ffa4a4" />
    <rect x="2.5" y="1.5" width="13" height="7" rx="3" fill="#ffc4c4" />
    <rect x="2.5" y="8" width="13" height="2" fill="#ef8a8a" />
  </svg>
);

export const ThinLine = ({ size = 24 }: P) => (
  <svg {...svg(size)} strokeWidth={1.5}>
    <path d="M5.5 15.5c2-5 3.5-6 5-3.5s3 3 4.5-.5 2.5-4 3.5-2" />
  </svg>
);

export const ThickLine = ({ size = 24 }: P) => (
  <svg {...svg(size)} strokeWidth={3}>
    <path d="M5.5 15.5c2-5 3.5-6 5-3.5s3 3 4.5-.5 2.5-4 3.5-2" />
  </svg>
);

// ---- Selection toolbar (24×24) ----

/** Circle behind a square: "change shape". */
export const ShapeSwitchIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)}>
    <path d="M14 9.5a4.5 4.5 0 1 0-4.5 5" />
    <rect x="11.5" y="11.5" width="7" height="7" rx="1" />
  </svg>
);

/** Three lines of growing weight: "line style". */
export const LineStyleIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)} strokeLinecap="butt">
    <path d="M6 7.5h12" strokeWidth={1} />
    <path d="M6 11.5h12" strokeWidth={1.6} />
    <path d="M6 16h12" strokeWidth={2.4} />
  </svg>
);

export const FontIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)}>
    <path d="M4.5 16.5L8 7.5l3.5 9M5.8 13.5h4.4" />
    <path d="M14 11c.4-.6 1-.9 1.8-.9 1.2 0 1.9.7 1.9 1.9v4.5M17.7 13.6c-.7-.3-1.4-.4-2.1-.3-1.1.2-1.8.8-1.8 1.7 0 .8.6 1.4 1.5 1.4 1 0 1.8-.6 2.4-1.4" />
  </svg>
);

export const AlignIcon = ({ size = 24, align = "center" }: P & { align?: "left" | "center" | "right" }) => (
  <svg {...svg(size)}>
    {align === "left" && <path d="M6 8h12M6 12h8M6 16h10" />}
    {align === "center" && <path d="M6 8h12M8 12h8M7 16h10" />}
    {align === "right" && <path d="M6 8h12M10 12h8M8 16h10" />}
  </svg>
);

export const BoldIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)} strokeWidth={1.6}>
    <path d="M8.5 6.5h4a2.75 2.75 0 0 1 0 5.5h-4zM8.5 12h4.75a2.75 2.75 0 0 1 0 5.5H8.5z" />
  </svg>
);

export const StrikeIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)}>
    <path d="M6 12h12M15.2 8.6c-.4-1.3-1.6-2.1-3.2-2.1-1.9 0-3.3 1-3.3 2.5 0 .9.5 1.6 1.4 2M8.7 15.2c.3 1.4 1.6 2.3 3.4 2.3 2 0 3.4-1 3.4-2.5 0-.6-.2-1.1-.6-1.5" />
  </svg>
);

export const LinkIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)}>
    <path d="M10.5 13.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.9.9M13.5 10.5a3 3 0 0 0-4.2 0L7 12.8A3 3 0 0 0 11.2 17l.9-.9" />
  </svg>
);

export const ListIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)}>
    <path d="M10 8h8M10 12h8M10 16h8" />
    <circle cx="6.75" cy="8" r=".75" fill="currentColor" />
    <circle cx="6.75" cy="12" r=".75" fill="currentColor" />
    <circle cx="6.75" cy="16" r=".75" fill="currentColor" />
  </svg>
);

export const FitIcon = ({ size = 24 }: P) => (
  <svg {...svg(size)}>
    <rect x="9" y="9" width="6" height="6" rx="1" />
    <path d="M5.5 9V6.5a1 1 0 0 1 1-1H9M15 5.5h2.5a1 1 0 0 1 1 1V9M18.5 15v2.5a1 1 0 0 1-1 1H15M9 18.5H6.5a1 1 0 0 1-1-1V15" />
  </svg>
);

export const LockIcon = ({ size = 24, open }: P & { open?: boolean }) => (
  <svg {...svg(size)}>
    <rect x="7.5" y="11.5" width="9" height="7" rx="1.5" />
    <path d={open ? "M9.5 11.5V9a2.5 2.5 0 0 1 4.9-.7" : "M9.5 11.5V9a2.5 2.5 0 0 1 5 0v2.5"} />
  </svg>
);
