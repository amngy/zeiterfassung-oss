-- CreateEnum
CREATE TYPE "ClockChannel" AS ENUM ('WEB', 'KIOSK', 'NFC', 'QR');

-- CreateEnum
CREATE TYPE "ClockEventKind" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END');

-- CreateTable
CREATE TABLE "ClockEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ClockEventKind" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "channel" "ClockChannel" NOT NULL,
    "deviceLabel" TEXT,
    "timeEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClockEvent_userId_at_idx" ON "ClockEvent"("userId", "at");

-- CreateIndex
CREATE INDEX "ClockEvent_timeEntryId_idx" ON "ClockEvent"("timeEntryId");

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

