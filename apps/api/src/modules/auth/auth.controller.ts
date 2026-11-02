import type { RequestHandler } from "express";
import { ZodError } from "zod";
import { EmailAlreadyExistsError, InvalidCredentialsError, type createAuthService } from "./auth.service.js";
import type { SessionService } from "./session.service.js";
import type { AuthenticatedSession } from "./require-auth.js";

export function createAuthControllers(auth: ReturnType<typeof createAuthService>, sessions: SessionService) {
  function endpoint(action: RequestHandler): RequestHandler {
    return async (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      try { await action(req, res, next); }
      catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "資料格式不正確",
            details: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) } });
        } else if (error instanceof EmailAlreadyExistsError) {
          res.status(409).json({ error: { code: "EMAIL_ALREADY_EXISTS", message: "此 Email 已被註冊" } });
        } else if (error instanceof InvalidCredentialsError) {
          res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email 或密碼不正確" } });
        } else { next(error); }
      }
    };
  }
  return {
    register: endpoint(async (req, res) => {
      const user = await auth.registerUser(req.body);
      res.status(201).json({ data: { user } });
    }),
    login: endpoint(async (req, res) => {
      const user = await auth.loginUser(req.body);
      const session = await sessions.create(user.id);
      // No Cookie or client-selected user ID is accepted as authentication.
      res.status(200).json({ data: { user, accessToken: session.token, tokenType: "Bearer", expiresAt: session.expiresAt } });
    }),
    me: endpoint(async (_req, res) => {
      const auth = res.locals.auth as AuthenticatedSession;
      res.status(200).json({ data: { user: auth.user } });
    }),
    logout: endpoint(async (_req, res) => {
      const auth = res.locals.auth as AuthenticatedSession;
      await sessions.revoke(auth.sessionId);
      res.status(204).end();
    }),
  };
}
