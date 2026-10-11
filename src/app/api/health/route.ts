// Healthcheck endpoint for Railway (and any uptime probe). Verifies the process
// is up AND the database is reachable, so a deploy is only marked healthy once
// migrations/connection succeed. Excluded from auth in src/proxy.ts.

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic"; // never cache; always probe live

export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "up" });
  } catch {
    return Response.json({ status: "error", db: "down" }, { status: 503 });
  }
}
