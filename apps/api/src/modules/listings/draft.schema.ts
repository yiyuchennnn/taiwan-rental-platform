import { z } from "zod";
import { textField, decimalWithin, rentalTypes, buildingTypes, floorNumber, status3, permission3,
  feeFrequency, utilityChargeSchema, equipmentItemSchema, feeItemSchema, uniqueArray } from "./input-rules.js";
import { draftAddressPatchSchema } from "./draft-address.js";

const integer = z.number().int().min(-2147483648).max(2147483647);
const count = z.number().int().min(0).max(100).nullable();
const money = z.number().int().min(0).max(10000000).nullable();
const text = z.string().nullable();
const flag = z.boolean().nullable();
const billing = z.enum(["INCLUDED", "BY_BILL", "SEPARATE", "NOT_PROVIDED"]).nullable();
const decimal = decimalWithin("0.01", "10000").nullable();

// Storage-field PATCH contract: missing means unchanged, null explicitly clears.
// Never accept identity, state, shared Property links, verification or consent timestamps.
export const draftPatchSchema = z.object({
  address: draftAddressPatchSchema.nullable(),
  title: textField(80).nullable(), description: textField(10000).nullable(),
  rentalType: z.enum(rentalTypes).nullable(),
  buildingType: z.enum(buildingTypes).nullable(),
  buildingDescription: textField(100).nullable(), areaPings: decimal,
  areaSource: z.enum(["INTERIOR", "REGISTERED", "ESTIMATED"]).nullable(),
  bedrooms: count, livingRooms: count, bathrooms: count, balconies: count,
  totalFloors: z.number().int().min(1).max(200).nullable(), hasElevator: flag,
  floorMode: z.enum(["SINGLE", "RANGE", "MULTIPLE", "ENTIRE_BUILDING"]).nullable(), floorFrom: floorNumber.nullable(), floorTo: floorNumber.nullable(), floors: z.array(floorNumber).refine(v => new Set(v).size === v.length, "樓層不可重複"),
  rent: z.number().int().min(1).max(10000000).nullable(), deposit: z.number().int().min(0).max(100000000).nullable(),
  depositMode: z.enum(["NONE", "MONTHS", "FIXED"]).nullable(), depositMonths: decimalWithin("0.01", "100").nullable(),
  managementFeeMode: z.enum(["NONE", "INCLUDED", "SEPARATE"]).nullable(), managementFee: money,
  waterBilling: billing, waterFeeDescription: text,
  electricityBilling: billing, electricityFeeDescription: text,
  gasBilling: billing, gasFeeDescription: text,
  internetBilling: billing, internetFeeDescription: text,
  hasCarParking: flag, carParkingType: text, carParkingIncludedInRent: flag, carParkingFee: money,
  hasMotorcycleParking: flag, motorcycleParkingType: text, motorcycleParkingIncludedInRent: flag, motorcycleParkingFee: money,
  equipmentMode: z.enum(["NONE", "PRESENT"]).nullable(), furniture: z.array(z.string()), appliances: z.array(z.string()),
  balconyMode: z.enum(["NONE", "PRIVATE", "SHARED"]).nullable(),
  sharedSpaces: z.array(z.enum(["BATHROOM", "KITCHEN", "LIVING_ROOM", "LAUNDRY", "BALCONY"])), sharedSpaceDescription: text,
  cookingAllowed: flag, laundryDescription: text, dryingDescription: text, garbageDisposalDescription: text,
  minimumLeaseTerm: text, occupancyMode: z.enum(["IMMEDIATE", "DATE", "NEGOTIABLE"]).nullable(), availableFrom: z.iso.date().nullable(),
  petsAllowed: flag, petConditions: textField(500).nullable(), petFeeDescription: text, additionalConditions: text, subsidyDescription: text,
  contactName: textField(50).nullable(), contactPhone: text, contactEmail: text, contactLine: text,
  publisherType: z.enum(["LANDLORD", "AGENT", "AUTHORIZED_REPRESENTATIVE"]).nullable(), companyName: textField(100).nullable(), serviceFeeDescription: text,
  elevatorStatus: status3.nullable(), petPolicy: permission3.nullable(), cookingPolicy: permission3.nullable(),
  laundryStatus: z.enum(["PRIVATE", "SHARED", "NONE", "UNKNOWN"]).nullable(),
  dryingStatus: z.enum(["PRIVATE", "SHARED", "NONE", "UNKNOWN"]).nullable(),
  garbageStatus: z.enum(["STAFF", "CENTRAL", "SELF", "OTHER", "UNKNOWN"]).nullable(),
  subsidyPolicy: z.enum(["ACCEPTED", "NOT_ACCEPTED", "UNKNOWN"]).nullable(),
  minimumLeaseMonths: z.number().int().min(1).max(120).nullable(),
  carParkingStatus: status3.nullable(), motorcycleParkingStatus: status3.nullable(),
  carParkingRequired: flag, motorcycleParkingRequired: flag,
  carParkingFrequency: feeFrequency.nullable(), motorcycleParkingFrequency: feeFrequency.nullable(),
  contactExtension: z.string().regex(/^\d{1,10}$/).nullable(),
  authorizationDescription: textField(200).nullable(),
  utilityCharges: uniqueArray(utilityChargeSchema, "kind", 4),
  equipmentItems: uniqueArray(equipmentItemSchema, "code", 9),
  feeItems: z.array(feeItemSchema),
}).partial().strict();
