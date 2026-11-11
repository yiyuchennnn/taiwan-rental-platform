import type { Listing, Prisma } from "@prisma/client";
/** Trusted persisted facts only; no network calls or request-provided approval flags.
 * No runtime reader exists until formal verification/lifecycle services are ready.
 */
export type PublicationEvidenceReader = (
  tx: Prisma.TransactionClient,
  row: Listing,
  at: Date,
) => Promise<{
  revision: number;
  sourceReference: string;
  validUntil: Date | null;
  checks: {
    identity: true;
    contactControl: true;
    address: true;
    privacy: true;
    duplicateUnit: true;
    imageRightsAndAssets: true;
    capacityAccounting: true;
    accountAndEntitlementLifecycle: true;
  };
} | null>;
export function evidenceMatches(
  proof: Awaited<ReturnType<PublicationEvidenceReader>>,
  row: Listing,
  at: Date,
) {
  return Boolean(
    proof &&
      proof.revision === row.revision &&
      proof.sourceReference?.trim() &&
      (proof.validUntil === null ||
        (proof.validUntil instanceof Date &&
          Number.isFinite(proof.validUntil.getTime()) &&
          proof.validUntil > at)) &&
      proof.checks &&
      [
        "identity",
        "contactControl",
        "address",
        "privacy",
        "duplicateUnit",
        "imageRightsAndAssets",
        "capacityAccounting",
        "accountAndEntitlementLifecycle",
      ].every((k) => proof.checks[k as keyof typeof proof.checks] === true),
  );
}
