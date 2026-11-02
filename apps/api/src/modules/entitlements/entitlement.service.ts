import type { Prisma } from "@prisma/client";
import { planCatalog, type Plan } from "./plan-catalog.js";

/** Reads trusted facts only. Never accepts a plan from an HTTP request or grants rights. */
export async function resolveCurrentEntitlement(tx: Prisma.TransactionClient, userId: string, at = new Date()) {
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid entitlement evaluation time");
  const account = await tx.entitlementAccount.findUnique({ where: { userId } });
  if (!account || account.verifiedAt === null || account.verifiedAt > at) {
    return { status: "UNAVAILABLE" as const, reason: "ACCOUNT_NOT_RECONCILED" as const };
  }
  const periods = await tx.entitlementPeriod.findMany({ where: {
    userId, startsAt: { lte: at }, endsAt: { gt: at }, revokedAt: null,
  } });
  if (periods.some(period => period.confirmedAt === null || period.confirmedAt > at)) {
    return { status: "UNAVAILABLE" as const, reason: "SOURCE_NOT_CONFIRMED" as const };
  }
  const plans = new Set(periods.map(period => period.plan));
  if (plans.size > 1) {
    // C06: no silent priority or addition of overlapping, different-grade rights.
    return { status: "UNAVAILABLE" as const, reason: "OVERLAPPING_DIFFERENT_PLANS" as const };
  }
  const plan: Plan = periods[0]?.plan ?? "FREE";
  return { status: "READY" as const, plan, quotas: planCatalog[plan].quotas };
}
