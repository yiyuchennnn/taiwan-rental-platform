-- 01-01、02-06～02-09、02-11：僅對齊現有模型；不代表操作 API 已完成。
-- 不移除舊欄位／列，不猜測歷史 publishedAt 或 UNPUBLISHED 的意義。
-- 新 enum 值在資料變更交易之前提交，避免 PostgreSQL 同交易使用新 enum 值。
BEGIN;
CREATE TYPE "BillingMethod" AS ENUM ('INCLUDED', 'BY_BILL', 'SEPARATE', 'NOT_PROVIDED');
CREATE TYPE "ArchiveReason" AS ENUM ('MANUAL', 'RENTED', 'QUOTA_EXCEEDED');
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "contactVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "publisherVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Property" ADD COLUMN "communityName" TEXT;
ALTER TABLE "Listing" ALTER COLUMN "title" DROP NOT NULL;
ALTER TABLE "Listing" ADD COLUMN "rentalType" TEXT;
ALTER TABLE "Listing" ADD COLUMN "buildingType" TEXT;
ALTER TABLE "Listing" ADD COLUMN "areaPings" DECIMAL(12,4);
ALTER TABLE "Listing" ADD COLUMN "areaType" TEXT;
ALTER TABLE "Listing" ADD COLUMN "bedrooms" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "livingRooms" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "bathrooms" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "balconies" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "totalFloors" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "isWholeBuilding" BOOLEAN;
ALTER TABLE "Listing" ADD COLUMN "hasElevator" BOOLEAN;
ALTER TABLE "Listing" ADD COLUMN "managementFee" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "waterBilling" "BillingMethod";
ALTER TABLE "Listing" ADD COLUMN "waterFeeDescription" TEXT;
ALTER TABLE "Listing" ADD COLUMN "electricityBilling" "BillingMethod";
ALTER TABLE "Listing" ADD COLUMN "electricityFeeDescription" TEXT;
ALTER TABLE "Listing" ADD COLUMN "gasBilling" "BillingMethod";
ALTER TABLE "Listing" ADD COLUMN "gasFeeDescription" TEXT;
ALTER TABLE "Listing" ADD COLUMN "internetBilling" "BillingMethod";
ALTER TABLE "Listing" ADD COLUMN "internetFeeDescription" TEXT;
ALTER TABLE "Listing" ADD COLUMN "hasCarParking" BOOLEAN;
ALTER TABLE "Listing" ADD COLUMN "carParkingType" TEXT;
ALTER TABLE "Listing" ADD COLUMN "carParkingIncludedInRent" BOOLEAN;
ALTER TABLE "Listing" ADD COLUMN "carParkingFee" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "hasMotorcycleParking" BOOLEAN;
ALTER TABLE "Listing" ADD COLUMN "motorcycleParkingType" TEXT;
ALTER TABLE "Listing" ADD COLUMN "motorcycleParkingIncludedInRent" BOOLEAN;
ALTER TABLE "Listing" ADD COLUMN "motorcycleParkingFee" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "furniture" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Listing" ADD COLUMN "appliances" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Listing" ADD COLUMN "equipmentConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "cookingAllowed" BOOLEAN;
ALTER TABLE "Listing" ADD COLUMN "laundryDescription" TEXT;
ALTER TABLE "Listing" ADD COLUMN "dryingDescription" TEXT;
ALTER TABLE "Listing" ADD COLUMN "garbageDisposalDescription" TEXT;
ALTER TABLE "Listing" ADD COLUMN "minimumLeaseTerm" TEXT;
ALTER TABLE "Listing" ADD COLUMN "availableFrom" DATE;
ALTER TABLE "Listing" ADD COLUMN "petsAllowed" BOOLEAN;
ALTER TABLE "Listing" ADD COLUMN "petConditions" TEXT;
ALTER TABLE "Listing" ADD COLUMN "petFeeDescription" TEXT;
ALTER TABLE "Listing" ADD COLUMN "additionalConditions" TEXT;
ALTER TABLE "Listing" ADD COLUMN "subsidyDescription" TEXT;
ALTER TABLE "Listing" ALTER COLUMN "rent" DROP NOT NULL;
ALTER TABLE "Listing" ADD COLUMN "archiveReason" "ArchiveReason";
ALTER TABLE "Listing" ADD COLUMN "trashedAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "exactAddressConsentAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Listing" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "Listing" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "Listing" ADD COLUMN "contactLine" TEXT;
ALTER TABLE "Listing" ADD COLUMN "publisherType" "PublisherType";
ALTER TABLE "Listing" ADD COLUMN "companyName" TEXT;
ALTER TABLE "Listing" ADD COLUMN "serviceFeeDescription" TEXT;
ALTER TABLE "Listing" ALTER COLUMN "propertyId" DROP NOT NULL;
ALTER TABLE "Listing" ADD COLUMN "firstPublishedAt" TIMESTAMP(3);
CREATE TABLE "MediaAsset" (
  "id" TEXT PRIMARY KEY,
  "displayUrl" TEXT NOT NULL,
  "thumbnailUrl" TEXT NOT NULL,
  "displayBytes" BIGINT,
  "thumbnailBytes" BIGINT,
  "gpsRemovedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_bytes_nonnegative" CHECK (
    ("displayBytes" IS NULL OR "displayBytes" >= 0) AND
    ("thumbnailBytes" IS NULL OR "thumbnailBytes" >= 0)
  )
);
ALTER TABLE "ListingMedia" ADD COLUMN "assetId" TEXT;
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ListingMedia_assetId_idx" ON "ListingMedia"("assetId");
-- 舊資料若已有多張封面就停止遷移，不擅自替使用者選封面。
CREATE UNIQUE INDEX "ListingMedia_one_cover" ON "ListingMedia"("listingId") WHERE "isCover";
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_trash_timestamp" CHECK (
  ("status" = 'TRASHED') = ("trashedAt" IS NOT NULL)
);
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_archive_reason_state" CHECK (
  "archiveReason" IS NULL OR "status" IN ('ARCHIVED', 'UNPUBLISHED', 'TRASHED')
);
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_nonnegative_values" CHECK (
    ("rent" IS NULL OR "rent" >= 0) AND
    ("deposit" IS NULL OR "deposit" >= 0) AND
    ("managementFee" IS NULL OR "managementFee" >= 0) AND
    ("bedrooms" IS NULL OR "bedrooms" >= 0) AND
    ("livingRooms" IS NULL OR "livingRooms" >= 0) AND
    ("bathrooms" IS NULL OR "bathrooms" >= 0) AND
    ("balconies" IS NULL OR "balconies" >= 0) AND
    ("carParkingFee" IS NULL OR "carParkingFee" >= 0) AND
    ("motorcycleParkingFee" IS NULL OR "motorcycleParkingFee" >= 0)
);
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_positive_measurements" CHECK (
  ("areaPings" IS NULL OR "areaPings" > 0) AND
  ("totalFloors" IS NULL OR "totalFloors" > 0)
);
-- 不從語意不明的舊時間回填；新服務須在首次成功公開的同一交易明確寫入。
CREATE FUNCTION preserve_listing_first_published_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."firstPublishedAt" IS NOT NULL AND
     NEW."firstPublishedAt" IS DISTINCT FROM OLD."firstPublishedAt" THEN
    RAISE EXCEPTION 'firstPublishedAt is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Listing_preserve_first_published_at" BEFORE UPDATE ON "Listing"
  FOR EACH ROW EXECUTE FUNCTION preserve_listing_first_published_at();
COMMIT;
