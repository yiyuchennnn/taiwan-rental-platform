import { z } from "zod";
import { fitsPositiveDecimal12_4 } from "./storage-numbers.js";

const text = z.string().trim().min(1);
// Storage bounds, not business limits. Never silently round or truncate input.
const pgInteger = z.number().int().min(-2147483648).max(2147483647);
const count = pgInteger.nonnegative();
const money = pgInteger.nonnegative();
const floor = pgInteger;
const depositMonths = z.number().positive().refine(fitsPositiveDecimal12_4,
  "押金月數目前須能以最多 8 位整數、4 位小數原值保存；不會自動四捨五入");
const common = {
  buildingType: z.enum(["APARTMENT", "RESIDENTIAL_BUILDING", "TOWNHOUSE", "OTHER_RESIDENTIAL"]),
  buildingDescription: text.optional(),
  hasElevator: z.boolean(),
  deposit: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("NONE") }).strict(),
    z.object({ mode: z.literal("MONTHS"), months: depositMonths }).strict(),
    z.object({ mode: z.literal("FIXED"), amount: money }).strict(),
  ]),
  managementFee: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("INCLUDED") }).strict(),
    z.object({ mode: z.literal("NONE") }).strict(),
    z.object({ mode: z.literal("SEPARATE"), amount: money }).strict(),
  ]),
  occupancy: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("IMMEDIATE") }).strict(),
    z.object({ mode: z.literal("DATE"), date: z.iso.date() }).strict(),
  ]),
  // No unconfirmed fixed list of periods or minimum one-month restriction.
  minimumLeaseTerm: text,
  equipment: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("NONE") }).strict(),
    z.object({ mode: z.literal("PRESENT"), furniture: z.array(text), appliances: z.array(text) }).strict(),
  ]),
  floor: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("SINGLE"), level: floor }).strict(),
    z.object({ mode: z.literal("RANGE"), from: floor, to: floor }).strict(),
    z.object({ mode: z.literal("ENTIRE_BUILDING") }).strict(),
  ]),
  totalFloors: pgInteger.positive(),
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

/** Structured section validation only: not a draft parser, persistence DTO or authorization. */
export const publicationDetailsSchema = z.object({
  rentalType: z.enum(["ENTIRE_FLOOR", "SUITE", "ROOM", "ENTIRE_BUILDING"]),
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
    issue(["floor", "level"], "0 樓的表示方式尚待確認，不能視為已通過上架檢查");
  }
  if (value.floor.mode === "RANGE") {
    for (const endpoint of ["from", "to"] as const) {
      if (value.floor[endpoint] === 0) issue(["floor", endpoint], "0 樓的表示方式尚待確認");
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
  if (value.balcony?.mode === "NONE" && value.sharedSpaces?.includes("BALCONY")) {
    issue(["sharedSpaces"], "已選擇無陽台，不能同時選擇共用陽台");
  }
  if (value.rentalType === "ENTIRE_FLOOR" || value.rentalType === "ENTIRE_BUILDING") {
    for (const field of ["bedrooms", "livingRooms", "privateBathrooms"] as const) {
      if (value[field] === undefined) issue([field], "請明確填寫數量，沒有請填 0");
    }
    if (!value.balcony) issue(["balcony"], "請選擇陽台情況");
    if (value.balcony?.mode === "PRIVATE" && value.balcony.count === undefined) {
      issue(["balcony", "count"], "請填寫陽台數量");
    }
  }
  if (value.rentalType === "SUITE") {
    if (value.privateBathrooms === undefined || value.privateBathrooms < 1) {
      issue(["privateBathrooms"], "套房須至少一間獨立衛浴");
    }
    if (!value.balcony) issue(["balcony"], "請選擇專用、共用或無陽台");
  }
  if (value.rentalType === "ROOM") {
    if (value.privateBathrooms !== undefined) issue(["privateBathrooms"], "雅房不填專用衛浴數，請填共用空間");
    if (!value.sharedSpaces?.includes("BATHROOM")) issue(["sharedSpaces"], "雅房須標明共用衛浴");
  }
  if (value.equipment.mode === "PRESENT" && !value.equipment.furniture.length && !value.equipment.appliances.length) {
    issue(["equipment"], "請選擇至少一項設備，或明確選擇無設備");
  }
});
