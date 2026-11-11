import { publicListingSchema } from "./content-contract.js";
import { evidenceMatches } from "./publication-evidence.js";
import { Router, type RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { z, ZodError } from "zod";
import { DraftError } from "./draft.service.js";
import type { PublicationEvidenceReader } from "./content-command.service.js";
import type { MediaDependencies } from "../media/draft-media.service.js";
/** No list/search/map claim: guarded detail and image delivery only. */
export function createPublicListingRouter(
  db: PrismaClient,
  media?: MediaDependencies,
  evidence?: PublicationEvidenceReader,
) {
  const router = Router();
  const endpoint =
    (handler: RequestHandler): RequestHandler =>
    async (req, res, next) => {
      try {
        await handler(req, res, next);
      } catch (error) {
        if (error instanceof DraftError)
          res
            .status(error.status)
            .json({ error: { code: error.code, message: error.message } });
        else if (error instanceof ZodError)
          res.status(400).json({
            error: { code: "VALIDATION_ERROR", message: "請求格式不正確" },
          });
        else next(error);
      }
    };
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  async function guarded(publicId: string) {
    return db.$transaction(async (tx) => {
      const projection = await tx.listingPublication.findUnique({
        where: { publicId },
      });
      const row = projection
        ? await tx.listing.findFirst({
            where: {
              id: projection.listingId,
              status: "PUBLISHED",
              moderationStatus: "NONE",
              publisher: { isActive: true },
            },
          })
        : null;
      if (!projection || !row || row.revision !== projection.revision)
        throw new DraftError(404, "NOT_FOUND", "目前未提供此房源");
      const validated = publicListingSchema.safeParse(projection.snapshot);
      if (
        !validated.success ||
        validated.data.publicId !== publicId ||
        validated.data.revision !== projection.revision ||
        validated.data.images.some(
          (image) =>
            image.displayPath !==
              `/api/v1/listings/${publicId}/images/${image.id}/display` ||
            image.thumbnailPath !==
              `/api/v1/listings/${publicId}/images/${image.id}/thumbnail`,
        )
      )
        throw new DraftError(
          503,
          "PUBLIC_PROJECTION_INVALID",
          "公開資料需重新核對",
        );
      const location = validated.data.cityCode;
      const city =
        typeof location === "string"
          ? await tx.city.findUnique({
              where: { code: location },
              select: { publicationPolicy: true },
            })
          : null;
      if (!city || !["OPEN", "STOP_NEW"].includes(city.publicationPolicy))
        throw new DraftError(404, "NOT_FOUND", "目前未提供此地區房源");
      const now = new Date(),
        proof = await evidence?.(tx, row, now);
      if (!evidenceMatches(proof ?? null, row, now))
        throw new DraftError(
          503,
          "PUBLICATION_EVIDENCE_UNAVAILABLE",
          "公開資格需重新核對",
        );
      return { ...projection, snapshot: validated.data };
    });
  }
  router.get(
    "/:publicId",
    endpoint(async (req, res) => {
      const projection = await guarded(z.uuid().parse(req.params.publicId));
      res.json({ data: { listing: projection.snapshot } });
    }),
  );
  router.get(
    "/:publicId/images/:mediaId/:variant",
    endpoint(async (req, res) => {
      const publicId = z.uuid().parse(req.params.publicId),
        mediaId = z.uuid().parse(req.params.mediaId),
        variant = z.enum(["display", "thumbnail"]).parse(req.params.variant);
      const projection = await guarded(publicId);
      if (!projection.snapshot.images.some((image) => image.id === mediaId))
        throw new DraftError(404, "NOT_FOUND", "目前未提供此圖片");
      if (!media)
        throw new DraftError(
          503,
          "IMAGE_DELIVERY_UNAVAILABLE",
          "圖片服務尚未就緒",
        );
      const reference = await db.listingMedia.findFirst({
        where: { id: mediaId, listingId: projection.listingId },
      });
      const job = reference?.assetId
        ? await db.mediaUpload.findUnique({ where: { id: reference.assetId } })
        : null;
      if (!job || job.state !== "ATTACHED" || job.namespace !== media.namespace)
        throw new DraftError(404, "NOT_FOUND", "目前未提供此圖片");
      let data: Buffer;
      try {
        data = await media.createStore().read(job.id, variant);
      } catch {
        throw new DraftError(503, "IMAGE_READ_FAILED", "圖片暫時無法讀取");
      }
      const current = await guarded(publicId);
      if (current.revision !== projection.revision)
        throw new DraftError(
          409,
          "PUBLIC_VERSION_CHANGED",
          "房源內容已更新，請重新載入",
        );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type("image/webp").send(data);
    }),
  );
  return router;
}
