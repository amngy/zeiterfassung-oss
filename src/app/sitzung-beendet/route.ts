import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { clearSessionCookies } from "@/lib/session-cookies";

// requireUser() sends a session here whose account was deleted or deactivated.
// Its JWT is still valid, so /login would bounce it straight back to the app
// (an endless redirect loop); this route deletes the cookie first. It is
// outside the auth proxy, which would otherwise re-issue the cookie on the
// same response. A session that is still fine goes back to the app, so a link
// to this page cannot sign anyone out.
export async function GET(): Promise<never> {
  const id = (await auth())?.user?.id;
  const account = id
    ? await prisma.user.findUnique({ where: { id }, select: { active: true } })
    : null;
  if (account?.active) redirect("/dashboard");
  clearSessionCookies(await cookies());
  redirect("/login");
}
