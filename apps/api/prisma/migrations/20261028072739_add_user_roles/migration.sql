-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('RENTER', 'PUBLISHER', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'RENTER';
