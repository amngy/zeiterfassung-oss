// Remote punches flagged for an admin's look (#32). The flag is computed on
// every read from the stored punches, entries and schedule — so a later
// correction or a changed threshold is reflected at once — and only the
// admin's "geprüft" is stored (PunchReview), together with an audit record.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getAppSettings } from "@/lib/settings";
import { getPeriodSummary } from "@/lib/timesheet";
import { berlinDayKey, berlinDayRange, needsRemoteReview, type PeriodSummary } from "@/lib/time";

export class PunchReviewError extends Error {}

export interface RemoteReviewFlag {
  eventId: string;
  userId: string;
  userName: string;
  /** Berlin day of the clock-out. */
  dayKey: string;
  at: Date;
  deviceLabel: string | null;
  workedMs: number;
  expectedMs: number;
  balanceMs: number;
  reviewedAt: Date | null;
  reviewedByName: string | null;
}

/**
 * Days in [fromKey, toKey] that a remote clock-out closed more than the
 * configured minutes over the Soll — reviewed or not, oldest first.
 *
 * A clock-out only counts while it still stands as punched (its entry is
 * ACTIVE and still ends at that instant) and if it was the day's last
 * work end. Pass `period` for a single `userId` to reuse a summary the
 * caller already has.
 */
export async function findRemoteReviewFlags(args: {
  fromKey: string;
  toKey: string;
  userId?: string;
  period?: PeriodSummary;
  asOf?: Date;
}): Promise<RemoteReviewFlag[]> {
  const asOf = args.asOf ?? new Date();
  const threshold = (await getAppSettings()).punchPolicy.reviewRemoteOvertimeMinutes;
  if (threshold <= 0) return [];

  const windowStart = berlinDayRange(args.fromKey).start;
  const windowEnd = berlinDayRange(args.toKey).end;
  const events = await prisma.clockEvent.findMany({
    where: {
      kind: "CLOCK_OUT",
      channel: "WEB",
      at: { gte: windowStart, lt: windowEnd },
      ...(args.userId ? { userId: args.userId } : {}),
      timeEntry: { status: "ACTIVE" },
    },
    orderBy: { at: "asc" },
    select: {
      id: true,
      userId: true,
      at: true,
      channel: true,
      deviceLabel: true,
      user: { select: { name: true } },
      timeEntry: { select: { end: true } },
      review: { select: { reviewedAt: true, reviewedBy: { select: { name: true } } } },
    },
  });
  const standing = events.filter((e) => e.timeEntry.end?.getTime() === e.at.getTime());

  const byUser = new Map<string, typeof standing>();
  for (const e of standing) byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e]);

  const flags: RemoteReviewFlag[] = [];
  for (const [userId, list] of byUser) {
    const keys = list.map((e) => berlinDayKey(e.at)).sort();
    const from = keys[0]!;
    const to = keys[keys.length - 1]!;
    const [period, workEnds] = await Promise.all([
      args.period && args.userId === userId ? args.period : getPeriodSummary(userId, from, to, asOf),
      prisma.timeEntry.findMany({
        where: {
          userId,
          status: "ACTIVE",
          type: "WORK",
          end: { gte: berlinDayRange(from).start, lt: berlinDayRange(to).end },
        },
        select: { end: true },
      }),
    ]);
    const lastWorkEnd = new Map<string, number>();
    for (const { end } of workEnds) {
      const key = berlinDayKey(end!);
      lastWorkEnd.set(key, Math.max(lastWorkEnd.get(key) ?? 0, end!.getTime()));
    }
    const days = new Map(period.days.map((d) => [d.date, d]));

    for (const e of list) {
      const key = berlinDayKey(e.at);
      const day = days.get(key);
      if (!day || lastWorkEnd.get(key) !== e.at.getTime()) continue;
      if (!needsRemoteReview(day, e.channel, threshold)) continue;
      flags.push({
        eventId: e.id,
        userId,
        userName: e.user.name,
        dayKey: key,
        at: e.at,
        deviceLabel: e.deviceLabel,
        workedMs: day.workedMs,
        expectedMs: day.expectedMs,
        balanceMs: day.balanceMs,
        reviewedAt: e.review?.reviewedAt ?? null,
        reviewedByName: e.review?.reviewedBy?.name ?? null,
      });
    }
  }
  return flags.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Day key → "open" | "reviewed", for the timesheet's day badges. */
export function reviewStateByDay(flags: RemoteReviewFlag[]): Record<string, "open" | "reviewed"> {
  const out: Record<string, "open" | "reviewed"> = {};
  for (const f of flags) out[f.dayKey] = f.reviewedAt ? "reviewed" : "open";
  return out;
}

/** Record an admin's "geprüft" for a flagged clock-out, audited. */
export async function markRemoteReviewed(eventId: string, actorId: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const event = await tx.clockEvent.findUnique({
        where: { id: eventId },
        select: { userId: true, at: true, channel: true },
      });
      if (!event) throw new PunchReviewError("Stempelung nicht gefunden.");
      await tx.punchReview.create({ data: { clockEventId: eventId, reviewedById: actorId } });
      await writeAudit(tx, {
        actorUserId: actorId,
        action: "punch.review",
        targetType: "ClockEvent",
        targetId: eventId,
        newValue: { userId: event.userId, at: event.at.toISOString(), channel: event.channel },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new PunchReviewError("Bereits als geprüft markiert.");
    }
    throw e;
  }
}
