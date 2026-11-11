-- Additive content command foundation. Never backfill first publication or guess legacy semantics.
ALTER TYPE "ListingStatus" ADD VALUE IF NOT EXISTS 'DELETED';
ALTER TABLE "Listing" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0), ADD COLUMN "publicId" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "Listing" ADD COLUMN "publicationHistory" TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK ("publicationHistory" IN ('UNKNOWN','NEVER','KNOWN'));
UPDATE "Listing" SET "publicationHistory"='KNOWN' WHERE "firstPublishedAt" IS NOT NULL;
ALTER TABLE "Listing" ALTER COLUMN "publicationHistory" SET DEFAULT 'NEVER';
CREATE UNIQUE INDEX "Listing_publicId_key" ON "Listing"("publicId");
CREATE TABLE "ContentOperation" ("id" TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL,"type" TEXT NOT NULL,"requestKey" TEXT NOT NULL,"requestDigest" TEXT NOT NULL,"listingId" TEXT NOT NULL,"revision" INTEGER NOT NULL,"resultStatus" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "ContentOperation_ownerId_type_requestKey_key" ON "ContentOperation"("ownerId","type","requestKey");
CREATE INDEX "ContentOperation_listingId_idx" ON "ContentOperation"("listingId");
CREATE TABLE "ListingPreview" ("id" TEXT PRIMARY KEY,"contextDigest" TEXT NOT NULL,"ownerId" TEXT NOT NULL,"listingId" TEXT NOT NULL,"revision" INTEGER NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "ListingPreview_listingId_idx" ON "ListingPreview"("listingId");
CREATE TABLE "ListingPublication" ("listingId" TEXT PRIMARY KEY,"publicId" TEXT NOT NULL,"revision" INTEGER NOT NULL,"snapshot" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "ListingPublication_publicId_key" ON "ListingPublication"("publicId");
CREATE TABLE "ContentEvent" ("id" TEXT PRIMARY KEY,"operationId" TEXT NOT NULL,"listingId" TEXT NOT NULL,"type" TEXT NOT NULL,"revision" INTEGER NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "ContentEvent_operationId_type_key" ON "ContentEvent"("operationId","type");
CREATE INDEX "ContentEvent_listingId_revision_idx" ON "ContentEvent"("listingId","revision");

-- Preserve the legacy switch; it cannot establish which of three product policies applied.
ALTER TABLE "City" ADD COLUMN "publicationPolicy" TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK ("publicationPolicy" IN ('UNKNOWN','NOT_OPEN','OPEN','STOP_NEW'));
ALTER TABLE "City" ALTER COLUMN "publicationPolicy" SET DEFAULT 'NOT_OPEN';
