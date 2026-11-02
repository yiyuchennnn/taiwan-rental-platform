import { prisma } from "../../lib/prisma.js";
import { createAuthRouter } from "./auth.router-factory.js";

export const authRouter = createAuthRouter(prisma);
