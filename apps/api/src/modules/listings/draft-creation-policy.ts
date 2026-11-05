import { resolveCurrentEntitlement } from "../entitlements/entitlement.service.js";
import { DraftError, type DraftCreationPolicy } from "./draft.service.js";

/** Revised C01 (2026-11-05). Caller holds the account row lock.
 * Historical archive overflow never blocks an otherwise eligible website draft.
 * Upload capacity is checked by the image service; blank text drafts consume no image bytes.
 * Bot/import must additionally enforce their tool rights at their own entry points.
 */
export const resolveDraftCreationPolicy: DraftCreationPolicy = async (tx, userId) => {
  const entitlement = await resolveCurrentEntitlement(tx, userId);
  if (entitlement.status !== "READY") throw new DraftError(503, "DRAFT_ENTITLEMENTS_UNAVAILABLE", "會員資格需核對後才能新增草稿");
  return { draftLimit: entitlement.quotas.draftListings };
};
