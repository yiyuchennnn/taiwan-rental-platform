import { describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { residentialRentalTypes } from "../src/modules/listings/listing-options.js";
import { checkConfirmedPublicationRules, type PublicationCandidate } from "../src/modules/listings/publication-check.js";

function candidate(): PublicationCandidate {
  return {
    rentalType: "SUITE", areaPings: 8.5,
    moderationStatus: "NONE", contactPhone: null, contactEmail: "contact@example.test", contactLine: null,
    waterBilling: "INCLUDED", electricityBilling: "BY_BILL", gasBilling: "NOT_PROVIDED", internetBilling: "SEPARATE",
    media: Array.from({ length: 3 }, (_, index) => ({ isCover: index === 0,
      asset: { displayUrl: "https://example.test/display", thumbnailUrl: "https://example.test/thumb", gpsRemovedAt: new Date() } })),
  };
}
const codes = (value: PublicationCandidate) => checkConfirmedPublicationRules(value).issues.map(issue => issue.code);

describe("confirmed publication rules (not publication authorization)", () => {
  test.each(residentialRentalTypes)("accepts confirmed residential type $label", option => {
    const value = candidate(); value.rentalType = option.value;
    expect(checkConfirmedPublicationRules(value).confirmedRulesPassed).toBe(true);
  });
  test.each([null, "", "SHOP", "OFFICE", "FACTORY", "PARKING", "INDEPENDENT_SUITE", "PARTITIONED_SUITE"])("does not publish unsupported or legacy type %s without review", type => {
    const value = candidate(); value.rentalType = type;
    expect(codes(value)).toContain("RESIDENTIAL_RENTAL_TYPE_REQUIRED");
  });
  test.each([null, 0, -1, NaN, Infinity])("rejects missing or invalid area %s", area => {
    const value = candidate(); value.areaPings = area;
    expect(checkConfirmedPublicationRules(value).issues.some(issue => issue.path === "areaPings")).toBe(true);
  });
  test("accepts estimated fractional pings and Prisma Decimal without area type or source", () => {
    const value = candidate(); value.areaPings = new Prisma.Decimal("8.125");
    expect(checkConfirmedPublicationRules(value).confirmedRulesPassed).toBe(true);
  });
  test.each([0.00001, 1.23456, 100000000, new Prisma.Decimal("99999999.99991")])("does not silently round or overflow area %s", area => {
    const value = candidate(); value.areaPings = area;
    expect(codes(value)).toContain("AREA_EXCEEDS_STORAGE_PRECISION");
  });
  test.each([0.0001, new Prisma.Decimal("99999999.9999")])("accepts exact area storage boundary %s", area => {
    const value = candidate(); value.areaPings = area;
    expect(checkConfirmedPublicationRules(value).confirmedRulesPassed).toBe(true);
  });
  test.each([3, 30])("accepts the confirmed photo boundary %i and keeps outstanding checks", count => {
    const value = candidate();
    value.media = Array.from({ length: count }, (_, index) => ({ ...value.media[0]!, isCover: index === 0 }));
    const result = checkConfirmedPublicationRules(value);
    expect(result.confirmedRulesPassed).toBe(true);
    expect(result.outstandingChecks).toContain("CURRENT_STATE_AND_ATOMIC_PUBLIC_QUOTA");
    expect(result).not.toHaveProperty("canPublish");
  });
  test.each([0, 2, 31])("rejects %i photos", count => {
    const value = candidate(); value.media = Array.from({ length: count }, () => value.media[0]!);
    expect(codes(value)).toContain("PHOTO_COUNT_OUT_OF_RANGE");
  });
  test.each([0, 2])("rejects %i covers", count => {
    const value = candidate(); value.media = value.media.map((photo, index) => ({ ...photo, isCover: index < count }));
    expect(codes(value)).toContain("EXACTLY_ONE_COVER_REQUIRED");
  });
  test.each(["SUSPENDED", "BLOCKED"] as const)("preserves platform restriction %s", state => {
    const value = candidate(); value.moderationStatus = state;
    expect(codes(value)).toContain("PLATFORM_RESTRICTED");
  });
  test("blank contact channels do not count as contact information", () => {
    const value = candidate(); value.contactEmail = " \n ";
    expect(codes(value)).toContain("CONTACT_CHANNEL_REQUIRED");
    value.contactLine = "rental-contact";
    expect(codes(value)).not.toContain("CONTACT_CHANNEL_REQUIRED");
  });
  test("does not infer missing billing methods", () => {
    const value = candidate(); value.waterBilling = null; value.gasBilling = null;
    expect(checkConfirmedPublicationRules(value).issues.filter(issue => issue.code === "BILLING_METHOD_REQUIRED").map(issue => issue.path))
      .toEqual(["waterBilling", "gasBilling"]);
  });
  test("legacy URLs and unprocessed assets cannot prove image readiness", () => {
    const value = candidate();
    value.media = [{ isCover: true, asset: null }, { isCover: false, asset: { ...value.media[0]!.asset!, gpsRemovedAt: null } }, value.media[2]!];
    expect(checkConfirmedPublicationRules(value).issues.filter(issue => issue.code === "PHOTO_PROCESSING_UNCONFIRMED").map(issue => issue.path))
      .toEqual(["media.0.asset", "media.1.asset"]);
  });
  test("does not mutate the candidate or expose private contact values in the report", () => {
    const value = candidate(); const before = structuredClone(value);
    expect(JSON.stringify(checkConfirmedPublicationRules(value))).not.toContain(value.contactEmail);
    expect(value).toEqual(before);
  });
});
