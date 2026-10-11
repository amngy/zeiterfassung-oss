import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variantClasses: Record<Variant, string> = {
  // Lime is the brand's primary call-to-action colour (white text).
  primary: "bg-lime text-white hover:bg-lime-dark focus-visible:ring-lime/50 shadow-sm",
  secondary: "bg-teal text-white hover:bg-teal-dark focus-visible:ring-teal/40 shadow-sm",
  outline: "border border-teal/30 bg-white text-teal hover:bg-surface focus-visible:ring-teal/30",
  ghost: "bg-transparent text-ink hover:bg-surface focus-visible:ring-teal/20",
  danger: "bg-danger text-white hover:bg-danger-dark focus-visible:ring-danger/40 shadow-sm",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
  icon: "h-10 w-10 justify-center",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-xl font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
