-- Additive only. Legacy amounts/dates/floors remain unchanged and modes unknown.
BEGIN;
ALTER TABLE "Listing"
  ADD COLUMN "buildingDescription" TEXT,
  ADD COLUMN "depositMode" TEXT,
  ADD COLUMN "depositMonths" DECIMAL(12,4),
  ADD COLUMN "managementFeeMode" TEXT,
  ADD COLUMN "occupancyMode" TEXT,
  ADD COLUMN "floorMode" TEXT,
  ADD COLUMN "floorFrom" INTEGER,
  ADD COLUMN "floorTo" INTEGER,
  ADD COLUMN "balconyMode" TEXT,
  ADD COLUMN "sharedSpaces" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sharedSpaceDescription" TEXT,
  ADD COLUMN "equipmentMode" TEXT;
ALTER TABLE "Listing"
  ADD CONSTRAINT "Listing_deposit_mode" CHECK ("depositMode" IS NULL OR "depositMode" IN ('NONE','MONTHS','FIXED')),
  ADD CONSTRAINT "Listing_deposit_months_positive" CHECK ("depositMonths" IS NULL OR "depositMonths" > 0),
  ADD CONSTRAINT "Listing_management_mode" CHECK ("managementFeeMode" IS NULL OR "managementFeeMode" IN ('NONE','INCLUDED','SEPARATE')),
  ADD CONSTRAINT "Listing_occupancy_mode" CHECK ("occupancyMode" IS NULL OR "occupancyMode" IN ('IMMEDIATE','DATE')),
  ADD CONSTRAINT "Listing_floor_mode" CHECK ("floorMode" IS NULL OR "floorMode" IN ('SINGLE','RANGE','ENTIRE_BUILDING')),
  ADD CONSTRAINT "Listing_floor_range" CHECK ("floorMode" IS DISTINCT FROM 'RANGE' OR "floorFrom" IS NULL OR "floorTo" IS NULL OR "floorFrom" < "floorTo"),
  ADD CONSTRAINT "Listing_balcony_mode" CHECK ("balconyMode" IS NULL OR "balconyMode" IN ('NONE','PRIVATE','SHARED')),
  ADD CONSTRAINT "Listing_equipment_mode" CHECK ("equipmentMode" IS NULL OR "equipmentMode" IN ('NONE','PRESENT')),
  ADD CONSTRAINT "Listing_shared_spaces" CHECK ("sharedSpaces" <@ ARRAY['BATHROOM','KITCHEN','LIVING_ROOM','LAUNDRY','BALCONY']::TEXT[]);
-- Incomplete drafts remain valid. Cross-field completeness belongs to publication validation.
COMMIT;
