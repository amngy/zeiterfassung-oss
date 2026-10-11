/**
 * Branding — the one place that identifies a particular deployment.
 *
 * Rebranding an installation means editing this file and replacing the logo
 * in /public; no other file names the organisation. It is also read by
 * tailwind.config.ts at build time, so it must stay free of imports.
 */
export const BRAND = {
  /** Product name: browser tab title, PDF footer, default company name. */
  appName: "Zeiterfassung",
  /** One sentence for the HTML meta description. */
  description:
    "Arbeitszeiten, Pausen, Urlaub und Abwesenheiten erfassen — datenschutzkonform und revisionssicher.",
  /**
   * Wordmark served from /public. On the primary-coloured header and login
   * panel it is placed on a white chip, so any logo that reads on white works.
   */
  logo: {
    src: "/logo.svg",
    alt: "Zeiterfassung",
    width: 240,
    height: 64,
  },
  /** Name in the login page's © line; an empty string hides the line. */
  copyrightHolder: "",
  /**
   * Brand colours as hex. In Tailwind they are the `teal` (primary surfaces,
   * headings) and `lime` (primary buttons, positive states) tokens.
   */
  colors: {
    primary: "#136860",
    primaryDark: "#0E4F4A",
    accent: "#8FB83E",
    accentDark: "#79991F",
  },
} as const;
