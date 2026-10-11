import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Next 16 "proxy" convention (formerly middleware). Uses only the Edge-safe
// Auth.js config: verifies the session JWT and runs the `authorized` callback
// for route protection. No Node-only modules (Prisma/argon2) are imported here.
export default NextAuth(authConfig).auth;

export const config = {
  // Run on everything except Auth.js routes, the healthcheck, Next internals
  // and static assets. /sitzung-beendet deletes the session cookie, which the
  // proxy would re-issue on the same response.
  matcher: [
    "/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|sitzung-beendet$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
