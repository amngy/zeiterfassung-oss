import type { MetadataRoute } from "next";
import { BRAND } from "@/config/brand";

// Makes the app installable on phones ("Zum Home-Bildschirm"). Opens on the
// dashboard, which carries the clock card. No service worker yet: punching
// needs the server's clock, so there is nothing useful to do offline.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND.appName,
    short_name: BRAND.appName,
    description: BRAND.description,
    lang: "de",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: BRAND.colors.primary,
    icons: [
      { src: "/app-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
