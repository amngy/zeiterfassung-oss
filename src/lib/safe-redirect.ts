// Where to send someone after sign-in. Auth.js passes the page they wanted as
// an absolute `callbackUrl` (…/login?callbackUrl=https://host/q/…); only its
// path is ever used, so a crafted link cannot send anyone to another site.

/** The same-origin path in `raw`, or null if there is none worth following. */
export function safeInternalPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw, "http://internal.invalid");
  } catch {
    return null;
  }
  const path = `${url.pathname}${url.search}`;
  // "//evil" and "/\evil" are protocol-relative to a browser.
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  if (path === "/" || path.startsWith("/login") || path.startsWith("/api/")) return null;
  return path;
}
