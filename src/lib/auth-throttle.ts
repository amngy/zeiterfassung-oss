import { prisma } from "@/lib/db";

// ── Login throttling ─────────────────────────────────────────────────────────
//
// THREAT MODEL AND WHY THERE ARE TWO COUNTERS
//
// The original design had exactly one counter, keyed to the VICTIM: five bad
// passwords locked the account for 15 minutes. Nothing was keyed to the
// attacker, which turned the security control into a denial-of-service weapon —
// anyone who knows a colleague's e-mail address can lock them out at will, and
// re-arm it every 15 minutes. Pointed at every admin address it locks
// administration out of production altogether, because the only unlock paths
// (`resetUserPassword`, editing the account) need an admin who can still log in.
//
// So there are now two counters, and the important part is their RELATIVE size:
//
//   1. Per source (IP): at most MAX_SOURCE_FAILURES failures per
//      WINDOW_MINUTES. Exceeding it rejects every further attempt from that
//      source until the window rolls over. This is the primary control — it
//      costs the attacker nothing to trip and costs the victim nothing at all.
//
//   2. Per account: the classic lock, but it now needs BOTH
//      MAX_LOGIN_ATTEMPTS failures AND failures from at least
//      MIN_DISTINCT_SOURCES different sources.
//
// MAX_LOGIN_ATTEMPTS (25) is deliberately larger than MAX_SOURCE_FAILURES (15):
// a single source is cut off at 15 and therefore can NEVER drive one account to
// 25 on its own. The account lock survives only for what it is actually good
// at — distributed credential stuffing, where each source stays under its own
// limit — and is unreachable for the single-attacker DoS above.
//
// Neither block is permanent and neither needs an operator to clear it: the
// source window and the account lock both expire after 15 minutes on their own.
// That is what makes it safe to fail CLOSED when the client address cannot be
// determined (see `clientIp`).
//
// Secondary benefit: because src/auth.ts now runs an argon2id verification on
// every login path (to close the timing oracle), each request costs the server
// ~25 ms of CPU. The source check runs BEFORE that verification, so a blocked
// attacker is rejected with a single indexed query and cannot use the login
// endpoint as a CPU-exhaustion lever.
//
// STORAGE: table "LoginThrottle", created by migration
// 20260730130000_security_hardening. It is intentionally not in
// prisma/schema.prisma and is only ever touched through raw SQL from this
// module — see the migration for the drift caveat.

/** Failures one source may produce per window before it is cut off. */
export const MAX_SOURCE_FAILURES = 15;
/** Failures against one account before the account lock is *considered*. */
export const MAX_LOGIN_ATTEMPTS = 25;
/** …and how many distinct sources must have contributed to them. */
export const MIN_DISTINCT_SOURCES = 2;
/** Rolling window for the source counter, and the account lock duration. */
export const WINDOW_MINUTES = 15;
export const LOCKOUT_MINUTES = 15;
/** Expired buckets older than this are garbage-collected opportunistically. */
const GC_AFTER_MINUTES = 60;
/** Probability of running the (cheap, indexed) GC delete on a failed attempt. */
const GC_PROBABILITY = 0.02;

/** Sentinel bucket for attempts whose source address could not be determined. */
const UNKNOWN_SOURCE = "unknown";
/** Bucket key used when the submitted e-mail matched no account. */
const NO_ACCOUNT = "";

/**
 * Resolve the client address from the proxy headers.
 *
 * IMPORTANT: every one of these headers is client-controllable unless the proxy
 * in front of the app SETS it. Railway's edge documents exactly one such header,
 * `X-Real-IP`; it does not promise to overwrite `X-Forwarded-For`, whose first
 * entry is therefore whatever the client sent. Trusting that entry let a single
 * attacker rotate a forged value per request: the source throttle never tripped,
 * and — worse — the per-account lock (which needs MIN_DISTINCT_SOURCES) became
 * reachable from one machine again, reviving the lock-out-a-colleague DoS.
 *
 * So `X-Real-IP` is the default. Behind a different proxy, set
 * CLIENT_IP_HEADER to the header that proxy overwrites (e.g. `cf-connecting-ip`
 * behind Cloudflare). For `x-forwarded-for` the LAST entry is used — the one
 * appended by the proxy closest to the app — never the client-supplied first.
 * If the app is ever run with a direct public port, no header is trustworthy
 * and the per-account lock is the only remaining control.
 *
 * When the header is absent (local `next dev`, or a broken proxy configuration)
 * every attempt lands in one shared `unknown` bucket, i.e. the throttle fails
 * CLOSED. That is deliberate: a proxy misconfiguration should be noticeable
 * rather than silently disable brute-force protection, and the worst case is a
 * 15-minute delay because the window expires by itself.
 */
export function clientIp(headers: Headers | null | undefined): string {
  if (!headers) return UNKNOWN_SOURCE;
  const name = (process.env.CLIENT_IP_HEADER || "x-real-ip").trim().toLowerCase();
  const value = headers.get(name) ?? "";
  const raw =
    name === "x-forwarded-for"
      ? (value.split(",").at(-1) ?? "").trim()
      : value.trim();
  return raw ? normaliseAddress(raw) : UNKNOWN_SOURCE;
}

/**
 * Collapse an IPv6 address to its /64 prefix. A single attacker is routinely
 * handed a whole /64, so throttling full IPv6 addresses is throttling nothing.
 * IPv4 (and anything unparseable) is used verbatim, truncated to a sane length.
 */
function normaliseAddress(address: string): string {
  const value = address.replace(/^\[|\]$/g, "").split("%")[0] ?? address;
  if (value.includes(":") && !value.includes(".")) {
    const groups = value.split(":");
    // Only safe to truncate when the address is written out in full; a "::"
    // shorthand hides how many groups are elided, so leave it alone.
    if (groups.length === 8) return `${groups.slice(0, 4).join(":")}::/64`;
  }
  return value.slice(0, 64);
}

/**
 * True when this source has spent its failure budget for the current window.
 * Callers must check this BEFORE doing any password verification.
 *
 * Fails OPEN on a database error (including "relation does not exist", i.e. the
 * app deployed ahead of its migration): losing the throttle is bad, refusing
 * every login in the company is worse.
 */
export async function isSourceBlocked(ip: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ failures: number }[]>`
      SELECT COALESCE(SUM("failures"), 0)::int AS failures
      FROM "LoginThrottle"
      WHERE "ip" = ${ip}
        AND "firstFailureAt" > now() - (${WINDOW_MINUTES}::int * interval '1 minute')
    `;
    return (rows[0]?.failures ?? 0) >= MAX_SOURCE_FAILURES;
  } catch (e) {
    console.error("auth-throttle: source check failed, allowing attempt", e);
    return false;
  }
}

/**
 * Record a failed attempt.
 *
 * `userId` is null when the e-mail matched no account, or matched an account
 * that is inactive or already locked — those attempts still count against the
 * SOURCE (hammering a locked account is just as abusive) but must not touch the
 * account counter, so a lock can never be extended by attacking it.
 */
export async function recordFailedLogin(args: {
  userId?: string | null;
  ip: string;
}): Promise<void> {
  const { userId, ip } = args;
  await bumpSource(ip, userId ?? NO_ACCOUNT);
  if (!userId) return;

  const user = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });

  // The account lock is the distributed-attack control only: it needs the high
  // failure count AND several distinct sources. A single source is cut off at
  // MAX_SOURCE_FAILURES (< MAX_LOGIN_ATTEMPTS) long before it gets here, so one
  // attacker can no longer lock a colleague — or every admin — out.
  if (user.failedLoginAttempts < MAX_LOGIN_ATTEMPTS) return;
  if ((await distinctSources(userId)) < MIN_DISTINCT_SOURCES) return;

  await prisma.user.update({
    where: { id: userId },
    data: {
      lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
      failedLoginAttempts: 0,
    },
  });
}

/** Clear both counters on a successful login. */
export async function recordSuccessfulLogin(args: {
  userId: string;
  ip: string;
}): Promise<void> {
  await prisma.user.update({
    where: { id: args.userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
  // Drop this (source, account) bucket so an employee who mistypes a few times
  // and then succeeds does not leave their office IP closer to the limit.
  // Scoped to the source that just succeeded on purpose: a legitimate login must
  // not wipe the failures some other address has been racking up against the
  // same account — those are exactly the evidence the account lock exists for.
  try {
    await prisma.$executeRaw`
      DELETE FROM "LoginThrottle" WHERE "ip" = ${args.ip} AND "userId" = ${args.userId}
    `;
  } catch (e) {
    console.error("auth-throttle: could not clear source counters", e);
  }
}

/** Increment (or roll over) the (source, account) bucket. */
async function bumpSource(ip: string, userKey: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO "LoginThrottle" ("ip", "userId", "failures", "firstFailureAt", "lastFailureAt")
      VALUES (${ip}, ${userKey}, 1, now(), now())
      ON CONFLICT ("ip", "userId") DO UPDATE SET
        "failures" = CASE
          WHEN "LoginThrottle"."firstFailureAt"
               <= now() - (${WINDOW_MINUTES}::int * interval '1 minute') THEN 1
          ELSE "LoginThrottle"."failures" + 1
        END,
        "firstFailureAt" = CASE
          WHEN "LoginThrottle"."firstFailureAt"
               <= now() - (${WINDOW_MINUTES}::int * interval '1 minute') THEN now()
          ELSE "LoginThrottle"."firstFailureAt"
        END,
        "lastFailureAt" = now()
    `;
    if (Math.random() < GC_PROBABILITY) await collectGarbage();
  } catch (e) {
    console.error("auth-throttle: could not record source failure", e);
  }
}

/** How many distinct sources have an open failure bucket for this account. */
async function distinctSources(userId: string): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ sources: number }[]>`
      SELECT count(*)::int AS sources
      FROM "LoginThrottle"
      WHERE "userId" = ${userId}
        AND "failures" > 0
        AND "firstFailureAt" > now() - (${WINDOW_MINUTES}::int * interval '1 minute')
    `;
    return rows[0]?.sources ?? 0;
  } catch (e) {
    // Fail towards NOT locking: an unavailable counter must not hand an
    // attacker the account lockout this whole design exists to take away.
    console.error("auth-throttle: source-diversity check failed, not locking", e);
    return 0;
  }
}

/** Keep the table bounded; buckets are worthless once their window has passed. */
async function collectGarbage(): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "LoginThrottle"
    WHERE "lastFailureAt" < now() - (${GC_AFTER_MINUTES}::int * interval '1 minute')
  `;
}
