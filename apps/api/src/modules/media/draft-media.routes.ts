import express, { Router, type RequestHandler, type ErrorRequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireAuth, type AuthenticatedSession } from "../auth/require-auth.js";
import { createSessionService, sessionLifetimeSeconds } from "../auth/session.service.js";
import { createDraftMediaService, MediaError, type MediaDependencies } from "./draft-media.service.js";
import { ImageProcessingError } from "./process-image.js";

export function createDraftMediaRouter(db: PrismaClient, deps?: MediaDependencies, legacyCompatibility = false) {
  const router = Router({ mergeParams: true });
  router.use(requireAuth(createSessionService(db, sessionLifetimeSeconds())));
  const service = deps ? createDraftMediaService(db, deps) : null;
  const auth = (res: express.Response) => res.locals.auth as AuthenticatedSession;
  const endpoint = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    try { await handler(req, res, next); } catch (error) { next(error); }
  };
  router.use(endpoint(async (_req, _res, next) => {
    if (!service) throw new MediaError(503, "IMAGE_UPLOADS_NOT_CONFIGURED", "圖片服務尚未完成設定");
    next();
  }));
  const revision = (req: express.Request) => {
    const body = req.body && typeof req.body==='object' && !Buffer.isBuffer(req.body) ? req.body.expectedRevision : undefined;
    const header = req.get('If-Match');
    let fromHeader:number|undefined;
    if(header!==undefined){const match=/^"([1-9]\d*)"$/.exec(header);if(!match)throw new MediaError(400,'INVALID_REVISION','If-Match須為加引號的版本數字');fromHeader=Number(match[1]);}
    const valid=z.number().int().min(1).max(2147483646);
    if(body!==undefined)valid.parse(body);if(fromHeader!==undefined)valid.parse(fromHeader);
    if(body!==undefined && fromHeader!==undefined && body!==fromHeader)throw new MediaError(400,'REVISION_MISMATCH','版本條件不一致');
    const value=body ?? fromHeader;
    if(value===undefined && !legacyCompatibility)throw new MediaError(400,'REVISION_REQUIRED','請提供目前內容版本');
    return value as number|undefined;
  };
  router.get("/", endpoint(async (req, res) => res.json({ data: { images: await service!.list(auth(res), req.params.id as string) } })));
  router.post("/", endpoint(async (req, res, next) => {
    await service!.list(auth(res), req.params.id as string);
    res.locals.imageExpectedRevision=revision(req);
    if (req.get("X-Image-Rights-Confirmed") !== "true") throw new MediaError(400, "IMAGE_RIGHTS_REQUIRED", "請確認你有權使用此圖片");
    z.uuidv4().parse(req.get("Idempotency-Key"));
    if (!req.is(["image/jpeg", "image/png", "image/webp", "application/octet-stream"])) throw new MediaError(415, "UNSUPPORTED_IMAGE_FORMAT", "請上傳 JPEG、PNG 或 WebP");
    next();
  }), express.raw({ type: () => true, limit: deps?.options.maxInputBytes ?? 1, inflate: false }), endpoint(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new MediaError(400, "EMPTY_IMAGE", "請提供圖片內容");
    const images = await service!.upload(auth(res), req.params.id as string, req.body, true, req.get("Idempotency-Key")!,res.locals.imageExpectedRevision);
    res.status(201).json({ data: { images } });
  }));
  router.put("/order", endpoint(async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string().min(1).max(200)).max(30), expectedRevision:z.number().int().positive().optional() }).strict().parse(req.body);
    res.json({ data: { images: await service!.reorder(auth(res), req.params.id as string, ids,revision(req)) } });
  }));
  router.put("/:mediaId/cover", endpoint(async (req, res) => {
    z.object({expectedRevision:z.number().int().positive().optional()}).strict().parse(req.body ?? {});
    res.json({ data: { images: await service!.cover(auth(res), req.params.id as string, req.params.mediaId as string,revision(req)) } });
  }));
  router.delete("/:mediaId", endpoint(async (req, res) => {
    res.json({ data: await service!.remove(auth(res), req.params.id as string, req.params.mediaId as string,revision(req)) });
  }));
  router.get("/:mediaId/:variant", endpoint(async (req, res) => {
    const variant = z.enum(["display", "thumbnail"]).parse(req.params.variant);
    const data = await service!.read(auth(res), req.params.id as string, req.params.mediaId as string, variant);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type("image/webp").send(data);
  }));
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof MediaError) res.status(error.status).json({ error: { code: error.code, message: error.message } });
    else if (error instanceof ImageProcessingError) res.status(400).json({ error: { code: error.code, message: error.message } });
    else if (error instanceof ZodError) res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "圖片操作格式不正確" } });
    else if (error?.type === "entity.too.large") res.status(413).json({ error: { code: "IMAGE_TOO_LARGE", message: "圖片超過允許大小" } });
    else if (error?.type === "encoding.unsupported") res.status(415).json({ error: { code: "UNSUPPORTED_ENCODING", message: "不支援壓縮的上傳內容" } });
    else next(error);
  };
  router.use(errors);
  return router;
}
