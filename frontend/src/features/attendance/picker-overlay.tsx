import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export const PICKER_SIZE = 196;

/** Keeps the radial picker fully on-screen, centered on the cell when possible. */
export function PickerOverlay({
  open, anchor, onClose, children, className,
}: {
  open: boolean;
  anchor: DOMRect | null;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number; centered: boolean } | null>(null);

  React.useLayoutEffect(() => {
    if (!open || !anchor) { setPos(null); return; }
    const pad = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer centering over the cell; fall back to viewport center when space is tight.
    const tight = vw < 420 || vh < 520;
    const idealLeft = tight ? (vw - PICKER_SIZE) / 2 : anchor.left + anchor.width / 2 - PICKER_SIZE / 2;
    const idealTop = tight ? (vh - PICKER_SIZE) / 2 : anchor.top + anchor.height / 2 - PICKER_SIZE / 2;
    setPos({
      centered: tight,
      left: Math.min(Math.max(pad, idealLeft), Math.max(pad, vw - PICKER_SIZE - pad)),
      top: Math.min(Math.max(pad, idealTop), Math.max(pad, vh - PICKER_SIZE - pad)),
    });
  }, [open, anchor]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(t)) onClose();
    };
    // Defer so the opening click doesn't immediately close.
    const id = window.setTimeout(() => {
      document.addEventListener("keydown", onKey);
      document.addEventListener("pointerdown", onPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, onClose]);

  if (!open || !pos || typeof document === "undefined") return null;

  return createPortal(
    <div className={cn("fixed inset-0 z-[60]", className)} data-attendance-picker-root="">
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 transition-opacity duration-fast",
          pos.centered ? "bg-background/55 backdrop-blur-[2px]" : "bg-transparent",
        )}
      />
      <div
        ref={panelRef}
        style={{ top: pos.top, left: pos.left, width: PICKER_SIZE, height: PICKER_SIZE }}
        className="absolute touch-manipulation select-none"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
