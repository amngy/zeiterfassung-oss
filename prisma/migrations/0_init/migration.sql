-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'ADMIN');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('WORK', 'BREAK');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('CLOCK', 'MANUAL');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AbsenceType" AS ENUM ('VACATION', 'SICK');

-- CreateEnum
CREATE TYPE "HolidayType" AS ENUM ('PUBLIC', 'GIFTED');

-- CreateEnum
CREATE TYPE "HolidayFraction" AS ENUM ('FULL', 'HALF');

-- CreateEnum
CREATE TYPE "HolidaySource" AS ENUM ('SEEDED', 'MANUAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "vacationDaysPerYear" DOUBLE PRECISION NOT NULL DEFAULT 28,
    "vacationCarryOverDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carryOverReminderSentAt" TIMESTAMP(3),
    "bundesland" TEXT,
    "birthDate" DATE,
    "isSchwerbehindert" BOOLEAN NOT NULL DEFAULT false,
    "schwerbehindertFrom" DATE,
    "schwerbehindertTo" DATE,
    "isMinijob" BOOLEAN NOT NULL DEFAULT false,
    "exemptFromTimeRecording" BOOLEAN NOT NULL DEFAULT false,
    "employmentStart" DATE,
    "employmentEnd" DATE,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "hoursMon" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursTue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursWed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursThu" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursFri" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursSat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursSun" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "EntryType" NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3),
    "source" "EntrySource" NOT NULL DEFAULT 'CLOCK',
    "status" "EntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "supersedesId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timeEntryId" TEXT,
    "proposedType" "EntryType",
    "proposedStart" TIMESTAMP(3),
    "proposedEnd" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AbsenceType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "halfDayStart" BOOLEAN NOT NULL DEFAULT false,
    "halfDayEnd" BOOLEAN NOT NULL DEFAULT false,
    "workingDaysCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "sickNoteOnFile" BOOLEAN NOT NULL DEFAULT false,
    "creditedBackFromVacation" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HolidayType" NOT NULL DEFAULT 'PUBLIC',
    "fraction" "HolidayFraction" NOT NULL DEFAULT 'FULL',
    "bundesland" TEXT,
    "municipalityNote" TEXT,
    "recurringAnnually" BOOLEAN NOT NULL DEFAULT false,
    "source" "HolidaySource" NOT NULL DEFAULT 'SEEDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_active_idx" ON "User"("active");

-- CreateIndex
CREATE INDEX "WorkSchedule_userId_effectiveFrom_idx" ON "WorkSchedule"("userId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_supersedesId_key" ON "TimeEntry"("supersedesId");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_start_idx" ON "TimeEntry"("userId", "start");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_status_idx" ON "TimeEntry"("userId", "status");

-- CreateIndex
CREATE INDEX "CorrectionRequest_userId_status_idx" ON "CorrectionRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "CorrectionRequest_status_idx" ON "CorrectionRequest"("status");

-- CreateIndex
CREATE INDEX "Absence_userId_startDate_idx" ON "Absence"("userId", "startDate");

-- CreateIndex
CREATE INDEX "Absence_type_status_idx" ON "Absence"("type", "status");

-- CreateIndex
CREATE INDEX "Holiday_date_idx" ON "Holiday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_name_bundesland_key" ON "Holiday"("date", "name", "bundesland");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "TimeEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

