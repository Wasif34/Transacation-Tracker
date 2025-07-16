/*
  Warnings:

  - Added the required column `updatedAt` to the `DailySummary` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "DailySummary" ADD COLUMN     "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "inAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "outAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "transactionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMPTZ NOT NULL,
ALTER COLUMN "date" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "InvalidTransaction" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "timestamp" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "DailySummary_date_idx" ON "DailySummary"("date");

-- CreateIndex
CREATE INDEX "InvalidTransaction_transactionId_idx" ON "InvalidTransaction"("transactionId");

-- CreateIndex
CREATE INDEX "Transaction_timestamp_idx" ON "Transaction"("timestamp");

-- CreateIndex
CREATE INDEX "Transaction_timestamp_type_idx" ON "Transaction"("timestamp", "type");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");
