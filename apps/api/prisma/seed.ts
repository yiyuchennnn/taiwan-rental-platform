import "dotenv/config";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma.js";
import { seedAdministrativeData } from "./seed-data.js";

async function main() {
  const data = JSON.parse(await readFile(new URL("./data/taiwan-districts.json", import.meta.url), "utf8"));
  const result = await seedAdministrativeData(prisma, data);
  console.log(`Imported ${result.cities} cities and ${result.districts} districts; launch-area settings preserved`);
}
main().catch(() => {
  console.error("Administrative seed failed; no partial import was committed");
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
