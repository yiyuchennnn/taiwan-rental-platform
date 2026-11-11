import { z } from "zod";
import { rentalTypes, buildingTypes, floorNumber, decimalWithin, textField, freeText } from "./input-rules.js";

const text = freeText;
const pgInteger = z.number().int().min(0).max(100);
const count = pgInteger;
const money = z.number().int().min(1).max(10000000);
const floor = floorNumber;
const depositMonths = decimalWithin("0.01", "100");
const common = {
  buildingType: z.enum(buildingTypes),
  buildingDescription: textField(100).optional(),
  hasElevator: z.boolean(),
  deposit: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("NONE") }).strict(),
    z.object({ mode: z.literal("MONTHS"), months: depositMonths }).strict(),
    z.object({ mode: z.literal("FIXED"), amount: z.number().int().min(1).max(100000000) }).strict(),
  ]),
  managementFee: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("INCLUDED") }).strict(),
    z.object({ mode: z.literal("NONE") }).strict(),
    z.object({ mode: z.literal("SEPARATE"), amount: money }).strict(),
  ]),
  occupancy: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("IMMEDIATE") }).strict(),
    z.object({ mode: z.literal("DATE"), date: z.iso.date() }).strict(),
    z.object({ mode: z.literal("NEGOTIABLE") }).strict(),
  ]),
  // R02: explicit monthly duration; legacy free text is never guessed.
  minimumLeaseMonths: z.number().int().min(1).max(120),
  equipment: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("NONE") }).strict(),
    z.object({ mode: z.literal("PRESENT"), furniture: z.array(text), appliances: z.array(text) }).strict(),
  ]),
  floor: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("SINGLE"), level: floor }).strict(),
    z.object({ mode: z.literal("RANGE"), from: floor, to: floor }).strict(),
    z.object({ mode: z.literal("MULTIPLE"), levels: z.array(floor).min(1).refine(v => new Set(v).size === v.length, "樓層不可重複") }).strict(),
    z.object({ mode: z.literal("ENTIRE_BUILDING") }).strict(),
  ]),
  totalFloors: z.number().int().min(1).max(200),
  bedrooms: count.optional(),
  livingRooms: count.optional(),
  privateBathrooms: count.optional(),
  balcony: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("NONE") }).strict(),
    z.object({ mode: z.literal("PRIVATE"), count: pgInteger.positive().optional() }).strict(),
    z.object({ mode: z.literal("SHARED") }).strict(),
  ]).optional(),
  sharedSpaces: z.array(z.enum(["BATHROOM", "KITCHEN", "LIVING_ROOM", "LAUNDRY", "BALCONY"])).optional(),
  sharedSpaceDescription: text.optional(),
};

/** Compatibility section adapter only. Canonical API readiness uses draft.schema + publication-check.
 * This section does not check contact, address, equipment states or publication authority. */
export const publicationDetailsSchema = z.object({
  rentalType: z.enum(rentalTypes),
  ...common,
}).strict().superRefine((value, ctx) => {
  const issue = (path: string[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (value.buildingType === "OTHER_RESIDENTIAL" && !value.buildingDescription) {
    issue(["buildingDescription"], "請說明住宅建物類型");
  }
  if ((value.rentalType === "ENTIRE_BUILDING") !== (value.floor.mode === "ENTIRE_BUILDING")) {
    issue(["floor", "mode"], "樓層填寫方式須符合出租型態");
  }
  if (value.floor.mode === "RANGE" && value.floor.from >= value.floor.to) {
    issue(["floor", "to"], "跨樓層的結束樓層須大於開始樓層");
  }
  if (value.floor.mode === "SINGLE" && value.floor.level === 0) {
    issue(["floor", "level"], "0 樓不符合現行樓層規則");
  }
  if (value.floor.mode === "RANGE") {
    for (const endpoint of ["from", "to"] as const) {
      if (value.floor[endpoint] === 0) issue(["floor", endpoint], "0 樓不符合現行樓層規則");
    }
  }
  if (value.floor.mode === "SINGLE" && value.floor.level > value.totalFloors) {
    issue(["floor", "level"], "所在樓層不得高於總樓層");
  }
  if (value.floor.mode === "RANGE") {
    for (const endpoint of ["from", "to"] as const) {
      if (value.floor[endpoint] > value.totalFloors) {
        issue(["floor", endpoint], "所在樓層不得高於總樓層");
      }
    }
  }
  if (value.floor.mode === "MULTIPLE" && value.floor.levels.some(n => n > value.totalFloors)) issue(["floor", "levels"], "所在樓層不得高於總樓層");
  if (value.balcony?.mode === "NONE" && value.sharedSpaces?.includes("BALCONY")) {
    issue(["sharedSpaces"], "已選擇無陽台，不能同時選擇共用陽台");
  }
  if (value.rentalType === "ENTIRE_HOME" || value.rentalType === "ENTIRE_BUILDING") {
    for (const field of ["bedrooms", "livingRooms", "privateBathrooms"] as const) {
      if (value[field] === undefined) issue([field], "請明確填寫數量，沒有請填 0");
    }
    if (!value.balcony) issue(["balcony"], "請選擇陽台情況");
    if (value.balcony?.mode === "PRIVATE" && value.balcony.count === undefined) {
      issue(["balcony", "count"], "請填寫陽台數量");
    }
  }
  if ((value.rentalType === "INDEPENDENT_SUITE" || value.rentalType === "SHARED_SUITE")) {
    if (value.privateBathrooms === undefined || value.privateBathrooms < 1) {
      issue(["privateBathrooms"], "套房須至少一間獨立衛浴");
    }
    if (!value.balcony) issue(["balcony"], "請選擇專用、共用或無陽台");
  }
  if (value.rentalType === "ROOM") {
    if (value.privateBathrooms !== undefined && value.privateBathrooms !== 0) issue(["privateBathrooms"], "雅房不填專用衛浴數，請填共用空間");
    if (!value.sharedSpaces?.includes("BATHROOM")) issue(["sharedSpaces"], "雅房須標明共用衛浴");
  }
  if (value.equipment.mode === "PRESENT" && !value.equipment.furniture.length && !value.equipment.appliances.length) {
    issue(["equipment"], "請選擇至少一項設備，或明確選擇無設備");
  }
});
