import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { draftPatchSchema } from "./draft.schema.js";

type Patch = z.infer<typeof draftPatchSchema>;
export const childFields = ["utilityCharges", "equipmentItems", "feeItems"] as const;

/** Replace only explicitly submitted collections. Caller holds owner/listing locks.
 * No client-controlled foreign keys, verification fields or cross-listing writes.
 */
export async function patchDraftDetails(tx: Prisma.TransactionClient, listingId: string, patch: Patch) {
  const conflicts: z.core.$ZodIssue[] = [];
  const reject = (path: string) => conflicts.push({ code: "custom", path: [path], message: "已有新版明細，請使用新版集合更新，不混用舊欄位" });
  if (patch.equipmentItems === undefined && ["equipmentMode", "furniture", "appliances"].some(key => Object.hasOwn(patch, key))
    && await tx.listingEquipmentItem.count({ where: { listingId } })) reject("equipmentItems");
  if (patch.utilityCharges === undefined && ["waterBilling", "waterFeeDescription", "electricityBilling", "electricityFeeDescription", "gasBilling", "gasFeeDescription", "internetBilling", "internetFeeDescription"].some(key => Object.hasOwn(patch, key))
    && await tx.listingUtilityCharge.count({ where: { listingId } })) reject("utilityCharges");
  if (patch.feeItems === undefined && ["managementFeeMode", "managementFee", "carParkingFee", "motorcycleParkingFee"].some(key => Object.hasOwn(patch, key))
    && await tx.listingFeeItem.count({ where: { listingId } })) reject("feeItems");
  if (conflicts.length) throw new z.ZodError(conflicts);
  if (patch.utilityCharges !== undefined) {
    await tx.listingUtilityCharge.deleteMany({ where: { listingId } });
    if (patch.utilityCharges.length) await tx.listingUtilityCharge.createMany({ data: patch.utilityCharges.map(item => ({ ...item, listingId })) });
  }
  if (patch.equipmentItems !== undefined) {
    await tx.listingEquipmentItem.deleteMany({ where: { listingId } });
    if (patch.equipmentItems.length) await tx.listingEquipmentItem.createMany({ data: patch.equipmentItems.map(item => ({ ...item, listingId })) });
  }
  if (patch.feeItems !== undefined) {
    await tx.listingFeeItem.deleteMany({ where: { listingId } });
    if (patch.feeItems.length) await tx.listingFeeItem.createMany({ data: patch.feeItems.map(item => ({ ...item, listingId })) });
  }
}
export async function readDraftDetails(tx: Prisma.TransactionClient, listingId: string) {
  const utilities = await tx.listingUtilityCharge.findMany({ where: { listingId }, orderBy: { kind: "asc" },
    select: { kind: true, mode: true, amount: true, rate: true, unit: true, frequency: true, source: true, description: true, variableRate: true } });
  const equipmentItems = await tx.listingEquipmentItem.findMany({ where: { listingId }, orderBy: { code: "asc" }, select: { code: true, status: true } });
  const feeItems = await tx.listingFeeItem.findMany({ where: { listingId }, orderBy: { id: "asc" },
    select: { kind: true, label: true, mode: true, amount: true, frequency: true, required: true, description: true, percentage: true, paymentTiming: true, payee: true } });
  return { utilityCharges: utilities.map(item => ({ ...item, rate: item.rate === null ? null : Number(item.rate) })), equipmentItems, feeItems: feeItems.map(item => ({ ...item, percentage: item.percentage === null ? null : Number(item.percentage) })) };
}
