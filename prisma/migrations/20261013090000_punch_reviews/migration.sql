-- CreateTable
CREATE TABLE "PunchReview" (
    "id" TEXT NOT NULL,
    "clockEventId" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PunchReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PunchReview_clockEventId_key" ON "PunchReview"("clockEventId");

-- AddForeignKey
ALTER TABLE "PunchReview" ADD CONSTRAINT "PunchReview_clockEventId_fkey" FOREIGN KEY ("clockEventId") REFERENCES "ClockEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PunchReview" ADD CONSTRAINT "PunchReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
