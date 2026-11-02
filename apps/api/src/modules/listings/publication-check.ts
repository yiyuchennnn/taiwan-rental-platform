import type { BillingMethod, ModerationStatus, Prisma } from "@prisma/client";
import { residentialRentalTypes } from "./listing-options.js";
import { fitsPositiveDecimal12_4 } from "./storage-numbers.js";

/** Confirmed rules only. This report never authorizes a publication transition. */
export interface PublicationCandidate {
  rentalType: string | null;
  areaPings: number | Prisma.Decimal | null;
  moderationStatus: ModerationStatus;
  contactPhone: string | null;
  contactEmail: string | null;
  contactLine: string | null;
  waterBilling: BillingMethod | null;
  electricityBilling: BillingMethod | null;
  gasBilling: BillingMethod | null;
  internetBilling: BillingMethod | null;
  media: ReadonlyArray<{
    isCover: boolean;
    asset: {
      displayUrl: string;
      thumbnailUrl: string;
      gpsRemovedAt: Date | null;
    } | null;
  }>;
}

export interface PublicationIssue {
  code: string;
  path: string;
  rule: "02-06" | "02-09";
}

// Missing specifications and checks owned by future services are explicit.
export const outstandingPublicationChecks = [
  "BUILDING_TYPE_OPTIONS_AND_REQUIRED_FIELD_MATRIX",
  "CONDITIONAL_FEE_AND_CONTACT_REQUIREMENTS",
  "ORIGINAL_IMAGE_FORMAT_SIZE_AND_USAGE_RIGHTS",
  "AUTHENTICATED_OWNER_AND_PUBLISHER_ELIGIBILITY",
  "CURRENT_STATE_AND_ATOMIC_PUBLIC_QUOTA",
  "ADDRESS_LOCATION_GROUPING_AND_PUBLIC_PRIVACY",
] as const;

export function checkConfirmedPublicationRules(candidate: PublicationCandidate) {
  const issues: PublicationIssue[] = [];
  const add = (code: string, path: string, rule: PublicationIssue["rule"] = "02-06") =>
    issues.push({ code, path, rule });

  if (!residentialRentalTypes.some(option => option.value === candidate.rentalType)) {
    add("RESIDENTIAL_RENTAL_TYPE_REQUIRED", "rentalType");
  }
  if (candidate.areaPings === null) {
    add("AREA_REQUIRED", "areaPings");
  } else if (!Number.isFinite(Number(candidate.areaPings)) || Number(candidate.areaPings) <= 0) {
    add("AREA_MUST_BE_POSITIVE", "areaPings");
  } else if (!fitsPositiveDecimal12_4(candidate.areaPings)) {
    add("AREA_EXCEEDS_STORAGE_PRECISION", "areaPings");
  }

  if (candidate.moderationStatus !== "NONE") {
    add("PLATFORM_RESTRICTED", "moderationStatus", "02-09");
  }
  if (![candidate.contactPhone, candidate.contactEmail, candidate.contactLine]
    .some(value => value !== null && value.trim().length > 0)) {
    add("CONTACT_CHANNEL_REQUIRED", "contact");
  }
  for (const field of ["waterBilling", "electricityBilling", "gasBilling", "internetBilling"] as const) {
    if (candidate[field] === null) add("BILLING_METHOD_REQUIRED", field);
  }
  if (candidate.media.length < 3 || candidate.media.length > 30) {
    add("PHOTO_COUNT_OUT_OF_RANGE", "media");
  }
  if (candidate.media.filter(photo => photo.isCover).length !== 1) {
    add("EXACTLY_ONE_COVER_REQUIRED", "media");
  }
  candidate.media.forEach((photo, index) => {
    const asset = photo.asset;
    if (!asset || !asset.displayUrl.trim() || !asset.thumbnailUrl.trim() || !asset.gpsRemovedAt) {
      add("PHOTO_PROCESSING_UNCONFIRMED", `media.${index}.asset`);
    }
  });

  return {
    confirmedRulesPassed: issues.length === 0,
    issues,
    outstandingChecks: outstandingPublicationChecks,
  };
}
