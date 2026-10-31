// 向政府 API 取得 22 個縣市。
// 逐一取得每個縣市的行政區。
// 整理成我們 seed.ts 能讀取的 JSON。
// 自動寫入 prisma/data/taiwan-districts.json。

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

type CountyItem = {
  countycode: string;
  countyname: string;
  countycode01: string;
};

type TownItem = {
  towncode: string;
  towncode01: string;
  townname: string;
};

const parser = new XMLParser({
  parseTagValue: false,
  trimValues: true,
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchXml(url: string): Promise<any> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  const xml = await response.text();
  return parser.parse(xml);
}

async function main() {
  const countyData = await fetchXml(
    "https://api.nlsc.gov.tw/other/ListCounty"
  );

  const counties = toArray<CountyItem>(
    countyData.countyItems?.countyItem
  );

  if (counties.length !== 22) {
    throw new Error(`Expected 22 counties, got ${counties.length}`);
  }

  const cities = [];

  for (const county of counties) {
    const townData = await fetchXml(
      `https://api.nlsc.gov.tw/other/ListTown1/${encodeURIComponent(county.countycode)}`
    );

    const towns = toArray<TownItem>(
      townData.townItems?.townItem
    );

    if (towns.length === 0) {
      throw new Error(`No districts found for ${county.countyname}`);
    }

    cities.push({
      code: county.countycode01,
      name: county.countyname,
      districts: towns.map((town) => ({
        code: town.towncode,
        name: town.townname,
      })),
    });

    console.log(`${county.countyname}: ${towns.length} districts`);
  }

  const outputUrl = new URL(
    "./data/taiwan-districts.json",
    import.meta.url
  );

  await writeFile(
    fileURLToPath(outputUrl),
    JSON.stringify(cities, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `Completed: ${cities.length} cities, ` +
    `${cities.reduce((sum, city) => sum + city.districts.length, 0)} districts`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
