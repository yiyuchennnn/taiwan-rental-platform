import { Prisma } from "@prisma/client";

/** Technical DECIMAL(12,4) capacity; no rounding and no business threshold. */
export function fitsPositiveDecimal12_4(value: number | Prisma.Decimal): boolean {
  const decimal = new Prisma.Decimal(value);
  return decimal.isFinite() && decimal.gt(0) && decimal.decimalPlaces() <= 4 && decimal.lt("100000000");
}
