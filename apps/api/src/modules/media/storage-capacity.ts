// Pure calculation over trustworthy server facts, not a plan quota source.
// null means unknown, never unlimited. Include CLEANUP in usedBytes until remote
// deletion is confirmed; include PENDING in reservedBytes, without double counting.
export interface StorageCapacityFacts {
  limitBytes: bigint | null;
  usedBytes: bigint | null;
  reservedBytes: bigint | null;
  incomingBytes: bigint;
}
export function assessStorageCapacity(facts: StorageCapacityFacts) {
  const { limitBytes, usedBytes, reservedBytes, incomingBytes } = facts;
  if (incomingBytes < 0n || [limitBytes, usedBytes, reservedBytes].some(x => x !== null && x < 0n)) throw new Error("Negative storage fact");
  if (limitBytes === null || usedBytes === null || reservedBytes === null) {
    return { state: "UNKNOWN" as const, allowed: false, warning: false };
  }
  const allocated = usedBytes + reservedBytes, projected = allocated + incomingBytes;
  const full = allocated >= limitBytes;
  const allowed = projected <= limitBytes && (incomingBytes === 0n || !full);
  return { state: "KNOWN" as const, allowed, warning: limitBytes > 0n && projected * 100n >= limitBytes * 80n,
    full, allocatedBytes: allocated, projectedBytes: projected, remainingBytes: allocated < limitBytes ? limitBytes - allocated : 0n };
}

/** Settlement arithmetic only. Not authorization to replace, transfer or delete.
 * Callers must persist U0 before the operation and serialize ledger mutations.
 * D excludes estimated, pending, failed and still-referenced deletions.
 */
export function settledUsageFromBaseline(input: {
  baselineUsedBytes: bigint;
  confirmedDeletedBytes: bigint;
  formalAddedBytes: bigint;
}): bigint {
  const { baselineUsedBytes: u0, confirmedDeletedBytes: d, formalAddedBytes: n } = input;
  if (u0 < 0n || d < 0n || n < 0n || d > u0) throw new Error("Invalid storage settlement facts");
  return u0 - d + n;
}
