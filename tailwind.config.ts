import type { Config } from "tailwindcss";
import { BRAND } from "./src/config/brand";

/**
 * Design tokens. The two brand colours come from src/config/brand.ts; their
 * token names are historical and do not constrain the actual hue:
 *   teal            brand primary      -> primary surfaces / headings
 *   teal.dark       brand primaryDark  -> hover/active on teal
 *   lime            brand accent       -> primary buttons / key actions
 *   lime.dark       brand accentDark   -> hover on lime
 *   surface         #F5F7F6  -> cards / panels         (bg-surface)
 *   ink             #1F2A28  -> body text token "text" (text-ink)
 *   muted           #6B7A77  -> secondary text         (text-muted)
 *   danger          #C0392B  -> errors / rule violations
 * Page background is plain white (bg-white), per the spec's `bg` token.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        teal: {
          DEFAULT: BRAND.colors.primary,
          dark: BRAND.colors.primaryDark,
        },
        lime: {
          DEFAULT: BRAND.colors.accent,
          dark: BRAND.colors.accentDark,
        },
        surface: "#F5F7F6",
        ink: "#1F2A28",
        muted: "#6B7A77",
        danger: {
          DEFAULT: "#C0392B",
          dark: "#A93226",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(31, 42, 40, 0.04), 0 4px 16px rgba(31, 42, 40, 0.06)",
        "card-hover": "0 2px 4px rgba(31, 42, 40, 0.06), 0 8px 28px rgba(31, 42, 40, 0.10)",
      },
    },
  },
  plugins: [],
};

export default config;
