-- No legacy backfill; no invented purchases, gifts or payment records.
BEGIN;
CREATE TYPE "PaidPlan" AS ENUM ('BASIC', 'ADVANCED', 'UNLIMITED');
CREATE TYPE "EntitlementSource" AS ENUM ('PURCHASE', 'GIFT');
CREATE TABLE "EntitlementAccount" (
  "userId" TEXT PRIMARY KEY,
  "verifiedAt" TIMESTAMP(3),
  "provenance" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntitlementAccount_provenance" CHECK (length(btrim("provenance")) > 0),
  CONSTRAINT "EntitlementAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "EntitlementPeriod" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "plan" "PaidPlan" NOT NULL,
  "source" "EntitlementSource" NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntitlementPeriod_interval" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "EntitlementPeriod_reference" CHECK (length(btrim("sourceReference")) > 0),
  CONSTRAINT "EntitlementPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EntitlementPeriod_source_sourceReference_key" ON "EntitlementPeriod"("source", "sourceReference");
CREATE INDEX "EntitlementPeriod_userId_startsAt_endsAt_idx" ON "EntitlementPeriod"("userId", "startsAt", "endsAt");
COMMIT;
