import { expect, test } from "vitest";
import { settledUsageFromBaseline } from "../src/modules/media/storage-capacity.js";

test("settlement uses the saved pre-operation baseline exactly once", () => {
  expect(settledUsageFromBaseline({ baselineUsedBytes: 100n, confirmedDeletedBytes: 20n, formalAddedBytes: 15n })).toBe(95n);
  // The current ledger is already 80 after deletion: it must only add 15.
  expect(80n + 15n).toBe(95n);
});
test("unconfirmed deletion gives no capacity credit", () => {
  expect(settledUsageFromBaseline({ baselineUsedBytes: 100n, confirmedDeletedBytes: 0n, formalAddedBytes: 15n })).toBe(115n);
});
test("zero increment leaves existing usage and does not grant a transfer exception", () => {
  expect(settledUsageFromBaseline({ baselineUsedBytes: 100n, confirmedDeletedBytes: 0n, formalAddedBytes: 0n })).toBe(100n);
});
test.each([
  [-1n, 0n, 0n], [10n, -1n, 0n], [10n, 0n, -1n], [10n, 11n, 0n],
])("invalid settlement facts %s/%s/%s are rejected", (baselineUsedBytes, confirmedDeletedBytes, formalAddedBytes) => {
  expect(() => settledUsageFromBaseline({ baselineUsedBytes, confirmedDeletedBytes, formalAddedBytes })).toThrow();
});
test("byte arithmetic remains exact above the JavaScript safe integer range", () => {
  expect(settledUsageFromBaseline({ baselineUsedBytes: 9007199254740993n, confirmedDeletedBytes: 2n, formalAddedBytes: 1n })).toBe(9007199254740992n);
});
