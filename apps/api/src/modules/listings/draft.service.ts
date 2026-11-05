import { z } from "zod";
import type { Listing, Prisma, PrismaClient } from "@prisma/client";
import type { AuthenticatedSession } from "../auth/require-auth.js";
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

function dataForPatch(current: Listing | null, input: unknown): Prisma.ListingUncheckedUpdateInput {
  const patch = draftPatchSchema.parse(input);
  const { address: _address, ...scalars } = patch;
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
  if (patch.occupancyMode === "IMMEDIATE") {
    if (patch.availableFrom != null) reject("availableFrom", "隨時入住不使用指定日期");
    data.availableFrom = null;
  }
  if (patch.floorMode === "ENTIRE_BUILDING") {
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
  const merged = { ...current, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) };
  const touched = (...keys: string[]) => keys.some(key => Object.hasOwn(patch, key));
  if (touched("depositMode", "deposit", "depositMonths")) {
    if (merged.depositMode === "MONTHS" && merged.deposit != null) reject("deposit", "月數押金不使用固定金額");
    if ((merged.depositMode === "FIXED" || merged.depositMode === "NONE") && merged.depositMonths != null) reject("depositMonths", "此押金模式不使用月數");
    if (merged.depositMode === "NONE" && merged.deposit != null && merged.deposit !== 0) reject("deposit", "免押金不能同時有押金金額");
  }
  if (touched("managementFeeMode", "managementFee")) {
    if (merged.managementFeeMode === "INCLUDED" && merged.managementFee != null) reject("managementFee", "含租金不使用另計管理費");
    if (merged.managementFeeMode === "NONE" && merged.managementFee != null && merged.managementFee !== 0) reject("managementFee", "無管理費不能同時收費");
  }
  if (touched("occupancyMode", "availableFrom") && merged.occupancyMode === "IMMEDIATE" && merged.availableFrom != null) reject("availableFrom", "隨時入住不使用指定日期");
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

function draftDto(row: Listing) {
  const editable = Object.fromEntries(Object.keys(draftPatchSchema.shape).filter(key => key !== "address").map(key => {
    const value = row[key as keyof Listing];
    return [key, value instanceof Date ? value.toISOString().slice(0, 10)
      : key === "areaPings" || key === "depositMonths" ? value === null ? null : Number(value) : value];
  }));
  // Keep legacy area semantics visible; never relabel old registered area as usable area.
  return { id: row.id, status: row.status, moderationStatus: row.moderationStatus,
    ...editable, areaType: row.areaType, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function createDraftService(db: PrismaClient, creationPolicy: DraftCreationPolicy = unavailableDraftPolicy) {
  async function response(tx: Prisma.TransactionClient, row: Listing) {
    return { ...draftDto(row), ...await readDraftAddress(tx, row) };
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
        const result = await tx.listing.updateMany({ where: { id, publisherId: auth.user.id, status: "DRAFT" }, data });
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
        const drafts = await tx.listing.count({ where: { publisherId: auth.user.id, status: "DRAFT" } });
        if (drafts >= policy.draftLimit) throw new DraftError(409, "DRAFT_QUOTA_EXCEEDED", "草稿額度已滿，原有內容仍保留");
        const row = await tx.listing.create({ data: { ...data, publisherId: auth.user.id, status: "DRAFT" } as Prisma.ListingUncheckedCreateInput });
        await patchDraftAddress(tx, row, draftPatchSchema.parse(input).address);
        return response(tx, row);
      });
    },
  };
}
