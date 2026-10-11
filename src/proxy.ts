import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Next 16 "proxy" convention (formerly middleware). Uses only the Edge-safe
// Auth.js config: verifies the session JWT and runs the `authorized` callback
// for route protection. No Node-only modules (Prisma/argon2) are imported here.
export default NextAuth(authConfig).auth;

export const config = {
  // Run on everything except Auth.js routes, the healthcheck, Next internals,
  // static assets and the on-site terminal. The terminal has no user session —
  // every /terminal route checks its own device cookie — and running Auth.js
  // there would re-issue a leftover user session on every 30 s poll.
  matcher: [
    "/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|terminal(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
