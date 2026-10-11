import type { cookies } from "next/headers";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/**
 * Delete every Auth.js session cookie on this response, including chunked
 * ".0"/".1" parts. Over HTTPS Auth.js names them "__Secure-…", and browsers
 * ignore a deletion of such a cookie unless it also carries Secure — a plain
 * `cookies().delete(name)` would leave the session in place in production.
 */
export function clearSessionCookies(store: CookieStore): void {
  for (const { name } of store.getAll()) {
    if (!name.includes("authjs.session-token")) continue;
    store.delete({
      name,
      path: "/",
      secure: name.startsWith("__Secure-") || name.startsWith("__Host-"),
    });
  }
}
