import "dotenv/config";
import assert from "node:assert/strict";
import { get } from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import sharp from "sharp";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { readR2Config, createR2Client } from "../src/modules/media/r2-config.js";
import { R2ImageStore } from "../src/modules/media/r2-image-store.js";
import { processAndStoreImage, ImageStorageError } from "../src/modules/media/process-and-store.js";
import { processImage } from "../src/modules/media/process-image.js";

async function readHttps(url: URL) {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  return new Promise<{ status: number; data: Buffer }>((resolve, reject) => {
    const req = get(url, { agent: proxy ? new HttpsProxyAgent(proxy) : undefined }, res => {
      const buffers: Buffer[] = []; let size = 0;
      res.on("data", (data: Buffer) => {
        size += data.length;
        if (size > 1_000_000) { req.destroy(new Error("Validation response too large")); return; }
        buffers.push(data);
      });
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode ?? 0, data: Buffer.concat(buffers) }));
    });
    req.setTimeout(10000, () => req.destroy(new Error("Validation request timeout")));
    req.on("error", reject);
  });
}

let validationStage = "configuration";
async function main() {
  // Explicit opt-in: this command writes tiny test objects, never creates/configures buckets.
  if (process.env.R2_RUN_REMOTE_VALIDATION !== "1") throw new Error("Set R2_RUN_REMOTE_VALIDATION=1 to opt into remote test writes");
  const config = readR2Config();
  const client = createR2Client(config);
  const store = new R2ImageStore(client, config.bucket, config.prefix);
  const cleanup = new Set<string>();
  try {
    validationStage = "image-processing";
    const original = await sharp({ create: { width: 32, height: 24, channels: 3, background: "orange" } }).png().toBuffer();
    const options = { maxInputBytes: 100000, maxInputPixels: 10000, displayMaxEdge: 32, thumbnailMaxEdge: 16, quality: 85, timeoutSeconds: 5 };
    const expected = await processImage(original, options);
    let receipt;
    try {
      validationStage = "upload";
      receipt = await processAndStoreImage(original, options, store, true);
    } catch (error) {
      if (error instanceof ImageStorageError) {
        for (const id of error.cleanupAssetIds) cleanup.add(id);
        for (const id of error.reconcileAssetIds) {
          try { if (await store.reconcileReservation(id) === "OWNED") cleanup.add(id); }
          catch { console.error(`Reservation requires manual verification: ${config.prefix}/${id}`); }
        }
      }
      throw error;
    }
    cleanup.add(receipt.assetId);
    validationStage = "readback";
    const display = await store.read(receipt.assetId, "display");
    assert.equal(display.length, receipt.displayBytes);
    assert.ok(display.equals(expected.display.data));
    assert.ok((await store.read(receipt.assetId, "thumbnail")).equals(expected.thumbnail.data));
    assert.equal((await sharp(display).metadata()).exif, undefined);
    validationStage = "signed-read";
    const signed = new URL(await store.signedReadUrl(receipt.assetId, "display", 60));
    const signedRead = await readHttps(signed);
    assert.equal(signedRead.status, 200);
    assert.ok(signedRead.data.equals(display));
    validationStage = "unsigned-read-rejection";
    const unsigned = new URL(signed.origin + signed.pathname);
    const unauthenticatedRead = await readHttps(unsigned);
    console.log(`Unsigned S3 response status: ${unauthenticatedRead.status}`);
    const responseCode = unauthenticatedRead.data.toString("utf8").match(/<Code>([A-Za-z0-9]+)<\/Code>/)?.[1];
    if (responseCode) console.log(`Unsigned S3 response code: ${responseCode}`);
    const errorMessage = unauthenticatedRead.data.toString("utf8").match(/<Message>([^<]*)<\/Message>/)?.[1] ?? "";
    const missingAuthentication = /authorization|authentication|x-amz-algorithm|access key|signature/i.test(errorMessage);
    assert.ok([401, 403, 404].includes(unauthenticatedRead.status)
      || (unauthenticatedRead.status === 400 && responseCode === "InvalidArgument" && missingAuthentication),
      "Unsigned S3 endpoint must refuse object access with an authentication error");
    console.log("PASS: real R2 write, readback, signed GET and unsigned S3 GET rejection");
    validationStage = "cleanup";
    await store.remove(receipt.assetId);
    for (const name of ["reservation.json", "display.webp", "thumbnail.webp"]) {
      let absent = false;
      try { await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: `${config.prefix}/${receipt.assetId}/${name}` })); }
      catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) absent = true; else throw error; }
      assert.ok(absent, "Validation object must be absent after cleanup");
    }
    cleanup.delete(receipt.assetId);
    console.log("PASS: all validation objects deleted; no public bucket setting was changed");
  } finally {
    for (const id of cleanup) {
      try { await store.remove(id); }
      catch { console.error(`Cleanup requires follow-up: ${config.prefix}/${id}`); }
    }
    client.destroy();
  }
}
main().catch(error => {
  // Never print SDK error stacks, keys, request headers or presigned URLs.
  const code = error instanceof ImageStorageError ? error.code : "R2_VALIDATION_NOT_COMPLETED";
  console.error(code);
  console.error(`Validation stage: ${validationStage}`);
  if (process.env.R2_RUN_REMOTE_VALIDATION !== "1") console.error("Remote writes are disabled. See docs/decisions/R2驗證設定與操作指引.md");
  process.exitCode = 1;
});
