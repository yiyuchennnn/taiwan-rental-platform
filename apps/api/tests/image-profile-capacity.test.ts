import { expect, test } from "vitest";
import sharp from "sharp";
import { provisionalImageOptions, provisionalImageProfile } from "../src/modules/media/image-profile.js";
import { processImage } from "../src/modules/media/process-image.js";
import { assessStorageCapacity } from "../src/modules/media/storage-capacity.js";

test("provisional profile is explicit and does not enlarge a small input", async () => {
  expect(provisionalImageProfile).toEqual({ maxInputBytes: 10000000, displayMaxEdge: 1920, thumbnailMaxEdge: 480, quality: 82 });
  const input = await sharp({ create: { width: 100, height: 50, channels: 3, background: "orange" } }).png().toBuffer();
  const result = await processImage(input, provisionalImageOptions({ maxInputPixels: 100000, timeoutSeconds: 5 }));
  expect([result.display.width, result.display.height, result.thumbnail.width, result.thumbnail.height]).toEqual([100, 50, 100, 50]);
});
test("provisional profile produces the approved display and thumbnail bounds", async () => {
  const input = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "blue" } }).png().toBuffer();
  const result = await processImage(input, provisionalImageOptions({ maxInputPixels: 4000000, timeoutSeconds: 5 }));
  expect([result.display.width, result.display.height]).toEqual([1920, 960]);
  expect([result.thumbnail.width, result.thumbnail.height]).toEqual([480, 240]);
});
test.each(["limitBytes", "usedBytes", "reservedBytes"] as const)("unknown %s never permits an upload", key => {
  expect(assessStorageCapacity({ limitBytes: 100n, usedBytes: 0n, reservedBytes: 0n, incomingBytes: 1n, [key]: null })).toMatchObject({ state: "UNKNOWN", allowed: false });
});
test("80 percent warning uses exact integer comparison, including pending bytes", () => {
  expect(assessStorageCapacity({ limitBytes: 100n, usedBytes: 70n, reservedBytes: 8n, incomingBytes: 1n })).toMatchObject({ allowed: true, warning: false });
  expect(assessStorageCapacity({ limitBytes: 100n, usedBytes: 70n, reservedBytes: 9n, incomingBytes: 1n })).toMatchObject({ allowed: true, warning: true });
});
test("last bytes fit but another upload at 100 percent is blocked", () => {
  expect(assessStorageCapacity({ limitBytes: 100n, usedBytes: 90n, reservedBytes: 5n, incomingBytes: 5n })).toMatchObject({ allowed: true, projectedBytes: 100n });
  expect(assessStorageCapacity({ limitBytes: 100n, usedBytes: 90n, reservedBytes: 10n, incomingBytes: 1n })).toMatchObject({ allowed: false, full: true });
  expect(assessStorageCapacity({ limitBytes: 100n, usedBytes: 90n, reservedBytes: 5n, incomingBytes: 6n })).toMatchObject({ allowed: false });
});
test("attachment recheck does not charge the already-reserved bytes twice", () => {
  expect(assessStorageCapacity({ limitBytes: 100n, usedBytes: 90n, reservedBytes: 10n, incomingBytes: 0n })).toMatchObject({ allowed: true });
});
test("downgrade overflow blocks new bytes without producing negative remaining capacity", () => {
  expect(assessStorageCapacity({ limitBytes: 50n, usedBytes: 100n, reservedBytes: 5n, incomingBytes: 1n })).toMatchObject({ allowed: false, remainingBytes: 0n });
});
test("very large byte counts remain exact and zero capacity is not unlimited", () => {
  const limit = 100000000000000000000n;
  expect(assessStorageCapacity({ limitBytes: limit, usedBytes: limit - 1n, reservedBytes: 0n, incomingBytes: 2n })).toMatchObject({ allowed: false });
  expect(assessStorageCapacity({ limitBytes: 0n, usedBytes: 0n, reservedBytes: 0n, incomingBytes: 1n })).toMatchObject({ allowed: false });
});
test("negative accounting facts are invalid", () => {
  expect(() => assessStorageCapacity({ limitBytes: 100n, usedBytes: -1n, reservedBytes: 0n, incomingBytes: 1n })).toThrow();
});
