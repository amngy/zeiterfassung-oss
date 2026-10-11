-- AlterTable
ALTER TABLE "ClockEvent" ADD COLUMN     "terminalId" TEXT;

-- CreateTable
CREATE TABLE "ClockTerminal" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tokenHash" TEXT,
    "pairCodeHash" TEXT,
    "pairExpiresAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClockTerminal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClockTerminal_tokenHash_key" ON "ClockTerminal"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ClockTerminal_pairCodeHash_key" ON "ClockTerminal"("pairCodeHash");

-- CreateIndex
CREATE INDEX "ClockEvent_terminalId_idx" ON "ClockEvent"("terminalId");

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "ClockTerminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

