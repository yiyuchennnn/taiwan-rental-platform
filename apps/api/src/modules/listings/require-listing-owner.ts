import type { PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import type { AuthenticatedSession } from "../auth/require-auth.js";

/** Use after requireAuth. This is an ownership gate, not permission to publish. */
export function requireListingOwner(db: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    const auth = res.locals.auth as AuthenticatedSession | undefined;
    if (!auth) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "請先登入" } }); return;
    }
    const id = req.params.id;
    const listing = typeof id === "string" ? await db.listing.findFirst({
      where: { id, publisherId: auth.user.id }, select: { id: true },
    }) : null;
    if (!listing) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "找不到刊登" } }); return;
    }
    res.locals.listingId = listing.id;
    next();
  };
}
