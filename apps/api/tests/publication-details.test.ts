import { expect, test } from "vitest";
import { publicationDetailsSchema } from "../src/modules/listings/publication-details.js";

const base = () => ({ rentalType: "SUITE", buildingType: "TOWNHOUSE", hasElevator: false,
  deposit: { mode: "MONTHS", months: 2 }, managementFee: { mode: "INCLUDED" },
  occupancy: { mode: "IMMEDIATE" }, minimumLeaseTerm: "可短租，另議", equipment: { mode: "NONE" },
  floor: { mode: "SINGLE", level: -1 }, totalFloors: 4, privateBathrooms: 1, balcony: { mode: "NONE" } });
test("suite supports basement, no equipment, immediate occupancy and no room/living-room counts", () => {
  expect(publicationDetailsSchema.safeParse(base()).success).toBe(true);
});
test.each(["NONE", "INCLUDED"])("management fee %s requires no extra typing", mode => {
  expect(publicationDetailsSchema.safeParse({ ...base(), managementFee: { mode } }).success).toBe(true);
});
test("separate management fee and fixed deposit require explicit amounts including zero", () => {
  expect(publicationDetailsSchema.safeParse({ ...base(), managementFee: { mode: "SEPARATE" } }).success).toBe(false);
  expect(publicationDetailsSchema.safeParse({ ...base(), managementFee: { mode: "SEPARATE", amount: 0 }, deposit: { mode: "FIXED", amount: 0 } }).success).toBe(true);
});
test("selected occupancy date must be a real date", () => {
  expect(publicationDetailsSchema.safeParse({ ...base(), occupancy: { mode: "DATE", date: "2026-02-30" } }).success).toBe(false);
  expect(publicationDetailsSchema.safeParse({ ...base(), occupancy: { mode: "DATE", date: "2026-12-01" } }).success).toBe(true);
});
test("other residential buildings require a description", () => {
  expect(publicationDetailsSchema.safeParse({ ...base(), buildingType: "OTHER_RESIDENTIAL" }).success).toBe(false);
  expect(publicationDetailsSchema.safeParse({ ...base(), buildingType: "OTHER_RESIDENTIAL", buildingDescription: "住宅用途建物" }).success).toBe(true);
});
test("a room uses shared bathroom selection instead of typing a mandatory paragraph", () => {
  const { privateBathrooms, ...room } = base();
  expect(publicationDetailsSchema.safeParse({ ...room, rentalType: "ROOM", sharedSpaces: ["BATHROOM"] }).success).toBe(true);
  expect(publicationDetailsSchema.safeParse({ ...room, rentalType: "ROOM", sharedSpaces: [] }).success).toBe(false);
});
test("whole buildings require counts but no single floor", () => {
  const value = { ...base(), rentalType: "ENTIRE_BUILDING", floor: { mode: "ENTIRE_BUILDING" }, bedrooms: 3, livingRooms: 0 };
  expect(publicationDetailsSchema.safeParse(value).success).toBe(true);
  expect(publicationDetailsSchema.safeParse({ ...value, floor: { mode: "SINGLE", level: 1 } }).success).toBe(false);
});
test("floor ranges have ordered endpoints and preserve basement floors", () => {
  expect(publicationDetailsSchema.safeParse({ ...base(), floor: { mode: "RANGE", from: -1, to: 1 } }).success).toBe(true);
  expect(publicationDetailsSchema.safeParse({ ...base(), floor: { mode: "RANGE", from: 4, to: 3 } }).success).toBe(false);
});
test.each([{ mode: "SINGLE", level: 0 }, { mode: "RANGE", from: 0, to: 2 }, { mode: "RANGE", from: -1, to: 0 }])("zero floor remains unresolved for publication: %j", floor => {
  expect(publicationDetailsSchema.safeParse({ ...base(), floor }).success).toBe(false);
});
test("equipment selection cannot silently claim equipment exists with an empty list", () => {
  expect(publicationDetailsSchema.safeParse({ ...base(), equipment: { mode: "PRESENT", furniture: [], appliances: [] } }).success).toBe(false);
});
test("suite requires a private bathroom and explicit balcony choice", () => {
  expect(publicationDetailsSchema.safeParse({ ...base(), privateBathrooms: 0 }).success).toBe(false);
  const { balcony, ...value } = base();
  expect(publicationDetailsSchema.safeParse(value).success).toBe(false);
});

test.each([0.00001, 1.23456, 100000000])("rejects deposit months %s that cannot be stored unchanged", months => {
  const result = publicationDetailsSchema.safeParse({ ...base(), deposit: { mode: "MONTHS", months } });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues[0].path).toEqual(["deposit", "months"]);
});
test.each([0.0001, 1.2345, 99999999.9999])("accepts exactly representable deposit months %s", months => {
  expect(publicationDetailsSchema.safeParse({ ...base(), deposit: { mode: "MONTHS", months } }).success).toBe(true);
});
test.each(["deposit", "managementFee"])("rejects %s amount outside PostgreSQL integer capacity", field => {
  const mode = field === "deposit" ? "FIXED" : "SEPARATE";
  expect(publicationDetailsSchema.safeParse({ ...base(), [field]: { mode, amount: 2147483648 } }).success).toBe(false);
  expect(publicationDetailsSchema.safeParse({ ...base(), [field]: { mode, amount: 2147483647 } }).success).toBe(true);
});
test("rejects count and floor numbers outside storage capacity", () => {
  expect(publicationDetailsSchema.safeParse({ ...base(), bedrooms: 2147483648 }).success).toBe(false);
  expect(publicationDetailsSchema.safeParse({ ...base(), totalFloors: 2147483648 }).success).toBe(false);
  expect(publicationDetailsSchema.safeParse({ ...base(), floor: { mode: "SINGLE", level: -2147483649 } }).success).toBe(false);
});
test("no balcony cannot coexist with a shared balcony selection", () => {
  const result = publicationDetailsSchema.safeParse({ ...base(), sharedSpaces: ["BALCONY"] });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.some(issue => issue.path.join(".") === "sharedSpaces")).toBe(true);
});
test("private and shared balconies may coexist without inventing exclusivity", () => {
  expect(publicationDetailsSchema.safeParse({ ...base(), balcony: { mode: "PRIVATE", count: 1 }, sharedSpaces: ["BALCONY"] }).success).toBe(true);
});

test.each([
  { floor: { mode: "SINGLE", level: 5 }, paths: ["floor.level"] },
  { floor: { mode: "RANGE", from: 3, to: 5 }, paths: ["floor.to"] },
  { floor: { mode: "RANGE", from: 5, to: 6 }, paths: ["floor.from", "floor.to"] },
])("rejects floors above the building with field paths: $floor", ({ floor, paths }) => {
  const result = publicationDetailsSchema.safeParse({ ...base(), floor, totalFloors: 4 });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.map(issue => issue.path.join("."))).toEqual(paths);
});
test.each([
  { mode: "SINGLE", level: 4 },
  { mode: "SINGLE", level: -2 },
  { mode: "RANGE", from: -2, to: -1 },
  { mode: "RANGE", from: -1, to: 4 },
])("preserves valid floor boundaries and basements: %j", floor => {
  expect(publicationDetailsSchema.safeParse({ ...base(), floor, totalFloors: 4 }).success).toBe(true);
});
