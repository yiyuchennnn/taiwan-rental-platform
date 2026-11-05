-- Additive compatibility migration. No reinterpretation of historical SUITE,
-- residential-building, area semantics, arbitrary lease text or unknown fees.
BEGIN;
ALTER TABLE "Listing"
 ADD COLUMN "areaSource" TEXT,
 ADD COLUMN "elevatorStatus" TEXT,
 ADD COLUMN "petPolicy" TEXT,
 ADD COLUMN "cookingPolicy" TEXT,
 ADD COLUMN "laundryStatus" TEXT,
 ADD COLUMN "dryingStatus" TEXT,
 ADD COLUMN "garbageStatus" TEXT,
 ADD COLUMN "subsidyPolicy" TEXT,
 ADD COLUMN "minimumLeaseMonths" INTEGER,
 ADD COLUMN "floors" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
 ADD COLUMN "carParkingStatus" TEXT,
 ADD COLUMN "motorcycleParkingStatus" TEXT,
 ADD COLUMN "carParkingRequired" BOOLEAN,
 ADD COLUMN "motorcycleParkingRequired" BOOLEAN,
 ADD COLUMN "carParkingFrequency" TEXT,
 ADD COLUMN "motorcycleParkingFrequency" TEXT,
 ADD COLUMN "contactExtension" TEXT,
 ADD COLUMN "authorizationDescription" TEXT;
ALTER TABLE "Listing" DROP CONSTRAINT "Listing_floor_mode";
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_floor_mode" CHECK ("floorMode" IS NULL OR "floorMode" IN ('SINGLE','RANGE','MULTIPLE','ENTIRE_BUILDING'));
ALTER TABLE "Listing" DROP CONSTRAINT "Listing_occupancy_mode";
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_occupancy_mode" CHECK ("occupancyMode" IS NULL OR "occupancyMode" IN ('IMMEDIATE','DATE','NEGOTIABLE'));
ALTER TABLE "DraftAddress" ADD COLUMN "buildingNumber" TEXT, ADD COLUMN "roomIdentifierSource" TEXT, ADD COLUMN "addressKind" TEXT;
CREATE TABLE "ListingUtilityCharge" (
 "listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('WATER','ELECTRICITY','GAS','INTERNET')),
 "mode" TEXT NOT NULL CHECK ("mode" IN ('INCLUDED','BY_BILL','METERED','FIXED','NOT_PROVIDED')),
 "amount" INTEGER, "rate" DECIMAL(12,2), "unit" TEXT, "frequency" TEXT, "source" TEXT, "description" TEXT,
 "variableRate" BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY ("listingId","kind")
);
CREATE TABLE "ListingEquipmentItem" (
 "listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "code" TEXT NOT NULL CHECK ("code" IN ('BED','WARDROBE','DESK_CHAIR','SOFA','REFRIGERATOR','AIR_CONDITIONER','WASHING_MACHINE','WATER_HEATER','TELEVISION')),
 "status" TEXT NOT NULL CHECK ("status" IN ('YES','NO','UNKNOWN')),
 PRIMARY KEY ("listingId","code")
);
CREATE TABLE "ListingFeeItem" (
 "id" TEXT PRIMARY KEY,
 "listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('MANAGEMENT','CAR_PARKING','MOTORCYCLE_PARKING','PET','SERVICE','OTHER')),
 "label" TEXT NOT NULL, "mode" TEXT NOT NULL CHECK ("mode" IN ('INCLUDED','NONE','FIXED','USAGE')),
 "amount" INTEGER, "frequency" TEXT, "required" BOOLEAN NOT NULL, "description" TEXT
);
CREATE INDEX "ListingFeeItem_listingId_idx" ON "ListingFeeItem"("listingId");
COMMIT;
