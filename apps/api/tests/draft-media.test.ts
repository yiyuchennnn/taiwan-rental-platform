import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import { beforeAll, afterAll, expect, test } from "vitest";
import { createSessionService } from "../src/modules/auth/session.service.js";
import { createDraftMediaService, type RecoverableImageStore } from "../src/modules/media/draft-media.service.js";
import { createDraftMediaRouter } from "../src/modules/media/draft-media.routes.js";
import { configuredMedia } from "../src/modules/media/media-runtime.js";
import type { ImageVariantName } from "../src/modules/media/private-image-store.js";
import { createApp } from "../src/app-factory.js";

const root = mkdtempSync(join(tmpdir(), "rental-media-"));
let started = false, orm: PrismaClient, png: Buffer, token: string, foreignToken: string;
let userId: string;
let auth: NonNullable<Awaited<ReturnType<ReturnType<typeof createSessionService>["authenticate"]>>>;
const objects = new Map<string, { nonce: string; variants: Map<string, Buffer> }>();
let failWrite = false, failDelete = false;
let afterWrite: (() => Promise<void>) | undefined;
// Process-independent object state; each adapter starts without in-memory proof.
class Store implements RecoverableImageStore {
  private proof = new Map<string, string>();
  async reserve(id: string, nonce = randomUUID()) {
    if (objects.has(id)) throw new Error("conflict");
    this.proof.set(id, nonce); objects.set(id, { nonce, variants: new Map() });
  }
  restoreReservation(id: string, nonce: string) { this.proof.set(id, nonce); }
  async reconcileReservation(id: string): Promise<"OWNED" | "ABSENT"> {
    const obj = objects.get(id); if (!obj) return "ABSENT";
    if (obj.nonce !== this.proof.get(id)) throw new Error("foreign object");
    return "OWNED";
  }
  async put(id: string, variant: ImageVariantName, data: Buffer) {
    if (failWrite && variant === "thumbnail") throw new Error("injected storage failure");
    objects.get(id)!.variants.set(variant, data);
    if (variant === "thumbnail" && afterWrite) { const callback = afterWrite; afterWrite = undefined; await callback(); }
  }
  async read(id: string, variant: ImageVariantName) { const data = objects.get(id)?.variants.get(variant); if (!data) throw new Error("missing"); return data; }
  async remove(id: string) {
    if (failDelete) throw new Error("injected delete failure");
    if (await this.reconcileReservation(id) === "OWNED") objects.delete(id);
  }
}
const deps = { namespace: "test-only-private-store", createStore: () => new Store(), leaseMs: 60000,
  authorizeCapacity: async () => { /* Explicit isolated fixture; no production quota assumption. */ },
  options: { maxInputBytes: 10000, maxInputPixels: 10000, displayMaxEdge: 32, thumbnailMaxEdge: 16, quality: 80, timeoutSeconds: 5 } };
const app = express();
const run = (name: string, args: string[]) => execFileSync(name, args, { stdio: "pipe" });
const draft = () => orm.listing.create({ data: { publisherId: userId } });
const svc = () => createDraftMediaService(orm, deps);
const upload = (id: string, bearer = token) => request(app).post(`/drafts/${id}/images`).set("Authorization", `Bearer ${bearer}`)
  .set("Content-Type", "image/png").set("Idempotency-Key", randomUUID()).set("X-Image-Rights-Confirmed", "true").send(png);

beforeAll(async () => {
  run("initdb", ["-D", join(root, "pg"), "-A", "trust", "-U", "postgres", "--no-locale", "-E", "UTF8"]);
  run("pg_ctl", ["-D", join(root, "pg"), "-l", join(root, "log"), "-o", `-F -k ${root} -c listen_addresses=''`, "-w", "start"]); started = true;
  const db = new Client({ host: root, database: "postgres", user: "postgres" }); await db.connect();
  try {
    const migrations = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
    for (const dir of readdirSync(migrations).filter(x => /^\d/.test(x)).sort()) await db.query(readFileSync(join(migrations, dir, "migration.sql"), "utf8"));
  } finally { await db.end(); }
  orm = new PrismaClient({ adapter: new PrismaPg({ host: root, database: "postgres", user: "postgres" }) });
  userId = (await orm.user.create({ data: { email: "media@example.test", passwordHash: "test-only" } })).id;
  const other = await orm.user.create({ data: { email: "foreign@example.test", passwordHash: "test-only" } });
  const sessions = createSessionService(orm, 3600);
  token = (await sessions.create(userId)).token; foreignToken = (await sessions.create(other.id)).token;
  auth = (await sessions.authenticate(token))!;
  png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "blue" } }).png().toBuffer();
  app.use(express.json());
  app.use("/drafts/:id/images", createDraftMediaRouter(orm, deps));
  app.use("/disabled/:id/images", createDraftMediaRouter(orm));
  app.use((( _error, _req, res, _next) => res.status(500).json({ error: "internal" })) as express.ErrorRequestHandler);
}, 30000);
afterAll(async () => { try { await orm?.$disconnect(); } finally {
  if (started) run("pg_ctl", ["-D", join(root, "pg"), "-m", "immediate", "-w", "stop"]);
  rmSync(root, { recursive: true, force: true });
} });

test("upload records rights, measured bytes and references; read requires owner and returns no storage URL", async () => {
  const d = await draft(); const result = await upload(d.id).expect(201);
  const media = result.body.data.images[0]; expect(media).not.toHaveProperty("url"); expect(media).not.toHaveProperty("nonce");
  expect(media.displayBytes).toMatch(/^\d+$/); expect(media.isCover).toBe(false);
  const job = await orm.mediaUpload.findUniqueOrThrow({ where: { id: media.assetId } });
  expect(job.state).toBe("ATTACHED"); expect(job.ownerId).toBe(userId); expect(job.rightsConfirmedAt).toBeInstanceOf(Date);
  const read = await request(app).get(`/drafts/${d.id}/images/${media.id}/display`).set("Authorization", `Bearer ${token}`).expect(200);
  expect(read.headers["cache-control"]).toBe("no-store"); expect(read.headers["content-type"]).toContain("image/webp");
  await request(app).get(`/drafts/${d.id}/images/${media.id}/display`).set("Authorization", `Bearer ${foreignToken}`).expect(404);
  await request(app).get(`/drafts/${d.id}/images/${media.id}/display`).expect(401);
});
test("foreign owner, non-draft, absent rights, fake format and oversized bytes never write objects", async () => {
  const d = await draft(), before = objects.size;
  await upload(d.id, foreignToken).expect(404);
  await orm.listing.update({ where: { id: d.id }, data: { status: "ARCHIVED" } }); await upload(d.id).expect(409);
  const another = await draft();
  await request(app).post(`/drafts/${another.id}/images`).set("Authorization", `Bearer ${token}`).set("Content-Type", "image/png").send(png).expect(400);
  await request(app).post(`/drafts/${another.id}/images`).set("Authorization", `Bearer ${token}`).set("Content-Type", "image/png").set("Idempotency-Key", randomUUID()).set("X-Image-Rights-Confirmed", "true").send(Buffer.from("fake png")).expect(400);
  await request(app).post(`/drafts/${another.id}/images`).set("Authorization", `Bearer ${token}`).set("Content-Type", "image/png").set("Idempotency-Key", randomUUID()).set("X-Image-Rights-Confirmed", "true").send(Buffer.alloc(10001)).expect(413);
  expect(objects.size).toBe(before);
});
test("sorting requires the complete current set; concurrent cover changes preserve a single cover", async () => {
  const d = await draft(); await upload(d.id).expect(201); const r = await upload(d.id).expect(201);
  const ids = r.body.data.images.map((x: { id: string }) => x.id) as string[];
  await expect(svc().reorder(auth, d.id, [ids[0]!, ids[0]!])).rejects.toMatchObject({ code: "IMAGE_SET_CHANGED" });
  const ordered = await svc().reorder(auth, d.id, [...ids].reverse()); expect(ordered.map(x => x.id)).toEqual([...ids].reverse());
  await Promise.all(ids.map(id => svc().cover(auth, d.id, id)));
  expect(await orm.listingMedia.count({ where: { listingId: d.id, isCover: true } })).toBe(1);
  await expect(svc().cover(auth, d.id, randomUUID())).rejects.toMatchObject({ status: 404 });
});
test("concurrent uploads serialize the final slot including outstanding reservations", async () => {
  const d = await draft(); await orm.listingMedia.createMany({ data: Array.from({ length: 29 }, (_, sortOrder) => ({ listingId: d.id, url: "legacy:test", sortOrder })) });
  const results = await Promise.all([upload(d.id), upload(d.id)]);
  expect(results.map(x => x.status).sort()).toEqual([201, 409]);
  expect(await orm.listingMedia.count({ where: { listingId: d.id } })).toBe(30);
});
test("partial storage failure removes objects without attaching a database asset", async () => {
  const d = await draft(), before = objects.size; failWrite = true;
  try { await upload(d.id).expect(503); } finally { failWrite = false; }
  expect(objects.size).toBe(before); expect(await orm.listingMedia.count({ where: { listingId: d.id } })).toBe(0);
  expect((await orm.mediaUpload.findFirstOrThrow({ where: { listingId: d.id } })).state).toBe("DELETED");
});
test("failed cleanup persists proof and can recover using a new service instance", async () => {
  const d = await draft(); const r = await upload(d.id).expect(201); const media = r.body.data.images[0]; failDelete = true;
  try { expect((await svc().remove(auth, d.id, media.id)).cleanupPending).toBe(true); } finally { failDelete = false; }
  expect(await orm.mediaAsset.count({ where: { id: media.assetId } })).toBe(0);
  expect(objects.has(media.assetId)).toBe(true);
  expect((await svc().recoverExpired()).cleaned).toBeGreaterThan(0);
  expect(objects.has(media.assetId)).toBe(false);
});
test("shared references preserve assets until the final reference is removed", async () => {
  const a = await draft(), b = await draft(); const r = await upload(a.id).expect(201); const media = r.body.data.images[0];
  const shared = await orm.listingMedia.create({ data: { listingId: b.id, assetId: media.assetId, url: "private:test" } });
  await svc().remove(auth, a.id, media.id); expect(objects.has(media.assetId)).toBe(true);
  await svc().remove(auth, b.id, shared.id); expect(objects.has(media.assetId)).toBe(false);
});
test("expired pending uploads are reported without deleting a potentially active writer", async () => {
  const d = await draft(), id = randomUUID(), nonce = randomUUID();
  await orm.mediaUpload.create({ data: { id, nonce, ownerId: userId, requestKey: randomUUID(), inputDigest: "fixture", listingId: d.id, namespace: deps.namespace, state: "PENDING", reservedBytes: 0n, leaseUntil: new Date(0), rightsConfirmedAt: new Date() } });
  await new Store().reserve(id, nonce);
  expect((await svc().recoverExpired()).pendingReview).toContain(id); expect(objects.has(id)).toBe(true);
});
test("foreign ownership proof prevents cleanup and remains retryable", async () => {
  const d = await draft(), id = randomUUID();
  await orm.mediaUpload.create({ data: { id, nonce: randomUUID(), ownerId: userId, requestKey: randomUUID(), inputDigest: "fixture", listingId: d.id, namespace: deps.namespace, state: "CLEANUP", reservedBytes: 0n, leaseUntil: new Date(0), rightsConfirmedAt: new Date() } });
  await new Store().reserve(id, randomUUID()); await svc().recoverExpired();
  expect(objects.has(id)).toBe(true); expect((await orm.mediaUpload.findUniqueOrThrow({ where: { id } })).state).toBe("CLEANUP");
});
test("stored R2 credentials alone do not activate upload routes", async () => {
  const prior = process.env.IMAGE_UPLOADS_ENABLED; delete process.env.IMAGE_UPLOADS_ENABLED;
  try { expect(configuredMedia()).toBeUndefined(); } finally { if (prior !== undefined) process.env.IMAGE_UPLOADS_ENABLED = prior; }
  await request(app).post(`/disabled/${(await draft()).id}/images`).set("Authorization", `Bearer ${token}`).expect(503);
});
test("missing capacity source blocks uploads without affecting image management", async () => {
  const d = await draft();
  const unavailable = createDraftMediaService(orm, { ...deps, authorizeCapacity: undefined });
  await expect(unavailable.upload(auth, d.id, png, true)).rejects.toMatchObject({ code: "IMAGE_CAPACITY_UNAVAILABLE" });
  expect(await unavailable.list(auth, d.id)).toEqual([]);
  expect(await orm.mediaUpload.count({ where: { listingId: d.id } })).toBe(0);
});
test("capacity authorization runs under the account lock and counts uncleaned reservations", async () => {
  const d = await draft();
  let limit = 0n;
  const capacity = createDraftMediaService(orm, { ...deps, authorizeCapacity: async (tx, id, incoming) => {
    const jobs = await tx.mediaUpload.aggregate({ where: { ownerId: id, state: { not: "DELETED" } }, _sum: { reservedBytes: true } });
    if ((jobs._sum.reservedBytes ?? 0n) + incoming > limit) throw new Error("test capacity exceeded");
  } });
  await expect(capacity.upload(auth, d.id, png, true)).rejects.toThrow("test capacity exceeded");
  expect(await orm.mediaUpload.count({ where: { listingId: d.id } })).toBe(0);
  // Set exactly one image's measured size above current usage.
  const { processImage } = await import("../src/modules/media/process-image.js");
  const processed = await processImage(png, deps.options);
  const jobs = await orm.mediaUpload.aggregate({ where: { ownerId: userId, state: { not: "DELETED" } }, _sum: { reservedBytes: true } });
  limit = (jobs._sum.reservedBytes ?? 0n) + BigInt(processed.display.bytes + processed.thumbnail.bytes);
  const results = await Promise.allSettled([capacity.upload(auth, d.id, png, true), capacity.upload(auth, d.id, png, true)]);
  expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect(await orm.listingMedia.count({ where: { listingId: d.id } })).toBe(1);
});
test("same upload key replays a completed upload without duplicating assets", async () => {
  const d = await draft(), key = randomUUID();
  await svc().upload(auth, d.id, png, true, key);
  const replay = await svc().upload(auth, d.id, png, true, key);
  expect(replay).toHaveLength(1);
  expect(await orm.mediaUpload.count({ where: { listingId: d.id } })).toBe(1);
  const other = await draft();
  await expect(svc().upload(auth, other.id, png, true, key)).rejects.toMatchObject({ code: "UPLOAD_KEY_CONFLICT" });
});
test("state changes during storage writes prevent attachment and clean the uploaded objects", async () => {
  const d = await draft(), before = objects.size;
  afterWrite = async () => { await orm.listing.update({ where: { id: d.id }, data: { status: "ARCHIVED" } }); };
  await expect(svc().upload(auth, d.id, png, true)).rejects.toMatchObject({ code: "DRAFT_REQUIRED" });
  expect(objects.size).toBe(before);
  expect(await orm.listingMedia.count({ where: { listingId: d.id } })).toBe(0);
});
test("concurrent removal of shared references across owners cleans the final asset", async () => {
  const a = await draft();
  const foreign = (await createSessionService(orm, 3600).authenticate(foreignToken))!;
  const b = await orm.listing.create({ data: { publisherId: foreign.user.id } });
  const r = await upload(a.id).expect(201), media = r.body.data.images[0];
  const shared = await orm.listingMedia.create({ data: { listingId: b.id, assetId: media.assetId, url: "private:test" } });
  await Promise.all([svc().remove(auth, a.id, media.id), svc().remove(foreign, b.id, shared.id)]);
  expect(objects.has(media.assetId)).toBe(false);
  expect(await orm.mediaAsset.count({ where: { id: media.assetId } })).toBe(0);
  expect((await orm.mediaUpload.findUniqueOrThrow({ where: { id: media.assetId } })).state).toBe("DELETED");
});
test("actual application composition connects auth, draft creation and image routes", async () => {
  const runtime = createApp(orm, deps);
  await request(runtime).get("/api/v1/health").expect(200);
  const email = `${randomUUID()}@example.test`, password = "IntegrationPassword123!";
  await request(runtime).post("/api/v1/auth/register").send({ email, password }).expect(201);
  const login = await request(runtime).post("/api/v1/auth/login").send({ email, password }).expect(200);
  const bearer = `Bearer ${login.body.data.accessToken}`;
  const created = await request(runtime).post("/api/v1/drafts").set("Authorization", bearer).send({ title: "整合草稿" }).expect(201);
  const id = created.body.data.draft.id;
  const result = await request(runtime).post(`/api/v1/drafts/${id}/images`).set("Authorization", bearer)
    .set("Content-Type", "image/png").set("Idempotency-Key", randomUUID()).set("X-Image-Rights-Confirmed", "true").send(png).expect(201);
  await request(runtime).get(`/api/v1/drafts/${id}/images/${result.body.data.images[0].id}/thumbnail`).set("Authorization", bearer).expect(200);
  await request(runtime).post("/api/v1/auth/logout").set("Authorization", bearer).expect(204);
  await request(runtime).get(`/api/v1/drafts/${id}/images`).set("Authorization", bearer).expect(401);
});
test("actual application returns bounded parser errors instead of misreporting server failures", async () => {
  const runtime = createApp(orm);
  await request(runtime).post("/api/v1/auth/register").set("Content-Type", "application/json").send("{").expect(400);
  const r = await request(runtime).post("/api/v1/auth/register").send({ payload: "x".repeat(1048576) }).expect(413);
  expect(r.body.error.code).toBe("PAYLOAD_TOO_LARGE"); expect(r.body).not.toHaveProperty("stack");
});
