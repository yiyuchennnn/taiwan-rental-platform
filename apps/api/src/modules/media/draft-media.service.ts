import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthenticatedSession } from "../auth/require-auth.js";
import { processImage, type ImageProcessingOptions } from "./process-image.js";
import type { ImageVariantName } from "./private-image-store.js";

export class MediaError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export interface RecoverableImageStore {
  reserve(id: string, nonce?: string): Promise<void>;
  put(id: string, variant: ImageVariantName, data: Buffer): Promise<void>;
  restoreReservation(id: string, nonce: string): void;
  reconcileReservation(id: string): Promise<"OWNED" | "ABSENT">;
  remove(id: string): Promise<void>;
  read(id: string, variant: ImageVariantName): Promise<Buffer>;
}
export interface MediaDependencies {
  namespace: string;
  createStore(): RecoverableImageStore;
  options: ImageProcessingOptions;
  // Operational upload lease; not a product retention policy.
  leaseMs: number;
  // Must include existing assets, pending reservations and plan entitlements.
  // Undefined is unavailable, never unlimited. Called under the account lock.
  authorizeCapacity?: (tx: Prisma.TransactionClient, userId: string, incomingBytes: bigint) => Promise<void>;
}
export function createDraftMediaService(db: PrismaClient, deps: MediaDependencies) {
  if (!deps.namespace || !Number.isSafeInteger(deps.leaseMs) || deps.leaseMs <= 0) throw new Error("Invalid media dependencies");
  async function owned(tx: Prisma.TransactionClient, auth: AuthenticatedSession, listingId: string) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${auth.user.id} FOR UPDATE`;
    const session = await tx.authSession.findFirst({ where: { id: auth.sessionId, userId: auth.user.id, revokedAt: null,
      expiresAt: { gt: new Date() }, user: { isActive: true } } });
    if (!session) throw new MediaError(401, "UNAUTHENTICATED", "請先登入");
    await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${listingId} AND "publisherId" = ${auth.user.id} FOR UPDATE`;
    const listing = await tx.listing.findFirst({ where: { id: listingId, publisherId: auth.user.id } });
    if (!listing) throw new MediaError(404, "NOT_FOUND", "找不到草稿");
    if (listing.status !== "DRAFT") throw new MediaError(409, "DRAFT_REQUIRED", "僅可編輯草稿圖片");
  }
  const rows = (tx: Prisma.TransactionClient, listingId: string) => tx.listingMedia.findMany({ where: { listingId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, assetId: true, sortOrder: true, isCover: true, asset: { select: { displayBytes: true, thumbnailBytes: true } } } });
  const dto = (items: Awaited<ReturnType<typeof rows>>) => items.map(({ asset, ...item }) => ({ ...item,
    displayBytes: asset?.displayBytes?.toString() ?? null, thumbnailBytes: asset?.thumbnailBytes?.toString() ?? null }));

  // Only CLEANUP jobs can delete objects. Persistent proof is verified remotely.
  async function cleanup(id: string) {
    const job = await db.mediaUpload.findUnique({ where: { id } });
    if (!job || job.state !== "CLEANUP" || job.namespace !== deps.namespace) return false;
    if (await db.listingMedia.count({ where: { assetId: id } })) return false;
    const store = deps.createStore();
    try {
      store.restoreReservation(id, job.nonce);
      if (await store.reconcileReservation(id) === "OWNED") await store.remove(id);
      await db.mediaUpload.updateMany({ where: { id, state: "CLEANUP" }, data: { state: "DELETED" } });
      return true;
    } catch { return false; } // Retain durable job for explicit retry; never expose storage errors.
  }
  return {
    async list(auth: AuthenticatedSession, listingId: string) {
      return db.$transaction(async tx => { await owned(tx, auth, listingId); return dto(await rows(tx, listingId)); });
    },
    async upload(auth: AuthenticatedSession, listingId: string, input: Buffer, rightsConfirmed: boolean, requestKey: string = randomUUID()) {
      if (rightsConfirmed !== true) throw new MediaError(400, "IMAGE_RIGHTS_REQUIRED", "請確認你有權使用此圖片");
      // Cheap authorization before decode; rechecked before reservation and attachment.
      await db.$transaction(tx => owned(tx, auth, listingId));
      if (!deps.authorizeCapacity) throw new MediaError(503, "IMAGE_CAPACITY_UNAVAILABLE", "圖片容量資格尚未接妥");
      const image = await processImage(input, deps.options);
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestKey)) throw new MediaError(400, "INVALID_UPLOAD_KEY", "請提供有效的上傳識別碼");
      const inputDigest = createHash("sha256").update(input).digest("hex");
      const id = randomUUID(), nonce = randomUUID();
      const replay = await db.$transaction(async tx => {
        await owned(tx, auth, listingId);
        const previous = await tx.mediaUpload.findUnique({ where: { ownerId_requestKey: { ownerId: auth.user.id, requestKey } } });
        if (previous) {
          if (previous.listingId !== listingId || previous.inputDigest !== inputDigest) throw new MediaError(409, "UPLOAD_KEY_CONFLICT", "上傳識別碼已用於其他圖片");
          if (previous.state === "ATTACHED") return dto(await rows(tx, listingId));
          throw new MediaError(409, "UPLOAD_REQUIRES_REVIEW", "此上傳處理中或已移除，請重新載入圖片清單後再試");
        }
        const count = await tx.listingMedia.count({ where: { listingId } });
        const pending = await tx.mediaUpload.count({ where: { listingId, state: "PENDING" } });
        if (count + pending >= 30) throw new MediaError(409, "IMAGE_LIMIT_REACHED", "每筆刊登最多 30 張圖片");
        await deps.authorizeCapacity!(tx, auth.user.id, BigInt(image.display.bytes + image.thumbnail.bytes));
        await tx.mediaUpload.create({ data: { id, ownerId: auth.user.id, requestKey, inputDigest, listingId, nonce, namespace: deps.namespace,
          state: "PENDING", reservedBytes: BigInt(image.display.bytes + image.thumbnail.bytes), leaseUntil: new Date(Date.now() + deps.leaseMs), rightsConfirmedAt: new Date() } });
        return null;
      });
      if (replay) return replay;
      const store = deps.createStore();
      try {
        await store.reserve(id, nonce);
        await store.put(id, "display", image.display.data);
        await store.put(id, "thumbnail", image.thumbnail.data);
        return await db.$transaction(async tx => {
          await owned(tx, auth, listingId);
          // Same lock order as recovery. Never attach a job already claimed for cleanup.
          await tx.$queryRaw`SELECT id FROM "MediaUpload" WHERE id = ${id} FOR UPDATE`;
          const job = await tx.mediaUpload.findUniqueOrThrow({ where: { id } });
          if (job.state !== "PENDING") throw new MediaError(409, "UPLOAD_EXPIRED", "上傳已過期，請重新上傳");
          // Reservation is already counted; recheck current entitlements without
          // double-counting its bytes if a plan changed during remote writes.
          await deps.authorizeCapacity!(tx, auth.user.id, 0n);
          const count = await tx.listingMedia.count({ where: { listingId } });
          if (count >= 30) throw new MediaError(409, "IMAGE_LIMIT_REACHED", "每筆刊登最多 30 張圖片");
          const max = await tx.listingMedia.aggregate({ where: { listingId }, _max: { sortOrder: true } });
          await tx.mediaAsset.create({ data: { id, displayUrl: `private:${id}/display`, thumbnailUrl: `private:${id}/thumbnail`,
            displayBytes: BigInt(image.display.bytes), thumbnailBytes: BigInt(image.thumbnail.bytes), gpsRemovedAt: image.metadataStrippedAt } });
          await tx.listingMedia.create({ data: { listingId, assetId: id, url: `private:${id}/display`, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
          await tx.mediaUpload.update({ where: { id }, data: { state: "ATTACHED" } });
          return dto(await rows(tx, listingId));
        });
      } catch (error) {
        // If commit acknowledgement was lost, ATTACHED protects valid images.
        await db.mediaUpload.updateMany({ where: { id, state: "PENDING" }, data: { state: "CLEANUP" } });
        await cleanup(id);
        if (error instanceof MediaError) throw error;
        throw new MediaError(503, "IMAGE_UPLOAD_FAILED", "圖片上傳未完成，請稍後再試");
      }
    },
    async reorder(auth: AuthenticatedSession, listingId: string, ids: string[]) {
      return db.$transaction(async tx => {
        await owned(tx, auth, listingId);
        const current = await rows(tx, listingId);
        if (new Set(ids).size !== ids.length || ids.length !== current.length || current.some(item => !ids.includes(item.id))) {
          throw new MediaError(409, "IMAGE_SET_CHANGED", "圖片清單已變更，請重新載入");
        }
        for (const [sortOrder, id] of ids.entries()) await tx.listingMedia.update({ where: { id }, data: { sortOrder } });
        return dto(await rows(tx, listingId));
      });
    },
    async cover(auth: AuthenticatedSession, listingId: string, mediaId: string) {
      return db.$transaction(async tx => {
        await owned(tx, auth, listingId);
        if (!await tx.listingMedia.findFirst({ where: { id: mediaId, listingId } })) throw new MediaError(404, "NOT_FOUND", "找不到圖片");
        await tx.listingMedia.updateMany({ where: { listingId, isCover: true }, data: { isCover: false } });
        await tx.listingMedia.update({ where: { id: mediaId }, data: { isCover: true } });
        return dto(await rows(tx, listingId));
      });
    },
    async remove(auth: AuthenticatedSession, listingId: string, mediaId: string) {
      const result = await db.$transaction(async tx => {
        await owned(tx, auth, listingId);
        const media = await tx.listingMedia.findFirst({ where: { id: mediaId, listingId } });
        if (!media) throw new MediaError(404, "NOT_FOUND", "找不到圖片");
        // Different accounts/listings can share an asset. Serialize the final
        // reference check, otherwise two removals may each see the other's link
        // and both leave the unreferenced asset behind.
        if (media.assetId) await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id = ${media.assetId} FOR UPDATE`;
        await tx.listingMedia.delete({ where: { id: mediaId } });
        let cleanupId: string | null = null;
        if (media.assetId && !await tx.listingMedia.count({ where: { assetId: media.assetId } })) {
          const job = await tx.mediaUpload.findUnique({ where: { id: media.assetId } });
          if (job?.state === "ATTACHED" && job.namespace === deps.namespace) {
            await tx.mediaAsset.delete({ where: { id: media.assetId } });
            await tx.mediaUpload.update({ where: { id: job.id }, data: { state: "CLEANUP" } });
            cleanupId = job.id;
          }
        }
        // Removing a cover leaves a draft without one; user selects the replacement.
        return { images: dto(await rows(tx, listingId)), cleanupId };
      });
      const cleanupPending = result.cleanupId ? !await cleanup(result.cleanupId) : false;
      return { images: result.images, cleanupPending };
    },
    async read(auth: AuthenticatedSession, listingId: string, mediaId: string, variant: ImageVariantName) {
      const id = await db.$transaction(async tx => {
        await owned(tx, auth, listingId);
        const media = await tx.listingMedia.findFirst({ where: { id: mediaId, listingId } });
        const job = media?.assetId ? await tx.mediaUpload.findUnique({ where: { id: media.assetId } }) : null;
        if (!job || job.state !== "ATTACHED" || job.namespace !== deps.namespace) throw new MediaError(404, "NOT_FOUND", "找不到圖片");
        return job.id;
      });
      try { return await deps.createStore().read(id, variant); }
      catch { throw new MediaError(503, "IMAGE_READ_FAILED", "圖片暫時無法讀取"); }
    },
    async recoverExpired() {
      // Administrative worker only, never exposed as a public HTTP route.
      const candidates = await db.mediaUpload.findMany({ where: { namespace: deps.namespace,
        OR: [{ state: "CLEANUP" }, { state: "PENDING", leaseUntil: { lt: new Date() } }] }, take: 100,
        orderBy: [{ state: "asc" }, { createdAt: "asc" }] });
      let cleaned = 0;
      for (const job of candidates) {
        // A clock expiry alone cannot prove a writer has stopped. Never delete
        // PENDING objects while a suspended upload might still resume writing.
        if (job.state === "PENDING") continue;
        if (await cleanup(job.id)) cleaned++;
      }
      return { examined: candidates.length, cleaned, pendingReview: candidates.filter(job => job.state === "PENDING").map(job => job.id) };
    },
  };
}
