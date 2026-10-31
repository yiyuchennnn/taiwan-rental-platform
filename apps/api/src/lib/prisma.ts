import "dotenv/config";  //讀取 .env 中的環境變數。
import { PrismaClient } from "@prisma/client"; //讓 TypeScript 能操作資料庫。
import { PrismaPg } from "@prisma/adapter-pg"; //Prisma 7 連接 PostgreSQL 所使用的 Driver Adapter。

//你在 Neon 建立的資料庫連線字串。
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const adapter = new PrismaPg({
  connectionString,
});

export const prisma = new PrismaClient({ //讓其他程式可以共用這個 Prisma Client。
  adapter,
});
