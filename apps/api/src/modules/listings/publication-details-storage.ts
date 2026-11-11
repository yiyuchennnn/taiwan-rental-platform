import type { Listing, Prisma } from "@prisma/client";
import { publicationDetailsSchema } from "./publication-details.js";

/** Full section replacement only. Caller must enforce ownership; no state or authority fields are accepted. */
export function publicationDetailsToStorage(input: unknown): Prisma.ListingUncheckedUpdateInput {
  const value = publicationDetailsSchema.parse(input);
  return {
    rentalType: value.rentalType, buildingType: value.buildingType,
    buildingDescription: value.buildingType === "OTHER_RESIDENTIAL" ? value.buildingDescription! : null,
    hasElevator: value.hasElevator,
    depositMode: value.deposit.mode,
    depositMonths: value.deposit.mode === "MONTHS" ? value.deposit.months : null,
    deposit: value.deposit.mode === "FIXED" ? value.deposit.amount : value.deposit.mode === "NONE" ? 0 : null,
    managementFeeMode: value.managementFee.mode,
    managementFee: value.managementFee.mode === "SEPARATE" ? value.managementFee.amount : value.managementFee.mode === "NONE" ? 0 : null,
    occupancyMode: value.occupancy.mode,
    availableFrom: value.occupancy.mode === "DATE" ? new Date(`${value.occupancy.date}T00:00:00.000Z`) : null,
    minimumLeaseMonths: value.minimumLeaseMonths,
    equipmentMode: value.equipment.mode,
    furniture: value.equipment.mode === "PRESENT" ? value.equipment.furniture : [],
    appliances: value.equipment.mode === "PRESENT" ? value.equipment.appliances : [],
    equipmentConfirmedAt: new Date(),
    floorMode: value.floor.mode,
    floors: value.floor.mode === "MULTIPLE" ? value.floor.levels : [],
    floorFrom: value.floor.mode === "SINGLE" ? value.floor.level : value.floor.mode === "RANGE" ? value.floor.from : null,
    floorTo: value.floor.mode === "RANGE" ? value.floor.to : null,
    totalFloors: value.totalFloors,
    isWholeBuilding: value.rentalType === "ENTIRE_BUILDING",
    bedrooms: value.bedrooms ?? null, livingRooms: value.livingRooms ?? null,
    bathrooms: value.privateBathrooms ?? null,
    balconyMode: value.balcony?.mode ?? null,
    balconies: value.balcony?.mode === "NONE" ? 0 : value.balcony?.mode === "PRIVATE" ? value.balcony.count ?? null : null,
    sharedSpaces: value.sharedSpaces ?? [], sharedSpaceDescription: value.sharedSpaceDescription ?? null,
  };
}

/** Never infer modes from legacy zero amounts, dates or the shared Property.floor. */
export function publicationDetailsFromStorage(row: Listing) {
  const parsed = publicationDetailsSchema.safeParse({
    rentalType: row.rentalType, buildingType: row.buildingType,
    buildingDescription: row.buildingDescription ?? undefined, hasElevator: row.hasElevator,
    deposit: row.depositMode === "MONTHS" ? { mode: row.depositMode, months: row.depositMonths === null ? undefined : Number(row.depositMonths) }
      : row.depositMode === "FIXED" ? { mode: row.depositMode, amount: row.deposit } : { mode: row.depositMode },
    managementFee: row.managementFeeMode === "SEPARATE" ? { mode: row.managementFeeMode, amount: row.managementFee } : { mode: row.managementFeeMode },
    occupancy: row.occupancyMode === "DATE" ? { mode: row.occupancyMode, date: row.availableFrom?.toISOString().slice(0, 10) } : { mode: row.occupancyMode },
    minimumLeaseMonths: row.minimumLeaseMonths,
    equipment: row.equipmentMode === "PRESENT" ? { mode: row.equipmentMode, furniture: row.furniture, appliances: row.appliances } : { mode: row.equipmentMode },
    floor: row.floorMode === "SINGLE" ? { mode: row.floorMode, level: row.floorFrom }
      : row.floorMode === "RANGE" ? { mode: row.floorMode, from: row.floorFrom, to: row.floorTo } : row.floorMode === "MULTIPLE" ? { mode: row.floorMode, levels: row.floors } : { mode: row.floorMode },
    totalFloors: row.totalFloors, bedrooms: row.bedrooms ?? undefined, livingRooms: row.livingRooms ?? undefined,
    privateBathrooms: row.bathrooms ?? undefined,
    balcony: row.balconyMode === "PRIVATE" ? { mode: row.balconyMode, count: row.balconies ?? undefined }
      : row.balconyMode === null ? undefined : { mode: row.balconyMode },
    sharedSpaces: row.sharedSpaces, sharedSpaceDescription: row.sharedSpaceDescription ?? undefined,
  });
  return parsed.success ? { complete: true as const, value: parsed.data }
    : { complete: false as const, issues: parsed.error.issues };
}
