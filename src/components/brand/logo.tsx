import { BRAND } from "@/config/brand";
import { cn } from "@/lib/cn";

type Size = "sm" | "md" | "lg";

interface LogoProps {
  /** "light" for use on a white background, "dark" for use on a teal surface. */
  variant?: "light" | "dark";
  /** Rendered size of the wordmark. */
  size?: Size;
  /** Kept for backwards compatibility; the wordmark image already includes the name. */
  showSubtitle?: boolean;
  className?: string;
}

const imgHeight: Record<Size, string> = {
  sm: "h-7",
  md: "h-9",
  lg: "h-14",
};

const chipPad: Record<Size, string> = {
  sm: "px-2.5 py-1.5",
  md: "px-3 py-2",
  lg: "px-5 py-3.5",
};

/**
 * The deployment's wordmark (see src/config/brand.ts), served from /public.
 * On the primary-coloured surface ("dark") it is placed on a white rounded chip
 * to stay legible; on white it is shown directly.
 */
export function Logo({ variant = "light", size = "md", className }: LogoProps) {
  const onDark = variant === "dark";
  return (
    <span
      className={cn(
        "inline-flex items-center",
        onDark && cn("rounded-xl bg-white shadow-sm", chipPad[size]),
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset; fixed height, optimizer adds nothing */}
      <img
        src={BRAND.logo.src}
        alt={BRAND.logo.alt}
        width={BRAND.logo.width}
        height={BRAND.logo.height}
        className={cn("w-auto", imgHeight[size])}
      />
    </span>
  );
}
