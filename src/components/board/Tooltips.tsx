import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Tooltips for anything with a data-tip attribute: "Label" or "Label  Shortcut"
// (two spaces). They show after a short pause; once one is showing, moving to
// the next button shows its tooltip right away, like a native app.

const DELAY_MS = 500;
const QUICK_MS = 300; // after a tooltip closes, the next one is instant for this long

type Tip = { el: HTMLElement; label: string; shortcut: string };

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef(0);
  const lastHidden = useRef(0);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      if (current.current) lastHidden.current = Date.now();
      current.current = null;
      setTip(null);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target instanceof Element ? e.target.closest<HTMLElement>("[data-tip]") : null) ?? null;
      if (el === current.current) return;
      window.clearTimeout(timer.current);
      if (!el) {
        if (current.current) hide();
        return;
      }
      const showing = !!current.current || Date.now() - lastHidden.current < QUICK_MS;
      current.current = el;
      setTip(null);
      const show = () => {
        if (current.current !== el || el.hasAttribute("data-open") || !el.isConnected) return;
        const [label, shortcut = ""] = (el.dataset.tip ?? "").split(/\s{2,}/);
        setTip({ el, label, shortcut });
      };
      if (showing) show();
      else timer.current = window.setTimeout(show, DELAY_MS);
    };
    const onDown = () => {
      if (current.current) lastHidden.current = 0; // a click ends the "quick" streak
      window.clearTimeout(timer.current);
      setTip(null);
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("wheel", onDown, { capture: true, passive: true });
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("wheel", onDown, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!tip) return null;
  return <TooltipBox tip={tip} />;
}

function TooltipBox({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ left: number; top: number; arrowX: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const r = tip.el.getBoundingClientRect();
    const { width, height } = box.getBoundingClientRect();
    // Things in the lower half get their tooltip above, the rest below.
    const below = r.top + r.height / 2 < window.innerHeight / 2;
    const center = r.left + r.width / 2;
    const left = Math.max(8, Math.min(center - width / 2, window.innerWidth - width - 8));
    const top = below ? r.bottom + 6 : r.top - 6 - height;
    setLayout({ left, top, arrowX: Math.max(10, Math.min(center - left, width - 10)), below });
  }, [tip]);

  return createPortal(
    <div
      ref={ref}
      className="fx-tooltip"
      data-below={layout?.below || undefined}
      role="tooltip"
      style={layout ? { left: layout.left, top: layout.top } : { left: -9999, top: -9999 }}
    >
      <span>{tip.label}</span>
      {tip.shortcut && <span className="fx-tooltip-key">{tip.shortcut}</span>}
      <span className="fx-tooltip-arrow" style={{ left: layout?.arrowX ?? 0 }} />
    </div>,
    document.body,
  );
}
