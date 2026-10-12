-- Arbeitszeitkonto (#22): account start per person, and the bookings that
-- move the balance besides worked time.

-- CreateEnum
CREATE TYPE "OvertimeBookingKind" AS ENUM ('OPENING', 'PAYOUT', 'FORFEIT', 'ADJUSTMENT', 'CARRY_FORWARD');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "overtimeAccountFrom" DATE;

-- CreateTable
CREATE TABLE "OvertimeBooking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "OvertimeBookingKind" NOT NULL,
    "day" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversesId" TEXT,

    CONSTRAINT "OvertimeBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OvertimeBooking_reversesId_key" ON "OvertimeBooking"("reversesId");

-- CreateIndex
CREATE INDEX "OvertimeBooking_userId_day_idx" ON "OvertimeBooking"("userId", "day");

-- AddForeignKey
ALTER TABLE "OvertimeBooking" ADD CONSTRAINT "OvertimeBooking_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "OvertimeBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeBooking" ADD CONSTRAINT "OvertimeBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
