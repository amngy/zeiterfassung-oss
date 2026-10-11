-- AlterEnum
-- New absence types (#21). PostgreSQL 12+ accepts several ADD VALUE
-- statements in one migration as long as the new values are not used in it.
ALTER TYPE "AbsenceType" ADD VALUE 'SPECIAL_LEAVE';
ALTER TYPE "AbsenceType" ADD VALUE 'TRAINING';
ALTER TYPE "AbsenceType" ADD VALUE 'BUSINESS_TRIP';
ALTER TYPE "AbsenceType" ADD VALUE 'TIME_OFF_IN_LIEU';
ALTER TYPE "AbsenceType" ADD VALUE 'UNPAID_LEAVE';
ALTER TYPE "AbsenceType" ADD VALUE 'PARENTAL_LEAVE';
ALTER TYPE "AbsenceType" ADD VALUE 'MATERNITY_PROTECTION';
ALTER TYPE "AbsenceType" ADD VALUE 'CHILD_SICK';
