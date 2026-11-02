import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import type { PrismaClient } from "@prisma/client";
import { createAuthRouter } from "./modules/auth/auth.router-factory.js";
import { createDraftRouter } from "./modules/listings/draft.routes.js";
import { createDraftMediaRouter } from "./modules/media/draft-media.routes.js";
import type { MediaDependencies } from "./modules/media/draft-media.service.js";

/** One composition shared by runtime and integration tests; no database singleton here. */
export function createApp(db: PrismaClient, media?: MediaDependencies) {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: "http://localhost:5173" })); // Development origin; production deployment is not configured.
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "taiwan-rental-api", timestamp: new Date().toISOString() });
  });
  app.use("/api/v1/auth", createAuthRouter(db));
  app.use("/api/v1/drafts/:id/images", createDraftMediaRouter(db, media));
  app.use("/api/v1/drafts", createDraftRouter(db));
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "API endpoint not found" } }));
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    const parserErrors: Record<string, { status: number; code: string; message: string }> = {
      "entity.too.large": { status: 413, code: "PAYLOAD_TOO_LARGE", message: "請求內容超過允許大小" },
      "entity.parse.failed": { status: 400, code: "VALIDATION_ERROR", message: "JSON 格式不正確" },
      "encoding.unsupported": { status: 415, code: "UNSUPPORTED_ENCODING", message: "不支援此內容編碼" },
      "charset.unsupported": { status: 415, code: "UNSUPPORTED_CHARSET", message: "不支援此字元編碼" },
      "request.aborted": { status: 400, code: "REQUEST_ABORTED", message: "請求未完整傳送" },
      "request.size.invalid": { status: 400, code: "INVALID_REQUEST_SIZE", message: "請求大小不正確" },
    };
    // Match known parser errors, never trust an arbitrary exception's status/message.
    const failure = Object.hasOwn(parserErrors, error?.type) ? parserErrors[error.type] : undefined;
    res.setHeader("Cache-Control", "no-store");
    if (failure) { res.status(failure.status).json({ error: { code: failure.code, message: failure.message } }); return; }
    res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: "伺服器發生錯誤，請稍後再試" } });
  };
  app.use(errorHandler);
  return app;
}
