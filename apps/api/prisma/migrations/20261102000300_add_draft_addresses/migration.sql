-- Private working copies only. Do not copy, geocode or change any existing Property.
BEGIN;
CREATE TABLE "DraftAddress" (
  "listingId" TEXT PRIMARY KEY,
  "cityCode" TEXT,
  "districtCode" TEXT,
  "addressLine" TEXT,
  "roomNumber" TEXT,
  "communityName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DraftAddress_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DraftAddress_cityCode_fkey" FOREIGN KEY ("cityCode") REFERENCES "City"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DraftAddress_cityCode_districtCode_fkey" FOREIGN KEY ("cityCode", "districtCode") REFERENCES "District"("cityCode", "code") ON DELETE RESTRICT ON UPDATE CASCADE
);
COMMIT;
