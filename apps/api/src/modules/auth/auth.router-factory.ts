import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { createAuthService } from "./auth.service.js";
import { createSessionService, sessionLifetimeSeconds } from "./session.service.js";
import { createAuthControllers } from "./auth.controller.js";
import { requireAuth } from "./require-auth.js";

export function createAuthRouter(db: PrismaClient, ttlSeconds = sessionLifetimeSeconds()) {
  const router = Router();
  const sessions = createSessionService(db, ttlSeconds);
  const controllers = createAuthControllers(createAuthService(db), sessions);
  router.post("/register", controllers.register);
  router.post("/login", controllers.login);
  router.get("/me", requireAuth(sessions), controllers.me);
  router.post("/logout", requireAuth(sessions), controllers.logout);
  return router;
}
