-- CreateEnum
CREATE TYPE "PublisherType" AS ENUM ('LANDLORD', 'AGENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "publisherType" "PublisherType";
