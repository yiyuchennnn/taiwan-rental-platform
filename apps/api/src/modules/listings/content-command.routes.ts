import { Router, type RequestHandler } from "express";
import { z, ZodError } from "zod";
import type { PrismaClient } from "@prisma/client";
import {
  requireAuth,
  type AuthenticatedSession,
} from "../auth/require-auth.js";
import {
  createSessionService,
  sessionLifetimeSeconds,
} from "../auth/session.service.js";
import { DraftError } from "./draft.service.js";
import {
  createContentCommandService,
  type PublicationEvidenceReader,
} from "./content-command.service.js";
export function createContentCommandRouter(
  db: PrismaClient,
  evidence?: PublicationEvidenceReader,
) {
  const router = Router(),
    service = createContentCommandService(db, evidence);
  router.use(requireAuth(createSessionService(db, sessionLifetimeSeconds())));
  const auth = (res: Parameters<RequestHandler>[1]) =>
    res.locals.auth as AuthenticatedSession;
  const endpoint =
    (fn: RequestHandler): RequestHandler =>
    async (req, res, next) => {
      try {
        await fn(req, res, next);
      } catch (error) {
        if (error instanceof ZodError)
          res
            .status(400)
            .json({
              error: {
                code: "VALIDATION_ERROR",
                message: "請求格式不正確",
                details: error.issues.map((i) => ({
                  path: i.path.join("."),
                  reason: i.code,
                })),
              },
            });
        else if (error instanceof DraftError)
          res
            .status(error.status)
            .json({ error: { code: error.code, message: error.message } });
        else next(error);
      }
    };
  const key = (req: Parameters<RequestHandler>[0]) => {
    if (!req.get("Idempotency-Key"))
      throw new DraftError(400, "IDEMPOTENCY_KEY_REQUIRED", "請提供操作識別碼");
    return z.uuidv4().parse(req.get("Idempotency-Key"));
  };
  const target = (req: Parameters<RequestHandler>[0]) =>
    z.uuid().parse(req.params.id);
  const revision = (body: unknown) => {
    if (
      !body ||
      typeof body !== "object" ||
      !Object.hasOwn(body, "expectedRevision")
    )
      throw new DraftError(400, "REVISION_REQUIRED", "請提供目前內容版本");
  };
  router.post(
    "/listings",
    endpoint(async (req, res) =>
      res
        .status(201)
        .json({
          data: {
            operation: await service.create(auth(res), key(req), req.body),
          },
        }),
    ),
  );
  router.get(
    "/listings",
    endpoint(async (req, res) =>
      res.json({ data: await service.list(auth(res), req.query) }),
    ),
  );
  router.get(
    "/listings/:id",
    endpoint(async (req, res) =>
      res.json({
        data: { listing: await service.read(auth(res), target(req)) },
      }),
    ),
  );
  router.patch(
    "/listings/:id/work-version",
    endpoint(async (req, res) => {
      revision(req.body);
      res.json({
        data: {
          operation: await service.save(
            auth(res),
            target(req),
            key(req),
            req.body,
          ),
        },
      });
    }),
  );
  router.post(
    "/listings/:id/preview",
    endpoint(async (req, res) => {
      revision(req.body);
      res.json({
        data: {
          preview: await service.preview(auth(res), target(req), req.body),
        },
      });
    }),
  );
  router.post(
    "/listings/:id/publish",
    endpoint(async (req, res) => {
      revision(req.body);
      res.json({
        data: {
          operation: await service.publish(
            auth(res),
            target(req),
            key(req),
            req.body,
          ),
        },
      });
    }),
  );
  router.post(
    "/listings/:id/transitions",
    endpoint(async (req, res) => {
      revision(req.body);
      res.json({
        data: {
          operation: await service.transition(
            auth(res),
            target(req),
            key(req),
            req.body,
          ),
        },
      });
    }),
  );
  router.get(
    "/operations/:id",
    endpoint(async (req, res) =>
      res.json({
        data: { operation: await service.operation(auth(res), target(req)) },
      }),
    ),
  );
  return router;
}
