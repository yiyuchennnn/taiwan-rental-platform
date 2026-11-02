import type { RequestHandler } from "express";
import type { SessionService } from "./session.service.js";

export type AuthenticatedSession = NonNullable<Awaited<ReturnType<SessionService["authenticate"]>>>;

export function requireAuth(sessions: SessionService): RequestHandler {
  return async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.get("authorization") ?? "");
    const session = match ? await sessions.authenticate(match[1]!) : null;
    if (!session) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "請先登入" } });
      return;
    }
    res.locals.auth = session;
    next();
  };
}
