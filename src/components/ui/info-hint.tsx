"use client";

import * as React from "react";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/cn";

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

const POPOVER_WIDTH = 288; // px — matches the Tailwind w-72 bubble
const VIEWPORT_MARGIN = 8; // px kept clear of the viewport edges
const GAP = 8; // px between the trigger and the bubble

interface InfoHintProps {
  /** Explanatory content shown in the bubble. Plain text or inline elements. */
  children: React.ReactNode;
  /** Accessible label for the trigger button (screen readers). */
  label?: string;
  /** Extra classes for the wrapping element. */
  className?: string;
  /** Extra classes for the icon trigger (e.g. sizing/colour tweaks). */
  iconClassName?: string;
}

/**
 * A small "?" help bubble rendered next to a label or control. Opens on hover,
 * keyboard focus or tap; closes on Escape, blur, or an outside click. The bubble
 * uses fixed positioning so it never gets clipped by a card's rounded corners,
 * and flips above the trigger when there isn't room below.
 *
 * Purely explanatory — it changes nothing about the control it annotates.
 */
export function InfoHint({
  children,
  label = "Erklärung anzeigen",
  className,
  iconClassName,
}: InfoHintProps) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const bubbleRef = React.useRef<HTMLDivElement>(null);

  const bubbleId = React.useId();

  const place = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
    left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN),
    );

    // Default: below the trigger. Flip above if the bubble would run off the
    // bottom of the viewport (uses the measured height once rendered).
    let top = rect.bottom + GAP;
    const bubbleHeight = bubbleRef.current?.offsetHeight ?? 0;
    if (bubbleHeight && top + bubbleHeight + VIEWPORT_MARGIN > window.innerHeight) {
      const above = rect.top - GAP - bubbleHeight;
      if (above >= VIEWPORT_MARGIN) top = above;
    }
    setCoords({ top, left });
  }, []);

  const show = React.useCallback(() => {
    place();
    setOpen(true);
  }, [place]);

  const hide = React.useCallback(() => setOpen(false), []);

  // Re-measure once the bubble is in the DOM so the vertical flip can use its
  // real height, and keep it anchored while open (scroll/resize).
  useIsomorphicLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || bubbleRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function reposition() {
      place();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, place]);

  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? bubbleId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center rounded-full text-muted transition-colors",
          "hover:text-teal focus-visible:text-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/30",
          iconClassName,
        )}
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && coords && (
        <div
          ref={bubbleRef}
          id={bubbleId}
          role="tooltip"
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            width: POPOVER_WIDTH,
          }}
          className="z-50 rounded-lg border border-black/10 bg-white p-3 text-xs font-normal leading-relaxed text-ink shadow-lg"
        >
          {children}
        </div>
      )}
    </span>
  );
}
