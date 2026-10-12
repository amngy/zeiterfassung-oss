-- Punching by name + PIN at an on-site terminal (#11).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kioskPinHash" TEXT,
ADD COLUMN     "kioskPinFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kioskPinBlockedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ClockTerminal" ADD COLUMN     "allowPin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinFailuresSince" TIMESTAMP(3),
ADD COLUMN     "pinBlockedUntil" TIMESTAMP(3);
