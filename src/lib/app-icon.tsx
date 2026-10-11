import { ImageResponse } from "next/og";
import { BRAND } from "@/config/brand";

// The home-screen / favicon icon, drawn rather than shipped as files so that a
// rebrand (src/config/brand.ts) changes it too: a clock on the primary colour.
// The wordmark in /public is too wide to serve as an icon.

/**
 * rounded  — transparent corners, for browsers and Android "any" icons
 * square   — full bleed; iOS applies its own mask
 * maskable — full bleed with the glyph inside the 80 % safe zone Android may crop to
 */
export type AppIconShape = "rounded" | "square" | "maskable";

export function appIcon(size: number, shape: AppIconShape = "rounded"): ImageResponse {
  const glyph = Math.round(size * (shape === "maskable" ? 0.5 : 0.62));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.colors.primary,
          borderRadius: shape === "rounded" ? Math.round(size * 0.22) : 0,
        }}
      >
        <svg
          width={glyph}
          height={glyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
