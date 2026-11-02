CREATE TABLE "MediaUpload" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "inputDigest" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "namespace" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK ("state" IN ('PENDING', 'ATTACHED', 'CLEANUP', 'DELETED')),
  "reservedBytes" BIGINT NOT NULL CHECK ("reservedBytes" >= 0),
  "leaseUntil" TIMESTAMP(3) NOT NULL,
  "rightsConfirmedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "MediaUpload_listingId_state_idx" ON "MediaUpload"("listingId", "state");
CREATE UNIQUE INDEX "MediaUpload_ownerId_requestKey_key" ON "MediaUpload"("ownerId", "requestKey");
CREATE INDEX "MediaUpload_state_leaseUntil_idx" ON "MediaUpload"("state", "leaseUntil");
