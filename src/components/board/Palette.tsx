import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type Swatch = { name: string; value: string };

// Shape, text and line colors: a strong row and a light row.
export const PALETTE: Swatch[][] = [
  [
    { name: "Black", value: "#1e1e1e" },
    { name: "Dark gray", value: "#757575" },
    { name: "Red", value: "#f24822" },
    { name: "Orange", value: "#ff9e42" },
    { name: "Yellow", value: "#ffc943" },
    { name: "Green", value: "#66d575" },
    { name: "Teal", value: "#5ad8cc" },
    { name: "Blue", value: "#3dadff" },
    { name: "Violet", value: "#874fff" },
    { name: "Pink", value: "#f849c1" },
    { name: "White", value: "#ffffff" },
  ],
  [
    { name: "Gray", value: "#b3b3b3" },
    { name: "Light gray", value: "#d9d9d9" },
    { name: "Light red", value: "#ffc7c2" },
    { name: "Light orange", value: "#ffe0c2" },
    { name: "Light yellow", value: "#ffecbd" },
    { name: "Light green", value: "#cdf4d3" },
    { name: "Light teal", value: "#c6faf6" },
    { name: "Light blue", value: "#c2e5ff" },
    { name: "Light violet", value: "#dcccff" },
    { name: "Light pink", value: "#ffc2ec" },
  ],
];

export const STICKY_COLORS: Swatch[] = [
  { name: "White", value: "#ffffff" },
  { name: "Gray", value: "#e6e6e6" },
  { name: "Red", value: "#ffafa3" },
  { name: "Orange", value: "#ffd3a8" },
  { name: "Yellow", value: "#ffe299" },
  { name: "Green", value: "#b3efbd" },
  { name: "Teal", value: "#b3f4ef" },
  { name: "Blue", value: "#a8daff" },
  { name: "Violet", value: "#d3bdff" },
  { name: "Pink", value: "#ffa8db" },
];

export const MARKER_COLORS: Swatch[] = [
  { name: "Black", value: "#1e1e1e" },
  { name: "Red", value: "#f24822" },
  { name: "Orange", value: "#ff9e42" },
  { name: "Yellow", value: "#ffc943" },
  { name: "Green", value: "#66d575" },
  { name: "Blue", value: "#3dadff" },
  { name: "Violet", value: "#874fff" },
  { name: "White", value: "#ffffff" },
];

/** Alpha added for "Transparent" fills (about 40%). */
const SEE_THROUGH = "66";

export type FillMode = "fill" | "transparent" | "none";
export type StrokeMode = "solid" | "dashed" | "none";

/** "#ff000066" → "#ff0000"; other colors unchanged. */
export const baseColor = (c: string) => (/^#[0-9a-f]{8}$/i.test(c) ? c.slice(0, 7) : c);

export function fillMode(c: string): FillMode {
  if (c === "transparent") return "none";
  return /^#[0-9a-f]{8}$/i.test(c) && c.slice(7).toLowerCase() !== "ff" ? "transparent" : "fill";
}

export const withFillMode = (color: string, mode: FillMode) =>
  mode === "none" ? "transparent" : mode === "transparent" ? `${baseColor(color)}${SEE_THROUGH}` : baseColor(color);

/** The outline that goes with a fill: a darker shade of it (gray for white). */
export function strokeForFill(fill: string): string | null {
  const hex = baseColor(fill);
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max - min < 0.04) return l > 0.9 ? "#757575" : l > 0.5 ? "#5c5c5c" : "#1e1e1e"; // grays
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  const l2 = l * (l > 0.8 ? 0.7 : 0.74);
  const c = (1 - Math.abs(2 * l2 - 1)) * Math.min(1, s * 1.05);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m0 = l2 - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const out = (v: number) =>
    Math.round((v + m0) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${out(r1)}${out(g1)}${out(b1)}`;
}

type Tab<T extends string> = { id: T; label: string; icon: ReactNode };

const FillIcon = ({ kind }: { kind: FillMode }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor">
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" strokeDasharray={kind === "transparent" ? "2 1.5" : undefined} />
    {kind === "fill" && <rect x="9" y="9" width="6" height="6" rx=".5" fill="currentColor" stroke="none" />}
    {kind === "transparent" && <rect x="9" y="9" width="6" height="6" rx=".5" fill="currentColor" fillOpacity=".4" stroke="none" />}
    {kind === "none" && <rect x="9.5" y="9.5" width="5" height="5" rx=".5" />}
  </svg>
);

const StrokeTabIcon = ({ kind }: { kind: StrokeMode | "dotted" }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeLinecap="round">
    {kind === "solid" && <path d="M7.5 16.5l9-9" />}
    {kind === "dashed" && <path d="M7.5 16.5l2-2M11 13l2-2M14.5 9.5l2-2" />}
    {kind === "dotted" && <path d="M7.5 16.5h0M10.5 13.5h0M13.5 10.5h0M16.5 7.5h0" strokeWidth={1.6} />}
    {kind === "none" && (
      <>
        <circle cx="12" cy="12" r="4.5" />
        <path d="M8.8 15.2l6.4-6.4" />
      </>
    )}
  </svg>
);

export const FILL_TABS: Tab<FillMode>[] = [
  { id: "fill", label: "Fill", icon: <FillIcon kind="fill" /> },
  { id: "transparent", label: "Transparent", icon: <FillIcon kind="transparent" /> },
  { id: "none", label: "No fill", icon: <FillIcon kind="none" /> },
];

export const STROKE_TABS: Tab<StrokeMode>[] = [
  { id: "solid", label: "Solid", icon: <StrokeTabIcon kind="solid" /> },
  { id: "dashed", label: "Dashed", icon: <StrokeTabIcon kind="dashed" /> },
  { id: "none", label: "None", icon: <StrokeTabIcon kind="none" /> },
];

export const LINE_TABS: Tab<"solid" | "dashed" | "dotted">[] = [
  { id: "solid", label: "Solid", icon: <StrokeTabIcon kind="solid" /> },
  { id: "dashed", label: "Dashed", icon: <StrokeTabIcon kind="dashed" /> },
  { id: "dotted", label: "Dotted", icon: <StrokeTabIcon kind="dotted" /> },
];

type Props<T extends string> = {
  anchor: DOMRect;
  side?: "above" | "below";
  /** Current color (shown as selected). */
  value: string;
  tabs?: Tab<T>[];
  tab?: T;
  onTab?: (tab: T) => void;
  onPick: (color: string) => void;
  onClose: () => void;
  colors?: Swatch[][];
  /** Offer the rainbow "custom color" button (default: yes). */
  custom?: boolean;
};

/** Dark color popover: optional mode tabs, rows of colors and a custom color. */
export function ColorPopover<T extends string>({
  anchor,
  side = "above",
  value,
  tabs,
  tab,
  onTab,
  onPick,
  onClose,
  colors = PALETTE,
  custom = true,
}: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const customInput = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.top });
  const current = baseColor(value).toLowerCase();
  const columns = Math.max(...colors.map((row) => row.length));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = anchor.left + anchor.width / 2 - width / 2;
    let top = side === "above" ? anchor.top - height - 8 : anchor.bottom + 8;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    if (top < 8) top = anchor.bottom + 8;
    if (top + height > window.innerHeight - 8) top = anchor.top - height - 8;
    setPos({ left, top });
  }, [anchor, side]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fx-color-pop"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
    >
      {tabs && (
        <div className="fx-color-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              className="fx-color-tab"
              data-active={t.id === tab || undefined}
              onClick={() => onTab?.(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="fx-color-grid" style={{ gridTemplateColumns: `repeat(${columns}, 32px)` }}>
        {colors.flat().map((c) => (
          <button
            key={c.value}
            type="button"
            className="fx-color-cell"
            data-tip={c.name}
            aria-label={c.name}
            data-selected={c.value.toLowerCase() === current || undefined}
            onClick={() => onPick(c.value)}
          >
            <span className="fx-color-dot" style={{ ["--c" as string]: c.value }} />
          </button>
        ))}
        {custom && (
          <button
            type="button"
            className="fx-color-cell"
            data-tip="Custom color"
            aria-label="Custom color"
            data-gesture
            onClick={() => customInput.current?.click()}
          >
            <span className="fx-color-dot fx-color-custom" />
          </button>
        )}
        {custom && (
          <input
            ref={customInput}
            type="color"
            className="fx-color-input"
            value={/^#[0-9a-f]{6}$/i.test(baseColor(value)) ? baseColor(value) : "#000000"}
            onChange={(e) => onPick(e.target.value)}
            tabIndex={-1}
            aria-hidden
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
