import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { fileURLToPath } from "node:url";
/** Unix-socket-only disposable cluster; never reads .env or DATABASE_URL. */
export async function isolatedDatabase() {
  const root = mkdtempSync(join(tmpdir(), "rental-command-")),
    pg = join(root, "pg");
  const run = (name: string, args: string[]) =>
    execFileSync(name, args, { stdio: "pipe" });
  let started = false;
  try {
    run("initdb", [
      "-D",
      pg,
      "-A",
      "trust",
      "-U",
      "postgres",
      "--no-locale",
      "-E",
      "UTF8",
    ]);
    run("pg_ctl", [
      "-D",
      pg,
      "-l",
      join(root, "server.log"),
      "-o",
      `-F -k ${root} -c listen_addresses=''`,
      "-w",
      "start",
    ]);
    started = true;
    const client = new Client({
      host: root,
      user: "postgres",
      database: "postgres",
    });
    await client.connect();
    try {
      const directory = fileURLToPath(
        new URL("../../prisma/migrations/", import.meta.url),
      );
      for (const name of readdirSync(directory)
        .filter((n) => /^\d/.test(n))
        .sort())
        await client.query(
          readFileSync(join(directory, name, "migration.sql"), "utf8"),
        );
    } finally {
      await client.end();
    }
    const db = new PrismaClient({
      adapter: new PrismaPg({
        host: root,
        user: "postgres",
        database: "postgres",
      }),
    });
    return {
      db,
      async close() {
        try {
          await db.$disconnect();
        } finally {
          run("pg_ctl", ["-D", pg, "-m", "immediate", "-w", "stop"]);
          rmSync(root, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    if (started) run("pg_ctl", ["-D", pg, "-m", "immediate", "-w", "stop"]);
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
