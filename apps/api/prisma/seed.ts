// 1. 讀取 taiwan-districts.json。
// 2. 使用 upsert() 寫入縣市與行政區，重複執行時更新既有資料，而不是一直新增。
// 3. 將臺中市設為開放，其他縣市設為未開放。

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma.js";

type DistrictData = {
  code: string;
  name: string;
};

type CityData = {
  code: string;
  name: string;
  districts: DistrictData[];
};

async function main() {
  const dataUrl = new URL("./data/taiwan-districts.json", import.meta.url);
  const rawData = await readFile(fileURLToPath(dataUrl), "utf8");
  const cities: CityData[] = JSON.parse(rawData);

  if (!Array.isArray(cities) || cities.length !== 22) {
    throw new Error("Expected 22 cities in seed data");
  }

  for (const city of cities) {
    if (!city.code || !city.name || !Array.isArray(city.districts) || city.districts.length === 0) {
      throw new Error(`Invalid city data: ${city.name ?? city.code}`);
    }

    await prisma.city.upsert({
      where: { code: city.code },
      update: {
        name: city.name,
        isEnabled: city.name === "臺中市",
      },
      create: {
        code: city.code,
        name: city.name,
        isEnabled: city.name === "臺中市",
      },
    });

    for (const district of city.districts) {
      if (!district.code || !district.name) {
        throw new Error(`Invalid district data in ${city.name}`);
      }

      await prisma.district.upsert({
        where: {
          cityCode_code: {
            cityCode: city.code,
            code: district.code,
          },
        },
        update: {
          name: district.name,
        },
        create: {
          cityCode: city.code,
          code: district.code,
          name: district.name,
        },
      });
    }

    console.log(`Imported ${city.name}: ${city.districts.length} districts`);
  }

  console.log("Taiwan administrative divisions imported successfully");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
