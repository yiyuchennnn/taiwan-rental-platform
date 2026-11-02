import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { expect, test } from "vitest";
import { readR2Config } from "../src/modules/media/r2-config.js";
import { R2ImageStore } from "../src/modules/media/r2-image-store.js";
import { processAndStoreImage } from "../src/modules/media/process-and-store.js";

const endpoint = `https://${"a".repeat(32)}.r2.cloudflarestorage.com`;
const testConfig = { R2_ENDPOINT: endpoint, R2_BUCKET: "validation-bucket", R2_ACCESS_KEY_ID: "TEST-ONLY-ID", R2_SECRET_ACCESS_KEY: "TEST-ONLY-NOT-A-REAL-KEY" };
interface WireRequest { method: string; path: string; headers: Record<string, string>; body?: unknown }
interface StoredObject { data: Buffer; nonce: string; contentType: string; cacheControl: string }

function harness() {
  const objects = new Map<string, StoredObject>();
  const calls: WireRequest[] = [];
  let failThumbnail = false;
  let loseReservationAck = false;
  let failDelete = false;
  const response = (statusCode: number, headers: Record<string, string> = {}, body: Buffer = Buffer.alloc(0)) =>
    ({ response: { statusCode, headers, body: Readable.from([body]) } });
  const client = new S3Client({ endpoint, region: "auto", forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: testConfig.R2_ACCESS_KEY_ID, secretAccessKey: testConfig.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: { handle: async (request: WireRequest) => {
      calls.push(request);
      const key = request.path;
      if (request.method === "PUT") {
        if (objects.has(key) && request.headers["if-none-match"] === "*") {
          return response(412, { "content-type": "application/xml" }, Buffer.from("<Error><Code>PreconditionFailed</Code></Error>"));
        }
        if (failThumbnail && key.endsWith("thumbnail.webp")) throw new Error("injected write failure");
        const data = Buffer.isBuffer(request.body) ? request.body : typeof request.body === "string" ? Buffer.from(request.body) : Buffer.alloc(0);
        objects.set(key, { data, nonce: request.headers["x-amz-meta-reservation"]!, contentType: request.headers["content-type"]!, cacheControl: request.headers["cache-control"]! });
        if (loseReservationAck && key.endsWith("reservation.json")) { loseReservationAck = false; throw new Error("injected lost acknowledgement"); }
        return response(200);
      }
      if (request.method === "DELETE") {
        if (failDelete) throw new Error("injected delete failure");
        objects.delete(key); return response(204);
      }
      const object = objects.get(key);
      if (!object) return response(404, { "content-type": "application/xml" }, Buffer.from("<Error><Code>NoSuchKey</Code></Error>"));
      return response(200, { "x-amz-meta-reservation": object.nonce, "content-type": object.contentType,
        "cache-control": object.cacheControl, "content-length": String(object.data.length) }, request.method === "HEAD" ? Buffer.alloc(0) : object.data);
    } },
  });
  return { store: new R2ImageStore(client, "validation-bucket", "test-prefix"), client, objects, calls,
    failThumbnail: () => { failThumbnail = true; }, loseReservationAck: () => { loseReservationAck = true; }, failDelete: () => { failDelete = true; } };
}

test("durable reservation proof supports reconciliation and deletion after adapter restart", async () => {
  const h = harness(), id = randomUUID(), nonce = randomUUID();
  try {
    await h.store.reserve(id, nonce);
    await h.store.put(id, "display", Buffer.from("fixture"));
    const restarted = new R2ImageStore(h.client, "validation-bucket", "test-prefix");
    restarted.restoreReservation(id, nonce);
    expect(await restarted.reconcileReservation(id)).toBe("OWNED");
    await restarted.remove(id);
    expect(h.objects.size).toBe(0);
  } finally { h.client.destroy(); }
});

test("R2 config has no AWS fallback and accepts only explicit HTTPS R2 endpoints", () => {
  expect(readR2Config(testConfig)).toMatchObject({ endpoint, bucket: "validation-bucket", prefix: "rental-validation" });
  expect(() => readR2Config({ AWS_ACCESS_KEY_ID: "unrelated" })).toThrow(/R2_ENDPOINT/);
  for (const jurisdiction of ["eu", "us", "fedramp"]) {
    expect(readR2Config({ ...testConfig, R2_ENDPOINT: `https://${"a".repeat(32)}.${jurisdiction}.r2.cloudflarestorage.com` }).endpoint).toContain(`.${jurisdiction}.`);
  }
});
test.each(["http://example.com", "https://example.com", `${endpoint}/path`, `${endpoint}?query=1`, `https://user:password@${"a".repeat(32)}.r2.cloudflarestorage.com`])("refuses unsafe endpoint without echoing its credentials", value => {
  try { readR2Config({ ...testConfig, R2_ENDPOINT: value }); throw new Error("must fail"); }
  catch (error) { expect((error as Error).message).toBe("Invalid R2_ENDPOINT"); }
});
test("requires direct signing keys and a bounded validation namespace", () => {
  expect(() => readR2Config({ ...testConfig, R2_SECRET_ACCESS_KEY: undefined })).toThrow(/R2_SECRET_ACCESS_KEY/);
  expect(() => readR2Config({ ...testConfig, R2_BUCKET: "../../other" })).toThrow();
  expect(() => readR2Config({ ...testConfig, R2_VALIDATION_PREFIX: "../../other" })).toThrow();
});
test("actual S3 SDK sends signed conditional private writes and can read back bytes", async () => {
  const h = harness(); const id = randomUUID();
  try {
    await h.store.reserve(id); await h.store.put(id, "display", Buffer.from("processed fixture"));
    expect((await h.store.read(id, "display")).toString()).toBe("processed fixture");
    const puts = h.calls.filter(call => call.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[1]!.path).toBe(`/validation-bucket/test-prefix/${id}/display.webp`);
    for (const call of puts) {
      expect(call.headers["if-none-match"]).toBe("*");
      expect(call.headers["cache-control"]).toBe("private, no-store");
      expect(call.headers.authorization).toContain("AWS4-HMAC-SHA256");
      expect(call.headers).not.toHaveProperty("x-amz-acl");
    }
    expect(puts[1]!.headers["content-type"]).toBe("image/webp");
    expect(puts[1]!.headers["content-md5"]).toBe(createHash("md5").update("processed fixture").digest("base64"));
    await h.store.remove(id); expect(h.objects.size).toBe(0);
    expect(h.calls.filter(call => call.method === "DELETE").every(call => call.path.startsWith(`/validation-bucket/test-prefix/${id}/`))).toBe(true);
  } finally { h.client.destroy(); }
});
test("conditional reservation conflict never establishes ownership or deletes existing objects", async () => {
  const h = harness(); const id = randomUUID();
  h.objects.set(`/validation-bucket/test-prefix/${id}/reservation.json`, { data: Buffer.from("foreign"), nonce: "foreign", contentType: "application/json", cacheControl: "private" });
  try {
    await expect(h.store.reserve(id)).rejects.toMatchObject({ code: "RESERVATION_CONFLICT" });
    await expect(h.store.remove(id)).rejects.toMatchObject({ code: "RESERVATION_PROOF_UNAVAILABLE" });
    expect(h.calls.some(call => call.method === "DELETE")).toBe(false);
  } finally { h.client.destroy(); }
});
test("lost reservation acknowledgement requires reconciliation before cleanup", async () => {
  const h = harness(); const id = randomUUID(); h.loseReservationAck();
  try {
    await expect(h.store.reserve(id)).rejects.toThrow("R2 reservation outcome unknown");
    await expect(h.store.put(id, "display", Buffer.from("no"))).rejects.toMatchObject({ code: "RESERVATION_NOT_CONFIRMED" });
    await expect(h.store.remove(id)).rejects.toMatchObject({ code: "RESERVATION_PROOF_UNAVAILABLE" });
    expect(await h.store.reconcileReservation(id)).toBe("OWNED");
    await h.store.remove(id); expect(h.objects.size).toBe(0);
  } finally { h.client.destroy(); }
});
test("foreign object metadata prevents destructive cleanup", async () => {
  const h = harness(); const id = randomUUID();
  try {
    await h.store.reserve(id);
    h.objects.set(`/validation-bucket/test-prefix/${id}/display.webp`, { data: Buffer.from("foreign"), nonce: "foreign", contentType: "image/webp", cacheControl: "private" });
    await expect(h.store.remove(id)).rejects.toMatchObject({ code: "OBJECT_OWNERSHIP_MISMATCH" });
    expect(h.calls.some(call => call.method === "DELETE")).toBe(false);
  } finally { h.client.destroy(); }
});
test("R2 adapter integrates with processing compensation and reports failed cleanup", async () => {
  const options = { maxInputBytes: 100000, maxInputPixels: 10000, displayMaxEdge: 20, thumbnailMaxEdge: 10, quality: 85, timeoutSeconds: 5 };
  const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } }).png().toBuffer();
  const clean = harness(); clean.failThumbnail();
  try {
    await expect(processAndStoreImage(image, options, clean.store, true)).rejects.toMatchObject({ code: "IMAGE_STORAGE_FAILED" });
    expect(clean.objects.size).toBe(0);
  } finally { clean.client.destroy(); }
  const failed = harness(); failed.failThumbnail(); failed.failDelete();
  try {
    await expect(processAndStoreImage(image, options, failed.store, true)).rejects.toMatchObject({ code: "IMAGE_STORAGE_CLEANUP_REQUIRED" });
    expect(failed.objects.size).toBe(2);
  } finally { failed.client.destroy(); }
});
test("signed read URLs are scoped and do not make network requests", async () => {
  const h = harness(); const id = randomUUID();
  try {
    const url = new URL(await h.store.signedReadUrl(id, "thumbnail", 60));
    expect(url.origin).toBe(endpoint); expect(url.pathname).toBe(`/validation-bucket/test-prefix/${id}/thumbnail.webp`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60"); expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(h.calls).toHaveLength(0);
    await expect(h.store.signedReadUrl(id, "display", 604801)).rejects.toThrow();
    await expect(h.store.signedReadUrl("../../foreign", "display", 60)).rejects.toThrow();
  } finally { h.client.destroy(); }
});
