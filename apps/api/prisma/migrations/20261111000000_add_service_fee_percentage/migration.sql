-- Additive R03 fields. Existing amounts and descriptions remain unchanged.
BEGIN;
ALTER TABLE "ListingFeeItem" DROP CONSTRAINT "ListingFeeItem_mode_check";
ALTER TABLE "ListingFeeItem" ADD CONSTRAINT "ListingFeeItem_mode_check" CHECK ("mode" IN ('INCLUDED','NONE','FIXED','USAGE','PERCENT'));
ALTER TABLE "ListingFeeItem" ADD COLUMN "percentage" DECIMAL(5,2), ADD COLUMN "paymentTiming" TEXT, ADD COLUMN "payee" TEXT;
ALTER TABLE "ListingFeeItem" ADD CONSTRAINT "ListingFeeItem_percentage_check" CHECK ("percentage" IS NULL OR ("kind"='SERVICE' AND "mode"='PERCENT' AND "percentage">0 AND "percentage"<=100));
COMMIT;
