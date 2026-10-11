import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "teal" | "lime" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface text-muted border-black/[0.06]",
  teal: "bg-teal/10 text-teal border-teal/20",
  lime: "bg-lime/15 text-lime-dark border-lime/30",
  warning: "bg-amber-100 text-amber-800 border-amber-200",
  danger: "bg-danger/10 text-danger border-danger/20",
  info: "bg-sky-100 text-sky-800 border-sky-200",
};

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
