import { Router, type RequestHandler } from "express";
import { ZodError } from "zod";
import type { PrismaClient } from "@prisma/client";
import { requireAuth, type AuthenticatedSession } from "../auth/require-auth.js";
import { createSessionService, sessionLifetimeSeconds } from "../auth/session.service.js";
import { createDraftService, DraftError, type DraftCreationPolicy } from "./draft.service.js";
import { resolveDraftCreationPolicy } from "./draft-creation-policy.js";

export function createDraftRouter(db: PrismaClient, policy: DraftCreationPolicy = resolveDraftCreationPolicy, legacyCompatibility = false) {
  const router = Router();
  const service = createDraftService(db, policy);
  router.use(requireAuth(createSessionService(db, sessionLifetimeSeconds())));
  const endpoint = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    try { await handler(req, res, next); }
    catch (error) {
      if (error instanceof ZodError) res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "草稿資料格式不正確", details: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) } });
      else if (error instanceof DraftError) res.status(error.status).json({ error: { code: error.code, message: error.message } });
      else next(error);
    }
  };
  router.post("/", endpoint(async (req, res) => {
    if(!legacyCompatibility) throw new DraftError(400,"USE_VERSIONED_CONTENT_COMMAND","請改用 /api/v1/me/listings，並提供操作識別碼");
    const draft = await service.create(res.locals.auth as AuthenticatedSession, req.body);
    res.status(201).json({ data: { draft } });
  }));
  router.get("/:id/validation", endpoint(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ data: { validation: await service.validation(res.locals.auth as AuthenticatedSession, req.params.id as string) } });
  }));
  router.get("/:id", endpoint(async (req, res) => {
    const draft = await service.read(res.locals.auth as AuthenticatedSession, req.params.id as string);
    res.json({ data: { draft } });
  }));
  router.patch("/:id", endpoint(async (req, res) => {
    if(!legacyCompatibility) throw new DraftError(400,"USE_VERSIONED_CONTENT_COMMAND","請改用 /api/v1/me/listings/:id/work-version，並提供版本及操作識別碼");
    const draft = await service.patch(res.locals.auth as AuthenticatedSession, req.params.id as string, req.body);
    res.json({ data: { draft } });
  }));
  return router;
}
