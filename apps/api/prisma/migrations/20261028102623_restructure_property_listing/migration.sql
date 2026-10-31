/*
  Warnings:

  - You are about to drop the column `address` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `city` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `district` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `isPublished` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `ownerId` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `rent` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Property` table. All the data in the column will be lost.
  - Added the required column `addressLine` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cityCode` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdById` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `districtCode` to the `Property` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('NONE', 'SUSPENDED', 'BLOCKED');

-- DropForeignKey
ALTER TABLE "Property" DROP CONSTRAINT "Property_ownerId_fkey";

-- DropIndex
DROP INDEX "Property_city_district_idx";

-- DropIndex
DROP INDEX "Property_ownerId_idx";

-- AlterTable
ALTER TABLE "Property" DROP COLUMN "address",
DROP COLUMN "city",
DROP COLUMN "description",
DROP COLUMN "district",
DROP COLUMN "isPublished",
DROP COLUMN "ownerId",
DROP COLUMN "rent",
DROP COLUMN "title",
ADD COLUMN     "addressLine" TEXT NOT NULL,
ADD COLUMN     "cityCode" TEXT NOT NULL,
ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "districtCode" TEXT NOT NULL,
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "rent" INTEGER NOT NULL,
    "deposit" INTEGER,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'NONE',
    "propertyId" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingMedia" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Listing_propertyId_idx" ON "Listing"("propertyId");

-- CreateIndex
CREATE INDEX "Listing_publisherId_idx" ON "Listing"("publisherId");

-- CreateIndex
CREATE INDEX "Listing_status_moderationStatus_idx" ON "Listing"("status", "moderationStatus");

-- CreateIndex
CREATE INDEX "Listing_rent_idx" ON "Listing"("rent");

-- CreateIndex
CREATE INDEX "ListingMedia_listingId_idx" ON "ListingMedia"("listingId");

-- CreateIndex
CREATE INDEX "ListingMedia_listingId_sortOrder_idx" ON "ListingMedia"("listingId", "sortOrder");

-- CreateIndex
CREATE INDEX "Property_createdById_idx" ON "Property"("createdById");

-- CreateIndex
CREATE INDEX "Property_cityCode_districtCode_idx" ON "Property"("cityCode", "districtCode");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
