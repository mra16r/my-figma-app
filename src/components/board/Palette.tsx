import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Colors picked for this app: a strong row and a soft row.
export const PALETTE: { name: string; value: string }[][] = [
  [
    { name: "Black", value: "#1e1e1e" },
    { name: "Gray", value: "#7a7a7a" },
    { name: "Red", value: "#ef4b2b" },
    { name: "Orange", value: "#ff9e3d" },
    { name: "Yellow", value: "#ffcd3c" },
    { name: "Green", value: "#3fc06b" },
    { name: "Teal", value: "#3ccfc0" },
    { name: "Blue", value: "#2d9cff" },
    { name: "Violet", value: "#8c4dff" },
    { name: "Pink", value: "#f04fb3" },
    { name: "White", value: "#ffffff" },
  ],
  [
    { name: "Light gray", value: "#b3b3b3" },
    { name: "Pale gray", value: "#dcdcdc" },
    { name: "Light red", value: "#ffc8c0" },
    { name: "Light orange", value: "#ffdcbf" },
    { name: "Light yellow", value: "#fff0bf" },
    { name: "Light green", value: "#cdf3d3" },
    { name: "Light teal", value: "#c4f3ef" },
    { name: "Light blue", value: "#c4e2ff" },
    { name: "Light violet", value: "#e2d2ff" },
    { name: "Light pink", value: "#ffcdeb" },
  ],
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

type Tab<T extends string> = { id: T; label: string; icon: ReactNode };

const FillIcon = ({ kind }: { kind: FillMode }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
    <rect x="1.5" y="1.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray={kind === "transparent" ? "2 1.6" : undefined} />
    {kind === "fill" && <rect x="4" y="4" width="6" height="6" rx="1" fill="currentColor" />}
    {kind === "none" && <rect x="4" y="4" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />}
  </svg>
);

const StrokeTabIcon = ({ kind }: { kind: StrokeMode }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    {kind === "solid" && <path d="M2 12L12 2" />}
    {kind === "dashed" && <path d="M2 12l2-2M6 8l2-2M10 4l2-2" />}
    {kind === "none" && (
      <>
        <circle cx="7" cy="7" r="5" />
        <path d="M3.5 10.5l7-7" />
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
  colors?: { name: string; value: string }[][];
};

/** Dark color popover: optional mode tabs, two rows of colors and a custom color. */
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
}: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const custom = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.top });
  const current = baseColor(value).toLowerCase();

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
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="fx-color-grid">
        {colors.flat().map((c) => (
          <button
            key={c.value}
            type="button"
            className="fx-color-swatch"
            title={c.name}
            aria-label={c.name}
            data-selected={c.value.toLowerCase() === current || undefined}
            style={{ ["--c" as string]: c.value }}
            onClick={() => onPick(c.value)}
          />
        ))}
        <button
          type="button"
          className="fx-color-swatch fx-color-custom"
          title="Custom color"
          aria-label="Custom color"
          onClick={() => custom.current?.click()}
        />
        <input
          ref={custom}
          type="color"
          className="fx-color-input"
          value={/^#[0-9a-f]{6}$/i.test(baseColor(value)) ? baseColor(value) : "#000000"}
          onChange={(e) => onPick(e.target.value)}
          tabIndex={-1}
          aria-hidden
        />
      </div>
    </div>,
    document.body,
  );
}
