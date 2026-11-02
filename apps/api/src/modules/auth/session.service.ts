import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { InvalidCredentialsError } from "./auth.service.js";

const publicUser = { id: true, email: true, name: true, role: true, createdAt: true } as const;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function sessionLifetimeSeconds(value = process.env.SESSION_TTL_SECONDS): number {
  // Configurable security default, not a subscription or account lifecycle rule.
  const seconds = value === undefined ? 8 * 60 * 60 : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || !Number.isFinite(new Date(Date.now() + seconds * 1000).getTime())) {
    throw new Error("Invalid SESSION_TTL_SECONDS configuration");
  }
  return seconds;
}

export function createSessionService(db: PrismaClient, ttlSeconds: number) {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error("Invalid session lifetime");
  return {
    async create(userId: string) {
      const token = randomBytes(32).toString("base64url");
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
      if (!Number.isFinite(expiresAt.getTime())) throw new Error("Invalid session expiry");
      const session = await db.$transaction(async tx => {
        // Serialize issuance with account-state updates; do not issue to disabled accounts.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true } });
        if (!user?.isActive) throw new InvalidCredentialsError();
        return tx.authSession.create({ data: { userId, tokenHash: hash(token), createdAt, expiresAt }, select: { expiresAt: true } });
      });
      return { token, expiresAt: session.expiresAt };
    },
    async authenticate(token: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const session = await db.authSession.findUnique({ where: { tokenHash: hash(token) },
        select: { id: true, revokedAt: true, expiresAt: true, user: { select: { ...publicUser, isActive: true } } } });
      if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.user.isActive) return null;
      const { isActive, ...user } = session.user;
      return { sessionId: session.id, user };
    },
    async revoke(sessionId: string) {
      await db.$transaction(async tx => {
        // Same account lock as authenticated draft/media writes: a completed
        // logout must not race past a write that already checked this session.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = (SELECT "userId" FROM "AuthSession" WHERE id = ${sessionId}) FOR UPDATE`;
        await tx.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
      });
    },
  };
}
export type SessionService = ReturnType<typeof createSessionService>;
