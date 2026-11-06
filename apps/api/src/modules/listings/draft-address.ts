import { z } from "zod";
import { textField } from "./input-rules.js";
import type { Listing, Prisma } from "@prisma/client";

export const draftAddressPatchSchema = z.object({
  cityCode: z.string().trim().min(1).nullable(),
  districtCode: z.string().trim().min(1).nullable(),
  addressLine: textField(200).nullable(),
  roomNumber: textField(50).nullable(),
  communityName: textField(100).nullable(),
  buildingNumber: textField(50).nullable(),
  roomIdentifierSource: z.enum(["OFFICIAL", "CUSTOM"]).nullable(),
  addressKind: z.enum(["STANDARD", "NONSTANDARD"]).nullable(),
}).partial().strict();

const emptyAddress = () => ({ cityCode: null, districtCode: null, addressLine: null, roomNumber: null, communityName: null, buildingNumber: null, roomIdentifierSource: null, addressKind: null });
const propertyAddressSelect = { cityCode: true, districtCode: true, addressLine: true, roomNumber: true, communityName: true } as const;

export async function readDraftAddress(tx: Prisma.TransactionClient, listing: Listing) {
  const addressSelect = { ...propertyAddressSelect, buildingNumber: true, roomIdentifierSource: true, addressKind: true } as const;
  const copy = await tx.draftAddress.findUnique({ where: { listingId: listing.id }, select: addressSelect });
  if (copy) return { address: copy, addressSource: "DRAFT_COPY" as const };
  if (listing.propertyId) {
    const original = await tx.property.findUniqueOrThrow({ where: { id: listing.propertyId }, select: propertyAddressSelect });
    return { address: { ...emptyAddress(), ...original }, addressSource: "LINKED_PROPERTY" as const };
  }
  return { address: null, addressSource: "NONE" as const };
}

/** Caller holds listing lock and has checked ownership and DRAFT state. */
export async function patchDraftAddress(tx: Prisma.TransactionClient, listing: Listing, input: unknown) {
  if (input === undefined) return;
  const patch = input === null ? null : draftAddressPatchSchema.parse(input);
  if (patch && Object.keys(patch).length === 0) return;
  const original = await readDraftAddress(tx, listing);
  const merged = patch === null ? emptyAddress() : { ...(original.address ?? emptyAddress()), ...patch };
  if (patch && Object.hasOwn(patch, "cityCode") && patch.cityCode !== original.address?.cityCode && !Object.hasOwn(patch, "districtCode")) {
    // Do not reinterpret a previous district code as a new city's district.
    merged.districtCode = null;
  }
  const issues: z.core.$ZodIssue[] = [];
  if (merged.cityCode !== null && !await tx.city.findUnique({ where: { code: merged.cityCode }, select: { code: true } })) {
    issues.push({ code: "custom", path: ["address", "cityCode"], message: "縣市代碼不存在" });
  }
  if (merged.districtCode !== null) {
    const district = merged.cityCode === null
      ? await tx.district.findFirst({ where: { code: merged.districtCode }, select: { code: true } })
      : await tx.district.findUnique({ where: { cityCode_code: { cityCode: merged.cityCode, code: merged.districtCode } }, select: { code: true } });
    if (!district) issues.push({ code: "custom", path: ["address", "districtCode"], message: "行政區代碼不存在或不屬於所選縣市" });
  }
  if (issues.length) throw new z.ZodError(issues);
  await tx.draftAddress.upsert({ where: { listingId: listing.id }, create: { listingId: listing.id, ...merged }, update: merged });
}
