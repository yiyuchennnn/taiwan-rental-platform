import { randomUUID, createHash } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ReservationOutcomeUnknownError, type PrivateImageStore, type ImageVariantName } from "./private-image-store.js";

export class R2StoreError extends Error {
  constructor(public code: string) { super(code); }
}
const status = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;

/** Private validation adapter. Not a public upload or download authorization layer. */
export class R2ImageStore implements PrivateImageStore {
  private readonly reservations = new Map<string, { nonce: string; confirmed: boolean }>();
  constructor(private readonly client: S3Client, private readonly bucket: string, private readonly prefix: string) {
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new R2StoreError("INVALID_R2_NAMESPACE");
  }
  private key(assetId: string, variant: ImageVariantName | "reservation") {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(assetId)) throw new R2StoreError("INVALID_ASSET_KEY");
    if (!["display", "thumbnail", "reservation"].includes(variant)) throw new R2StoreError("INVALID_IMAGE_VARIANT");
    return `${this.prefix}/${assetId}/${variant === "reservation" ? "reservation.json" : `${variant}.webp`}`;
  }
  restoreReservation(assetId: string, nonce: string) {
    this.key(assetId, "reservation");
    if (!/^[a-f0-9-]{36}$/i.test(nonce)) throw new R2StoreError("INVALID_RESERVATION_PROOF");
    this.reservations.set(assetId, { nonce, confirmed: false });
  }
  async reserve(assetId: string, nonce: string = randomUUID()) {
    const key = this.key(assetId, "reservation");
    if (this.reservations.has(assetId)) throw new R2StoreError("RESERVATION_ALREADY_ATTEMPTED");
    const body = JSON.stringify({ nonce });
    this.reservations.set(assetId, { nonce, confirmed: false });
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentMD5: createHash("md5").update(body).digest("base64"),
        ContentType: "application/json", CacheControl: "private, no-store", Metadata: { reservation: nonce }, IfNoneMatch: "*" }));
      this.reservations.get(assetId)!.confirmed = true;
    } catch (error) {
      const code = status(error);
      if (code && code >= 400 && code < 500 && ![408, 409, 429].includes(code)) {
        this.reservations.delete(assetId);
        throw new R2StoreError(code === 412 ? "RESERVATION_CONFLICT" : "R2_ACCESS_OR_REQUEST_REJECTED");
      }
      // Retain nonce in memory for reconciliation; do not automatically delete an unconfirmed reservation.
      throw new ReservationOutcomeUnknownError("R2 reservation outcome unknown");
    }
  }
  async put(assetId: string, variant: ImageVariantName, data: Buffer) {
    const key = this.key(assetId, variant);
    const reservation = this.reservations.get(assetId);
    if (!reservation?.confirmed) throw new R2StoreError("RESERVATION_NOT_CONFIRMED");
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data,
        ContentMD5: createHash("md5").update(data).digest("base64"),
        ContentType: "image/webp", CacheControl: "private, no-store", Metadata: { reservation: reservation.nonce }, IfNoneMatch: "*" }));
    } catch { throw new R2StoreError("R2_WRITE_FAILED"); }
  }
  async read(assetId: string, variant: ImageVariantName) {
    const key = this.key(assetId, variant);
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) throw new Error("Missing object body");
      return Buffer.from(await result.Body.transformToByteArray());
    } catch { throw new R2StoreError("R2_READ_FAILED"); }
  }
  async reconcileReservation(assetId: string): Promise<"OWNED" | "ABSENT"> {
    const key = this.key(assetId, "reservation");
    const reservation = this.reservations.get(assetId);
    if (!reservation) throw new R2StoreError("RESERVATION_PROOF_UNAVAILABLE");
    try {
      const object = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      if (object.Metadata?.reservation !== reservation.nonce) throw new R2StoreError("RESERVATION_OWNERSHIP_MISMATCH");
      reservation.confirmed = true; return "OWNED";
    } catch (error) {
      if (status(error) === 404) { this.reservations.delete(assetId); return "ABSENT"; }
      if (error instanceof R2StoreError) throw error;
      throw new R2StoreError("R2_RECONCILIATION_FAILED");
    }
  }
  async remove(assetId: string) {
    this.key(assetId, "reservation");
    const reservation = this.reservations.get(assetId);
    if (!reservation?.confirmed) throw new R2StoreError("RESERVATION_PROOF_UNAVAILABLE");
    // Fixed object names only; never list/delete an arbitrary prefix or bucket.
    for (const variant of ["display", "thumbnail", "reservation"] as const) {
      const key = this.key(assetId, variant);
      try {
        const object = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        if (object.Metadata?.reservation !== reservation.nonce) throw new R2StoreError("OBJECT_OWNERSHIP_MISMATCH");
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      } catch (error) {
        if (status(error) === 404) continue;
        if (error instanceof R2StoreError) throw error;
        throw new R2StoreError("R2_DELETE_FAILED");
      }
    }
    this.reservations.delete(assetId);
  }
  async signedReadUrl(assetId: string, variant: ImageVariantName, expiresIn: number) {
    const key = this.key(assetId, variant);
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 604800) throw new R2StoreError("INVALID_SIGNED_URL_LIFETIME");
    try { return await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn }); }
    catch { throw new R2StoreError("R2_SIGNING_FAILED"); }
  }
}
