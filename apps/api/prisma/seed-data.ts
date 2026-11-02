import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

const administrativeData = z.array(z.object({
  code: z.string().min(1), name: z.string().min(1),
  districts: z.array(z.object({ code: z.string().min(1), name: z.string().min(1) })).min(1),
})).length(22);

/** Administrative data import must not choose/reset the operational launch area. */
export async function seedAdministrativeData(db: PrismaClient, input: unknown) {
  const cities = administrativeData.parse(input);
  if (new Set(cities.map(x => x.code)).size !== cities.length || new Set(cities.map(x => x.name)).size !== cities.length
    || cities.some(city => new Set(city.districts.map(x => x.code)).size !== city.districts.length
      || new Set(city.districts.map(x => x.name)).size !== city.districts.length)) throw new Error("Duplicate administrative data");
  await db.$transaction(async tx => {
    for (const city of cities) {
      await tx.city.upsert({ where: { code: city.code }, update: { name: city.name }, create: { code: city.code, name: city.name } });
      for (const district of city.districts) {
        await tx.district.upsert({ where: { cityCode_code: { cityCode: city.code, code: district.code } },
          update: { name: district.name }, create: { cityCode: city.code, code: district.code, name: district.name } });
      }
    }
  }, { timeout: 30000 });
  return { cities: cities.length, districts: cities.reduce((sum, city) => sum + city.districts.length, 0) };
}
