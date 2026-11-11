import { z } from "zod";
import { draftPatchSchema } from "./draft.schema.js";
export const revisionSchema = z.number().int().min(1).max(2147483646);
// Current writes use explicit selected levels, never expand a historical RANGE.
export const currentWorkPatchSchema = draftPatchSchema.extend({
  floorMode: z
    .enum(["SINGLE", "MULTIPLE", "ENTIRE_BUILDING"])
    .nullable()
    .optional(),
  floorTo: z.null().optional(),
  carParkingType: z.enum(["FLAT", "MECHANICAL", "OTHER"]).nullable().optional(),
  motorcycleParkingType: z
    .enum(["FLAT", "MECHANICAL", "OTHER"])
    .nullable()
    .optional(),
});
export const createContentSchema = z
  .object({ draft: currentWorkPatchSchema })
  .strict();
export const saveContentSchema = z
  .object({ expectedRevision: revisionSchema, patch: currentWorkPatchSchema })
  .strict();
export const previewContentSchema = z
  .object({ expectedRevision: revisionSchema })
  .strict();
export const publishContentSchema = z
  .object({
    expectedRevision: revisionSchema,
    previewId: z.uuid(),
    confirmed: z.literal(true),
  })
  .strict();
export const transitionContentSchema = z
  .object({
    expectedRevision: revisionSchema,
    action: z.enum(["archive", "mark-rented", "to-draft", "trash", "restore"]),
    confirmed: z.literal(true),
  })
  .strict();
export const privateListSchema = z
  .object({
    status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED", "TRASHED"]).optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
