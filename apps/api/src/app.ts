import { prisma } from "./lib/prisma.js";
import { configuredMedia } from "./modules/media/media-runtime.js";
import { createApp } from "./app-factory.js";

export const app = createApp(prisma, configuredMedia());
