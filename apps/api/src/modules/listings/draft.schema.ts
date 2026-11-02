import { z } from "zod";
import { fitsPositiveDecimal12_4 } from "./storage-numbers.js";
import { draftAddressPatchSchema } from "./draft-address.js";

const integer = z.number().int().min(-2147483648).max(2147483647);
const count = integer.nonnegative().nullable();
const text = z.string().nullable();
const flag = z.boolean().nullable();
const billing = z.enum(["INCLUDED", "BY_BILL", "SEPARATE", "NOT_PROVIDED"]).nullable();
const decimal = z.number().refine(fitsPositiveDecimal12_4, "數值須為可原值保存的正數，最多 8 位整數及 4 位小數").nullable();

// Storage-field PATCH contract: missing means unchanged, null explicitly clears.
// Never accept identity, state, shared Property links, verification or consent timestamps.
export const draftPatchSchema = z.object({
  address: draftAddressPatchSchema.nullable(),
  title: text, description: text,
  rentalType: z.enum(["ENTIRE_FLOOR", "SUITE", "ROOM", "ENTIRE_BUILDING"]).nullable(),
  buildingType: z.enum(["APARTMENT", "RESIDENTIAL_BUILDING", "TOWNHOUSE", "OTHER_RESIDENTIAL"]).nullable(),
  buildingDescription: text, areaPings: decimal,
  bedrooms: count, livingRooms: count, bathrooms: count, balconies: count,
  totalFloors: integer.positive().nullable(), hasElevator: flag,
  floorMode: z.enum(["SINGLE", "RANGE", "ENTIRE_BUILDING"]).nullable(), floorFrom: integer.nullable(), floorTo: integer.nullable(),
  rent: count, deposit: count,
  depositMode: z.enum(["NONE", "MONTHS", "FIXED"]).nullable(), depositMonths: decimal,
  managementFeeMode: z.enum(["NONE", "INCLUDED", "SEPARATE"]).nullable(), managementFee: count,
  waterBilling: billing, waterFeeDescription: text,
  electricityBilling: billing, electricityFeeDescription: text,
  gasBilling: billing, gasFeeDescription: text,
  internetBilling: billing, internetFeeDescription: text,
  hasCarParking: flag, carParkingType: text, carParkingIncludedInRent: flag, carParkingFee: count,
  hasMotorcycleParking: flag, motorcycleParkingType: text, motorcycleParkingIncludedInRent: flag, motorcycleParkingFee: count,
  equipmentMode: z.enum(["NONE", "PRESENT"]).nullable(), furniture: z.array(z.string()), appliances: z.array(z.string()),
  balconyMode: z.enum(["NONE", "PRIVATE", "SHARED"]).nullable(),
  sharedSpaces: z.array(z.enum(["BATHROOM", "KITCHEN", "LIVING_ROOM", "LAUNDRY", "BALCONY"])), sharedSpaceDescription: text,
  cookingAllowed: flag, laundryDescription: text, dryingDescription: text, garbageDisposalDescription: text,
  minimumLeaseTerm: text, occupancyMode: z.enum(["IMMEDIATE", "DATE"]).nullable(), availableFrom: z.iso.date().nullable(),
  petsAllowed: flag, petConditions: text, petFeeDescription: text, additionalConditions: text, subsidyDescription: text,
  contactName: text, contactPhone: text, contactEmail: text, contactLine: text,
  publisherType: z.enum(["LANDLORD", "AGENT", "AUTHORIZED_REPRESENTATIVE"]).nullable(), companyName: text, serviceFeeDescription: text,
}).partial().strict();
