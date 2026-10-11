import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Resolve the JWT-backed session user, or redirect to login. No DB access. */
async function sessionUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    role: session.user.role,
  };
}

/**
 * Returns the signed-in user or redirects to the login page.
 *
 * Confirms the account still exists in the database: a JWT can outlive the row
 * it points to — the account was deleted, or (before go-live) the database was
 * reset/reseeded with fresh ids while an old cookie lingered. Without this, any
 * page that later loads the user by id (e.g. getVacationAccount →
 * findUniqueOrThrow) throws P2025 and 500s the whole page instead of the stale
 * session simply being signed out. One indexed primary-key lookup per page.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await sessionUser();
  // Re-read `active` and `role` rather than just existence. The JWT pins the role
  // at sign-in and lives for 30 days, so checking only existence let a demoted,
  // deactivated or anonymised account keep opening every admin PAGE (and reading
  // everyone's times, absences and the audit trail) until the token expired.
  // There is no server-side session store, so nothing else can revoke it.
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { active: true, role: true, name: true, email: true },
  });
  if (!fresh || !fresh.active) redirect("/login");
  return {
    id: user.id,
    name: fresh.name,
    email: fresh.email,
    role: fresh.role, // current DB role, never the (possibly stale) token role
  };
}

/**
 * Like {@link requireUser} but additionally re-validates the account against the
 * database, so a user deactivated (or whose role changed) after their JWT was
 * issued cannot keep mutating data for the remaining 30-day token lifetime.
 * Use this on every write path (clock punches, corrections, admin mutations);
 * read-only pages can use the cheaper {@link requireUser}. Its own lookup also
 * covers the "user no longer exists" case (fresh === null → redirect).
 */
export async function requireActiveUser(): Promise<SessionUser> {
  const user = await sessionUser();
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { active: true, role: true, name: true, email: true },
  });
  if (!fresh || !fresh.active) redirect("/login");
  return {
    id: user.id,
    name: fresh.name,
    email: fresh.email,
    role: fresh.role, // use the current DB role, not the (possibly stale) token
  };
}

/** Returns the signed-in admin or redirects (to login or dashboard). */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/dashboard");
  return user;
}
