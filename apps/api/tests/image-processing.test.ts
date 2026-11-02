import { randomUUID } from "node:crypto";
import { readdir, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { afterEach, expect, test } from "vitest";
import { processImage, type ImageProcessingOptions } from "../src/modules/media/process-image.js";
import { TemporaryImageStore, ReservationOutcomeUnknownError, type PrivateImageStore } from "../src/modules/media/private-image-store.js";
import { processAndStoreImage } from "../src/modules/media/process-and-store.js";

// Fixture settings only. No production policy on 10 MB units, dimensions or quality is inferred.
const options: ImageProcessingOptions = { maxInputBytes: 10_000_000, maxInputPixels: 1_000_000,
  displayMaxEdge: 100, thumbnailMaxEdge: 32, quality: 85, timeoutSeconds: 5 };
const stores: TemporaryImageStore[] = [];
async function store() { const value = await TemporaryImageStore.create(); stores.push(value); return value; }
afterEach(async () => { for (const value of stores.splice(0)) await value.dispose(); });
async function image(format: "jpeg" | "png" | "webp" = "jpeg", width = 200, height = 100) {
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 100, b: 20 } } }).toFormat(format).toBuffer();
}

function pngChunk(type: string, data: Buffer) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, payload, checksum]);
}
test("APNG animation is rejected rather than silently taking its first frame", async () => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const control = Buffer.alloc(8); control.writeUInt32BE(2);
  const frame = (sequence: number) => {
    const data = Buffer.alloc(26); data.writeUInt32BE(sequence, 0); data.writeUInt32BE(1, 4); data.writeUInt32BE(1, 8);
    data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22); return pngChunk("fcTL", data);
  };
  const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
  const input = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk("IHDR", ihdr), pngChunk("acTL", control),
    frame(0), pngChunk("IDAT", deflateSync(Buffer.from([0,255,0,0]))), frame(1),
    pngChunk("fdAT", Buffer.concat([sequence, deflateSync(Buffer.from([0,0,0,255]))])), pngChunk("IEND", Buffer.alloc(0))]);
  await expect(processImage(input, options)).rejects.toMatchObject({ code: "ANIMATED_IMAGE_REQUIRES_POLICY" });
});
test("PNG text mentioning acTL is not mistaken for an animation control chunk", async () => {
  const original = await image("png");
  const input = Buffer.concat([original.subarray(0,33), pngChunk("tEXt", Buffer.from("Comment\0acTL is text")), original.subarray(33)]);
  expect((await processImage(input, options)).display.width).toBe(100);
});

test.each(["jpeg", "png", "webp"] as const)("decodes actual %s content and creates bounded WebP variants", async format => {
  const result = await processImage(await image(format), options);
  expect(result.display).toMatchObject({ width: 100, height: 50, contentType: "image/webp" });
  expect(result.thumbnail).toMatchObject({ width: 32, height: 16, contentType: "image/webp" });
  for (const output of [result.display, result.thumbnail]) {
    expect(output.bytes).toBe(output.data.length);
    expect((await sharp(output.data).metadata()).format).toBe("webp");
  }
});
test("does not enlarge small photos or crop their aspect ratio", async () => {
  const result = await processImage(await image("png", 20, 10), options);
  expect(result.display).toMatchObject({ width: 20, height: 10 });
  expect(result.thumbnail).toMatchObject({ width: 20, height: 10 });
});
test("applies orientation before stripping real EXIF GPS metadata", async () => {
  const original = await sharp({ create: { width: 60, height: 40, channels: 3, background: "red" } }).jpeg()
    .withExif({ IFD0: { Artist: "Fixture" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "24/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "121/1 0/1 0/1" } })
    .withMetadata({ orientation: 6 }).toBuffer();
  const metadata = await sharp(original).metadata();
  expect(metadata.orientation).toBe(6);
  const exif = metadata.exif!;
  const little = exif.toString("ascii", 6, 8) === "II";
  const u16 = (offset: number) => little ? exif.readUInt16LE(offset) : exif.readUInt16BE(offset);
  const u32 = (offset: number) => little ? exif.readUInt32LE(offset) : exif.readUInt32BE(offset);
  const ifd = 6 + u32(10);
  const tags = Array.from({ length: u16(ifd) }, (_, index) => u16(ifd + 2 + 12 * index));
  expect(tags).toContain(0x8825); // Prove that the fixture really contains a GPS IFD.
  const result = await processImage(original, options);
  expect(result.display).toMatchObject({ width: 40, height: 60 });
  for (const variant of [result.display, result.thumbnail]) {
    const output = await sharp(variant.data).metadata();
    expect(output.exif).toBeUndefined(); expect(output.icc).toBeUndefined(); expect(output.xmp).toBeUndefined();
    expect(output.orientation).toBeUndefined();
  }
});
test("removes XMP metadata and preserves transparent pixels", async () => {
  const original = await sharp({ create: { width: 20, height: 10, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } })
    .png().withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><test>private</test></x:xmpmeta>').toBuffer();
  expect((await sharp(original).metadata()).xmp).toBeDefined();
  const result = await processImage(original, options);
  const decoded = await sharp(result.display.data).ensureAlpha().raw().toBuffer();
  expect(decoded[3]).toBe(0);
  expect((await sharp(result.display.data).metadata()).xmp).toBeUndefined();
});
test("byte boundary is inclusive and oversize input is rejected before decoding", async () => {
  const original = await image();
  await expect(processImage(original, { ...options, maxInputBytes: original.length })).resolves.toBeDefined();
  await expect(processImage(original, { ...options, maxInputBytes: original.length - 1 })).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
});
test("invalid JPEG bytes and truncated files do not pass header-only checks", async () => {
  await expect(processImage(Buffer.from([255, 216, 255, 0]), options)).rejects.toMatchObject({ code: "IMAGE_DECODE_FAILED" });
  const original = await image();
  await expect(processImage(original.subarray(0, Math.floor(original.length / 2)), options)).rejects.toMatchObject({ code: "IMAGE_DECODE_FAILED" });
});
test.each([Buffer.from("not a photo.jpg"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), Buffer.from("GIF89a")])("rejects unsupported actual content regardless of filename claims", async input => {
  await expect(processImage(input, options)).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE_FORMAT" });
});
test("empty input and pixel resource overflow fail without producing stored assets", async () => {
  await expect(processImage(Buffer.alloc(0), options)).rejects.toMatchObject({ code: "EMPTY_IMAGE" });
  await expect(processImage(await image(), { ...options, maxInputPixels: 10 })).rejects.toMatchObject({ code: "IMAGE_DECODE_FAILED" });
});
test("animated WebP is explicitly unresolved rather than silently flattened", async () => {
  const original = await sharp(Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]), { raw: { width: 1, height: 2, channels: 4, pageHeight: 1 } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer();
  expect((await sharp(original, { animated: true }).metadata()).pages).toBe(2);
  await expect(processImage(original, options)).rejects.toMatchObject({ code: "ANIMATED_IMAGE_REQUIRES_POLICY" });
});
test.each([{ quality: 0 }, { quality: 101 }, { maxInputPixels: 0 }, { thumbnailMaxEdge: 101 }, { timeoutSeconds: -1 }])("requires explicit valid technical settings: %j", async invalid => {
  await expect(processImage(await image(), { ...options, ...invalid })).rejects.toThrow();
});

test("temporary storage retains only processed variants and actual byte counts", async () => {
  const disk = await store();
  const original = await image();
  const result = await processAndStoreImage(original, options, disk, true);
  expect(await readdir(disk.rootPath)).toEqual([result.assetId]);
  expect((await readdir(join(disk.rootPath, result.assetId))).sort()).toEqual(["display.webp", "thumbnail.webp"]);
  expect((await disk.read(result.assetId, "display")).length).toBe(result.displayBytes);
  expect((await disk.read(result.assetId, "thumbnail")).length).toBe(result.thumbnailBytes);
  expect((await stat(disk.rootPath)).mode & 0o777).toBe(0o700);
  expect((await stat(join(disk.rootPath, result.assetId, "display.webp"))).mode & 0o777).toBe(0o600);
  expect(result).not.toHaveProperty("url"); expect(result).not.toHaveProperty("original");
  expect((await disk.read(result.assetId, "display")).equals(original)).toBe(false);
});
test("missing usage-right confirmation or invalid image writes nothing", async () => {
  const disk = await store();
  await expect(processAndStoreImage(await image(), options, disk, false)).rejects.toMatchObject({ code: "PHOTO_RIGHTS_NOT_CONFIRMED" });
  await expect(processAndStoreImage(Buffer.from("invalid"), options, disk, true)).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE_FORMAT" });
  expect(await readdir(disk.rootPath)).toEqual([]);
});
test("failure writing the second variant removes the first and the reservation", async () => {
  const disk = await store();
  const faulty: PrivateImageStore = {
    reserve: id => disk.reserve(id), remove: id => disk.remove(id),
    put: async (id, variant, data) => { await disk.put(id, variant, data); if (variant === "thumbnail") throw new Error("injected storage failure"); },
  };
  await expect(processAndStoreImage(await image(), options, faulty, true)).rejects.toMatchObject({ code: "IMAGE_STORAGE_FAILED", cleanupAssetIds: [] });
  expect(await readdir(disk.rootPath)).toEqual([]);
});
test("cleanup failure reports a recovery target and never claims capacity was freed", async () => {
  const disk = await store();
  const faulty: PrivateImageStore = {
    reserve: id => disk.reserve(id), remove: async () => { throw new Error("injected delete failure"); },
    put: async (id, variant, data) => { if (variant === "thumbnail") throw new Error("injected upload failure"); await disk.put(id, variant, data); },
  };
  try { await processAndStoreImage(await image(), options, faulty, true); throw new Error("expected storage failure"); }
  catch (error) {
    expect(error).toMatchObject({ code: "IMAGE_STORAGE_CLEANUP_REQUIRED" });
    const targets = (error as { cleanupAssetIds: string[] }).cleanupAssetIds;
    expect(targets).toHaveLength(1);
    expect(await readdir(disk.rootPath)).toEqual(targets);
    await disk.remove(targets[0]!);
  }
});
test("reservation failure does not trigger deletion of an asset we did not reserve", async () => {
  let removed = false;
  const faulty: PrivateImageStore = { reserve: async () => { throw new Error("already exists"); },
    put: async () => { throw new Error("must not be called"); }, remove: async () => { removed = true; } };
  await expect(processAndStoreImage(await image(), options, faulty, true)).rejects.toMatchObject({ code: "IMAGE_STORAGE_FAILED" });
  expect(removed).toBe(false);
});
test("ambiguous reservation returns a reconciliation target instead of blindly deleting", async () => {
  const disk = await store(); let removed = false;
  const faulty: PrivateImageStore = {
    reserve: async id => { await disk.reserve(id); throw new ReservationOutcomeUnknownError("injected lost acknowledgement"); },
    put: async () => { throw new Error("must not write before reservation is confirmed"); },
    remove: async id => { removed = true; await disk.remove(id); },
  };
  try { await processAndStoreImage(await image(), options, faulty, true); throw new Error("expected failure"); }
  catch (error) {
    expect(error).toMatchObject({ code: "IMAGE_RESERVATION_UNCONFIRMED", cleanupAssetIds: [] });
    const targets = (error as { reconcileAssetIds: string[] }).reconcileAssetIds;
    expect(targets).toHaveLength(1); expect(await readdir(disk.rootPath)).toEqual(targets); expect(removed).toBe(false);
  }
});
test("private adapter refuses traversal, replacement and operations after disposal", async () => {
  const disk = await store(); const id = randomUUID();
  await expect(disk.reserve("../../outside")).rejects.toThrow();
  await disk.reserve(id);
  await disk.put(id, "display", Buffer.from("first"));
  await expect(disk.put(id, "display", Buffer.from("overwrite"))).rejects.toThrow();
  expect((await disk.read(id, "display")).toString()).toBe("first");
  const root = disk.rootPath; await disk.dispose();
  await expect(access(root)).rejects.toThrow();
  await expect(disk.read(id, "display")).rejects.toThrow();
});
