import { expect, test } from "vitest";
import { visibleLength, taiwanDate, validNewOccupancy, textField } from "../src/modules/listings/input-rules.js";

test("visible character count treats composed emoji as one and newline as one", () => {
  expect(visibleLength("👨‍👩‍👧‍👦e\u0301\n屋")).toBe(4);
  expect(textField(1).parse(" 👨‍👩‍👧‍👦 ")).toBe("👨‍👩‍👧‍👦");
  expect(() => textField(1).parse("屋屋")).toThrow();
});
test("occupancy uses Taiwan calendar boundaries and clamps leap-day five-year limit", () => {
  const at = new Date("2024-02-28T16:01:00Z");
  expect(taiwanDate(at)).toBe("2024-02-29");
  expect(validNewOccupancy("2024-02-28", at)).toBe(false);
  expect(validNewOccupancy("2024-02-29", at)).toBe(true);
  expect(validNewOccupancy("2029-02-28", at)).toBe(true);
  expect(validNewOccupancy("2029-03-01", at)).toBe(false);
});
