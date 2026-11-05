-- Rename the internal label without deleting periods, provenance or timestamps.
-- Prices and historical payment records are not rewritten by this migration.
BEGIN;
ALTER TYPE "PaidPlan" RENAME VALUE 'UNLIMITED' TO 'FLAGSHIP';
COMMIT;
