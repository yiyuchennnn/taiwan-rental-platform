import { z } from "zod";
import { checkConfirmedPublicationRules } from "./publication-check.js";
import type { Listing, Prisma, PrismaClient } from "@prisma/client";
import type { AuthenticatedSession } from "../auth/require-auth.js";
import { childFields, patchDraftDetails, readDraftDetails } from "./draft-details.js";
import { validNewOccupancy } from "./input-rules.js";
import { draftPatchSchema } from "./draft.schema.js";
import { patchDraftAddress, readDraftAddress } from "./draft-address.js";

export class DraftError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// Trusted server-side dependency, never request input. C01 must be explicitly resolved by the provider.
export type DraftCreationPolicy = (tx: Prisma.TransactionClient, userId: string) => Promise<{
  draftLimit: number;
}>;
export const unavailableDraftPolicy: DraftCreationPolicy = async () => {
  throw new DraftError(503, "DRAFT_ENTITLEMENTS_UNAVAILABLE", "草稿新增資格尚未接妥，請稍後再試");
};

export function dataForPatch(current: Listing | null, input: unknown): Prisma.ListingUncheckedUpdateInput {
  const patch = draftPatchSchema.parse(input);
  const { address: _address, utilityCharges: _utilities, equipmentItems: _equipment, feeItems: _fees, ...scalars } = patch;
  const data: Prisma.ListingUncheckedUpdateInput = { ...scalars,
    availableFrom: patch.availableFrom === undefined ? undefined : patch.availableFrom === null ? null : new Date(`${patch.availableFrom}T00:00:00.000Z`),
  };
  const issues: z.core.$ZodIssue[] = [];
  const reject = (path: string, message: string) => issues.push({ code: "custom", path: [path], message });
  if (patch.rentalType !== undefined) data.isWholeBuilding = patch.rentalType === null ? null : patch.rentalType === "ENTIRE_BUILDING";
  if (patch.depositMode !== undefined) {
    if (patch.depositMode !== "MONTHS") {
      if (patch.depositMonths != null) reject("depositMonths", "此押金模式不使用月數");
      data.depositMonths = null;
    } else {
      if (patch.deposit != null) reject("deposit", "月數押金不使用固定金額");
      data.deposit = null;
      if (current?.depositMode !== "MONTHS" && patch.depositMonths === undefined) data.depositMonths = null;
    }
    if (patch.depositMode === "NONE") {
      if (patch.deposit != null && patch.deposit !== 0) reject("deposit", "免押金不能同時有押金金額");
      data.deposit = 0;
    } else if (patch.depositMode === "FIXED" && current?.depositMode !== "FIXED" && patch.deposit === undefined) data.deposit = null;
  }
  if (patch.managementFeeMode !== undefined && patch.managementFeeMode !== "SEPARATE") {
    if (patch.managementFee != null && !(patch.managementFeeMode === "NONE" && patch.managementFee === 0)) reject("managementFee", "此模式不使用另計管理費");
    data.managementFee = patch.managementFeeMode === "NONE" ? 0 : null;
  } else if (patch.managementFeeMode === "SEPARATE" && current?.managementFeeMode !== "SEPARATE" && patch.managementFee === undefined) data.managementFee = null;
  if (patch.occupancyMode === "IMMEDIATE" || patch.occupancyMode === "NEGOTIABLE") {
    if (patch.availableFrom != null) reject("availableFrom", "隨時入住不使用指定日期");
    data.availableFrom = null;
  }
  if (patch.floorMode !== undefined && patch.floorMode !== "MULTIPLE") {
    if (patch.floors?.length) reject("floors", "只有多層模式使用樓層清單");
    data.floors = [];
  }
  if (patch.floorMode === "MULTIPLE") {
    if (patch.floorFrom != null || patch.floorTo != null) reject("floorMode", "多層使用樓層清單，不混用起訖");
    data.floorFrom = null; data.floorTo = null;
  } else if (patch.floorMode === "ENTIRE_BUILDING") {
    if (patch.floorFrom != null || patch.floorTo != null) reject("floorMode", "整棟不填單一樓層或範圍");
    data.floorFrom = null; data.floorTo = null;
  } else if (patch.floorMode === "SINGLE") {
    if (patch.floorTo != null) reject("floorTo", "單層不填範圍結束樓層");
    data.floorTo = null;
    if (current?.floorMode !== "SINGLE" && patch.floorFrom === undefined) data.floorFrom = null;
  } else if (patch.floorMode === "RANGE" && current?.floorMode !== "RANGE") {
    if (patch.floorFrom === undefined) data.floorFrom = null;
    if (patch.floorTo === undefined) data.floorTo = null;
  }
  if (patch.equipmentMode === "NONE") {
    if (patch.furniture?.length || patch.appliances?.length) reject("equipmentMode", "無設備不能同時勾選設備");
    data.furniture = []; data.appliances = []; data.equipmentConfirmedAt = new Date();
  } else if (patch.equipmentMode === "PRESENT") data.equipmentConfirmedAt = new Date();
  if (patch.balconyMode === "NONE") {
    if (patch.balconies != null && patch.balconies !== 0) reject("balconies", "無陽台不能同時填陽台數量");
    data.balconies = 0;
  } else if (patch.balconyMode === "SHARED") {
    if (patch.balconies != null) reject("balconies", "共用陽台不填專用數量");
    data.balconies = null;
  } else if (patch.balconyMode === "PRIVATE" && current?.balconyMode !== "PRIVATE" && patch.balconies === undefined) {
    data.balconies = null;
  }
  // Explicit three-state input must never collapse UNKNOWN/DISCUSS into false.
  for (const [statusKey, boolKey, yes, no] of [
    ["elevatorStatus", "hasElevator", "YES", "NO"], ["petPolicy", "petsAllowed", "ALLOWED", "NOT_ALLOWED"],
    ["cookingPolicy", "cookingAllowed", "ALLOWED", "NOT_ALLOWED"],
    ["carParkingStatus", "hasCarParking", "YES", "NO"], ["motorcycleParkingStatus", "hasMotorcycleParking", "YES", "NO"],
  ] as const) {
    const status = patch[statusKey], old = patch[boolKey];
    if (status !== undefined) {
      const value = status === yes ? true : status === no ? false : null;
      if (old !== undefined && old !== value) reject(statusKey, "新狀態與舊布林欄位不一致");
      Object.assign(data, { [boolKey]: value });
    } else if (old !== undefined) Object.assign(data, { [statusKey]: old === null ? null : old ? yes : no });
  }
  if (patch.equipmentItems !== undefined) {
    if (patch.equipmentMode !== undefined || patch.furniture !== undefined || patch.appliances !== undefined) reject("equipmentItems", "新版逐項設備與舊設備欄位請擇一提交");
    // Explicit replacement retires the old aggregate answer, not other content.
    data.equipmentMode = null; data.furniture = []; data.appliances = []; data.equipmentConfirmedAt = null;
  }
  if (patch.utilityCharges !== undefined) {
    for (const [kind, billingKey, descriptionKey] of [
      ["WATER", "waterBilling", "waterFeeDescription"], ["ELECTRICITY", "electricityBilling", "electricityFeeDescription"],
      ["GAS", "gasBilling", "gasFeeDescription"], ["INTERNET", "internetBilling", "internetFeeDescription"],
    ] as const) {
      if (patch[billingKey] !== undefined || patch[descriptionKey] !== undefined) reject("utilityCharges", "新版費率與舊水電欄位請擇一提交");
      const item = patch.utilityCharges.find(value => value.kind === kind);
      const mode = !item ? null : item.mode === "METERED" || item.mode === "FIXED" ? "SEPARATE" : item.mode;
      Object.assign(data, { [billingKey]: mode, [descriptionKey]: item?.description ?? null });
    }
  }
  if (patch.feeItems !== undefined) {
    if (["managementFeeMode", "managementFee", "carParkingFee", "motorcycleParkingFee"].some(key => Object.hasOwn(patch, key))) reject("feeItems", "新版費用明細與舊金額欄位請擇一提交");
    data.managementFeeMode = null; data.managementFee = null; data.carParkingFee = null; data.motorcycleParkingFee = null;
  }
  const merged = { ...current, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) };
  const touched = (...keys: string[]) => keys.some(key => Object.hasOwn(patch, key));
  if (patch.availableFrom != null && !validNewOccupancy(patch.availableFrom)) reject("availableFrom", "新指定日期須介於台灣今日至5年內");
  if (touched("floors", "floorMode", "totalFloors")) {
    if (merged.floorMode !== "MULTIPLE" && Array.isArray(merged.floors) && merged.floors.length) reject("floors", "只有多層模式使用樓層清單");
    if (typeof merged.totalFloors === "number" && Array.isArray(merged.floors) && merged.floors.some(n => n > Number(merged.totalFloors))) reject("floors", "所在樓層不得高於總樓層");
  }
  if (touched("depositMode", "deposit", "depositMonths")) {
    if (merged.depositMode === "FIXED" && merged.deposit === 0) reject("deposit", "固定押金須大於0；免押金請選免押金");
    if (merged.depositMode === "MONTHS" && merged.deposit != null) reject("deposit", "月數押金不使用固定金額");
    if ((merged.depositMode === "FIXED" || merged.depositMode === "NONE") && merged.depositMonths != null) reject("depositMonths", "此押金模式不使用月數");
    if (merged.depositMode === "NONE" && merged.deposit != null && merged.deposit !== 0) reject("deposit", "免押金不能同時有押金金額");
  }
  if (touched("managementFeeMode", "managementFee")) {
    if (merged.managementFeeMode === "SEPARATE" && merged.managementFee === 0) reject("managementFee", "固定另收管理費須大於0");
    if (merged.managementFeeMode === "INCLUDED" && merged.managementFee != null) reject("managementFee", "含租金不使用另計管理費");
    if (merged.managementFeeMode === "NONE" && merged.managementFee != null && merged.managementFee !== 0) reject("managementFee", "無管理費不能同時收費");
  }
  if (touched("occupancyMode", "availableFrom") && (merged.occupancyMode === "IMMEDIATE" || merged.occupancyMode === "NEGOTIABLE") && merged.availableFrom != null) reject("availableFrom", "隨時入住不使用指定日期");
  if (touched("equipmentMode", "furniture", "appliances") && merged.equipmentMode === "NONE"
    && ((Array.isArray(merged.furniture) && merged.furniture.length) || (Array.isArray(merged.appliances) && merged.appliances.length))) reject("equipmentMode", "無設備不能同時勾選設備");
  if (touched("floorMode", "floorFrom", "floorTo", "totalFloors")) {
    if (merged.floorMode === "RANGE" && typeof merged.floorFrom === "number" && typeof merged.floorTo === "number" && merged.floorFrom >= merged.floorTo) reject("floorTo", "結束樓層須大於開始樓層");
    if (typeof merged.totalFloors === "number") {
      for (const key of ["floorFrom", "floorTo"] as const) {
        const level = merged[key];
        if (typeof level === "number" && level > merged.totalFloors) reject(key, "所在樓層不得高於總樓層");
      }
    }
  }
  if (touched("balconyMode", "sharedSpaces") && merged.balconyMode === "NONE" && Array.isArray(merged.sharedSpaces) && merged.sharedSpaces.includes("BALCONY")) reject("sharedSpaces", "無陽台不能同時選共用陽台");
  if (touched("balconyMode", "balconies") && merged.balconyMode === "NONE" && merged.balconies != null && merged.balconies !== 0) reject("balconies", "無陽台不能同時填陽台數量");
  if (touched("balconyMode", "balconies") && merged.balconyMode === "SHARED" && merged.balconies != null) reject("balconies", "共用陽台不填專用數量");
  // Do not require missing publication fields or validate unrelated legacy content on a text edit.
  if (issues.length) throw new z.ZodError(issues);
  return data;
}

export function draftDto(row: Listing) {
  const editable = Object.fromEntries(Object.keys(draftPatchSchema.shape).filter(key => key !== "address" && !childFields.some(field => field === key)).map(key => {
    const value = row[key as keyof Listing];
    return [key, value instanceof Date ? value.toISOString().slice(0, 10)
      : key === "areaPings" || key === "depositMonths" ? value === null ? null : Number(value) : value];
  }));
  // Keep legacy area semantics visible; never relabel old registered area as usable area.
  return { id: row.id, revision: row.revision, publicId: row.publicId, publicationHistory: row.publicationHistory, status: row.status, moderationStatus: row.moderationStatus,
    ...editable, areaType: row.areaType, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function createDraftService(db: PrismaClient, creationPolicy: DraftCreationPolicy = unavailableDraftPolicy) {
  async function response(tx: Prisma.TransactionClient, row: Listing) {
    return { ...draftDto(row), ...await readDraftAddress(tx, row), ...await readDraftDetails(tx, row.id) };
  }
  async function authenticated(tx: Prisma.TransactionClient, auth: AuthenticatedSession) {
    // Shared per-account serialization for creation and account-state changes.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${auth.user.id} FOR UPDATE`;
    const session = await tx.authSession.findFirst({ where: { id: auth.sessionId, userId: auth.user.id, revokedAt: null,
      expiresAt: { gt: new Date() }, user: { isActive: true } }, select: { id: true } });
    if (!session) throw new DraftError(401, "UNAUTHENTICATED", "請先登入");
  }
  async function owned(tx: Prisma.TransactionClient, userId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${id} AND "publisherId" = ${userId} FOR UPDATE`;
    const row = await tx.listing.findFirst({ where: { id, publisherId: userId } });
    if (!row) throw new DraftError(404, "NOT_FOUND", "找不到草稿");
    if (row.status !== "DRAFT") throw new DraftError(409, "DRAFT_STATE_CONFLICT", "此刊登已不是草稿");
    return row;
  }
  return {
    async validation(auth: AuthenticatedSession, id: string) {
      return db.$transaction(async tx => {
        await authenticated(tx, auth);
        const row = await owned(tx, auth.user.id, id);
        const draft = await response(tx, row);
        const media = await tx.listingMedia.findMany({ where: { listingId: id },
          select: { isCover: true, asset: { select: { displayUrl: true, thumbnailUrl: true, gpsRemovedAt: true } } } });
        return checkConfirmedPublicationRules({ ...draft, media });
      });
    },
    async read(auth: AuthenticatedSession, id: string) {
      return db.$transaction(async tx => { await authenticated(tx, auth); return response(tx, await owned(tx, auth.user.id, id)); });
    },
    async patch(auth: AuthenticatedSession, id: string, input: unknown) {
      draftPatchSchema.parse(input);
      return db.$transaction(async tx => {
        await authenticated(tx, auth);
        const row = await owned(tx, auth.user.id, id);
        const data = dataForPatch(row, input);
        const patch = draftPatchSchema.parse(input);
        if (Object.keys(patch).length === 0) return response(tx, row);
        if (Object.keys(patch).length === 1 && patch.address && Object.keys(patch.address).length === 0) return response(tx, row);
        await patchDraftAddress(tx, row, patch.address);
        await patchDraftDetails(tx, row.id, patch);
        const result = await tx.listing.updateMany({ where: { id, publisherId: auth.user.id, status: "DRAFT" }, data: { ...data, revision: { increment: 1 } } });
        if (result.count !== 1) throw new DraftError(409, "DRAFT_STATE_CONFLICT", "草稿狀態已變更");
        return response(tx, await tx.listing.findUniqueOrThrow({ where: { id } }));
      });
    },
    async create(auth: AuthenticatedSession, input: unknown) {
      const data = dataForPatch(null, input);
      return db.$transaction(async tx => {
        await authenticated(tx, auth);
        const policy = await creationPolicy(tx, auth.user.id);
        if (!Number.isSafeInteger(policy.draftLimit) || policy.draftLimit < 0) throw new DraftError(503, "DRAFT_ENTITLEMENTS_UNAVAILABLE", "草稿新增資格尚未接妥");
        const drafts = await tx.listing.count({ where: { publisherId: auth.user.id, status: "DRAFT", moderationStatus: "NONE" } });
        if (drafts >= policy.draftLimit) throw new DraftError(409, "DRAFT_QUOTA_EXCEEDED", "草稿額度已滿，原有內容仍保留");
        const row = await tx.listing.create({ data: { ...data, publisherId: auth.user.id, status: "DRAFT" } as Prisma.ListingUncheckedCreateInput });
        const patch = draftPatchSchema.parse(input);
        await patchDraftAddress(tx, row, patch.address);
        await patchDraftDetails(tx, row.id, patch);
        return response(tx, row);
      });
    },
  };
}
