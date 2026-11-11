import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { feeItemSchema, utilityChargeSchema } from './input-rules.js';

type Fee = z.infer<typeof feeItemSchema>;
type Utility = z.infer<typeof utilityChargeSchema>;
// R03: sum exact fractions before rounding once. Not subscription accounting.
export function summarizeRentalFees(rent: number, fees: Fee[], utilities: Utility[], deposit: {
  mode: string | null; amount: number | null; months: number | null;
}) {
  const d = (value: number) => new Prisma.Decimal(value);
  const round = (value: Prisma.Decimal) => value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  let twelfths = d(rent).mul(12);
  let complete = true;
  const oneTime: { index: number; amount: number | null; paymentTiming: string | null; payee: string | null }[] = [];
  const optional: number[] = [];
  const oneTimeUtilities: { kind: string; amount: number }[] = [];
  const usage: string[] = [];
  fees.forEach((fee, index) => {
    if (!fee.required) { optional.push(index); return; }
    if (fee.mode === 'NONE' || fee.mode === 'INCLUDED') return;
    if (fee.mode === 'USAGE') { usage.push(`feeItems.${index}`); return; }
    const amount = fee.mode === 'PERCENT' ? fee.percentage == null ? null : d(rent).mul(fee.percentage).div(100)
      : fee.amount == null ? null : d(fee.amount);
    if (!amount || !fee.frequency) { complete = false; return; }
    if (fee.frequency === 'ONCE') oneTime.push({ index, amount: round(amount), paymentTiming: fee.paymentTiming ?? null, payee: fee.payee ?? null });
    else twelfths = twelfths.add(amount.mul(fee.frequency === 'MONTHLY' ? 12 : fee.frequency === 'QUARTERLY' ? 4 : 1));
  });
  utilities.forEach(item => {
    if (item.mode === 'BY_BILL' || item.mode === 'METERED') usage.push(`utilityCharges.${item.kind}`);
    if (item.mode !== 'FIXED') return;
    if (item.amount == null || !item.frequency) { complete = false; return; }
    // Fixed utilities are compulsory rental charges; once fees stay separate.
    if (item.frequency === 'ONCE') oneTimeUtilities.push({ kind: item.kind, amount: item.amount });
    else twelfths = twelfths.add(d(item.amount).mul(item.frequency === 'MONTHLY' ? 12 : item.frequency === 'QUARTERLY' ? 4 : 1));
  });
  const average = twelfths.div(12);
  const depositAmount = deposit.mode === 'NONE' ? 0 : deposit.mode === 'FIXED' ? deposit.amount
    : deposit.mode === 'MONTHS' && deposit.months != null ? round(d(rent).mul(deposit.months)) : null;
  return { rent, fixedMonthlyTotal: complete ? round(average) : null,
    approximate: complete && !average.isInteger(), usageCharges: usage, optionalFeeIndexes: optional,
    oneTimeFees: oneTime, oneTimeUtilities, depositAmount, guaranteedMoveInTotal: null };
}
