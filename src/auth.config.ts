import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

/**
 * Edge-safe Auth.js configuration shared by the middleware and the full Node
 * config. It must NOT import Prisma, argon2, or any other Node-only module —
 * the middleware runs on the Edge runtime.
 */
export const authConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 30, // 30 days (rolling); "remember me" downgrade in actions
    updateAge: 60 * 60 * 24, // refresh once per day
  },
  callbacks: {
    // Route protection — runs in middleware for every matched request.
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const path = nextUrl.pathname;
      const isLoggedIn = !!auth?.user;
      const isAdmin = auth?.user?.role === "ADMIN";

      // The design preview is a public, data-free demo page.
      if (path.startsWith("/design")) return true;

      if (path.startsWith("/login")) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/dashboard", nextUrl));
        }
        return true;
      }

      if (!isLoggedIn) return false; // → Auth.js redirects to the sign-in page

      // Admin area is ADMIN-only; employees are bounced to their dashboard.
      if (path.startsWith("/admin") && !isAdmin) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        // token.id/role are written by the jwt callback above.
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
  providers: [], // real provider lives in auth.ts (Node runtime only)
} satisfies NextAuthConfig;
