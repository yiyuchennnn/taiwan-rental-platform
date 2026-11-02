import { resolveCurrentEntitlement } from "../entitlements/entitlement.service.js";
import { DraftError, type DraftCreationPolicy } from "./draft.service.js";

/** C01 confirmed: account-row lock is already held by createDraftService. */
export const resolveDraftCreationPolicy: DraftCreationPolicy = async (tx, userId) => {
  const entitlement = await resolveCurrentEntitlement(tx, userId);
  if (entitlement.status !== "READY") {
    throw new DraftError(503, "DRAFT_ENTITLEMENTS_UNAVAILABLE", "會員資格需核對後才能新增草稿");
  }
  // The historical UNPUBLISHED meaning was explicitly left unresolved in 02.
  const legacy = await tx.listing.count({ where: { publisherId: userId, status: "UNPUBLISHED" } });
  if (legacy > 0) throw new DraftError(503, "LEGACY_LISTING_STATE_UNRESOLVED", "舊刊登狀態需核對後才能新增草稿");
  const archived = await tx.listing.count({ where: { publisherId: userId, status: "ARCHIVED" } });
  return {
    draftLimit: entitlement.quotas.draftListings,
    // Exactly full is permitted; C01 blocks only overflow. Draft quota is checked separately.
    archiveCreation: archived > entitlement.quotas.archivedListings ? "BLOCKED" : "ALLOWED",
  };
};
