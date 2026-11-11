import {
  publicListingSchema,
  operationReceiptSchema,
} from "../src/modules/listings/content-contract.js";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, test } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app-factory.js";
import { isolatedDatabase } from "./helpers/isolated-database.js";
import type { PublicationEvidenceReader } from "../src/modules/listings/content-command.service.js";
import type {
  RecoverableImageStore,
  MediaDependencies,
} from "../src/modules/media/draft-media.service.js";
import type { ImageVariantName } from "../src/modules/media/private-image-store.js";
import { equipmentCodes } from "../src/modules/listings/input-rules.js";
let fixture: Awaited<ReturnType<typeof isolatedDatabase>>;
let runtime: ReturnType<typeof createApp>;
let png: Buffer;
const objects = new Map<
  string,
  { nonce: string; variants: Map<ImageVariantName, Buffer> }
>();
class TestStore implements RecoverableImageStore {
  private proof = new Map<string, string>();
  async reserve(id: string, nonce = randomUUID()) {
    if (objects.has(id)) throw new Error("exists");
    this.proof.set(id, nonce);
    objects.set(id, { nonce, variants: new Map() });
  }
  restoreReservation(id: string, nonce: string) {
    this.proof.set(id, nonce);
  }
  async reconcileReservation(id: string): Promise<"OWNED" | "ABSENT"> {
    const value = objects.get(id);
    if (!value) return "ABSENT";
    if (value.nonce !== this.proof.get(id)) throw new Error("unowned");
    return "OWNED";
  }
  async put(id: string, variant: ImageVariantName, data: Buffer) {
    objects.get(id)!.variants.set(variant, data);
  }
  async read(id: string, variant: ImageVariantName) {
    const value = objects.get(id)?.variants.get(variant);
    if (!value) throw new Error("absent");
    return value;
  }
  async remove(id: string) {
    if ((await this.reconcileReservation(id)) === "OWNED") objects.delete(id);
  }
}
// Explicit test-only evidence, never imported or configured by application runtime.
const evidence: PublicationEvidenceReader = async (_tx, row, at) => ({
  revision: row.revision,
  sourceReference: "TEST_FIXTURE_NOT_REAL_VERIFICATION",
  validUntil: new Date(at.getTime() + 60000),
  checks: {
    identity: true,
    contactControl: true,
    address: true,
    privacy: true,
    duplicateUnit: true,
    imageRightsAndAssets: true,
    capacityAccounting: true,
    accountAndEntitlementLifecycle: true,
  },
});
const media: MediaDependencies = {
  namespace: "ISOLATED_FLOW_ONLY",
  createStore: () => new TestStore(),
  leaseMs: 60000,
  authorizeCapacity: async () => {},
  options: {
    maxInputBytes: 10000,
    maxInputPixels: 10000,
    displayMaxEdge: 32,
    thumbnailMaxEdge: 16,
    quality: 82,
    timeoutSeconds: 5,
  },
};
beforeAll(async () => {
  fixture = await isolatedDatabase();
  await fixture.db.city.create({
    data: {
      code: "TEST",
      name: "隔離縣市",
      isEnabled: true,
      publicationPolicy: "OPEN",
    },
  });
  await fixture.db.district.create({
    data: { code: "01", name: "隔離行政區", cityCode: "TEST" },
  });
  runtime = createApp(fixture.db, media, evidence);
  png = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#aabbcc" },
  })
    .png()
    .toBuffer();
}, 30000);
afterAll(async () => {
  if (fixture) await fixture.close();
  objects.clear();
});
async function identity() {
  const email = `${randomUUID()}@example.test`,
    password = "TestOnlyPassword123!";
  const registered = await request(runtime)
    .post("/api/v1/auth/register")
    .send({ email, password })
    .expect(201);
  const login = await request(runtime)
    .post("/api/v1/auth/login")
    .send({ email, password })
    .expect(200);
  return {
    id: registered.body.data.user.id as string,
    bearer: `Bearer ${login.body.data.accessToken}`,
  };
}
async function create(
  bearer: string,
  draft: unknown = {},
  key: string = randomUUID(),
) {
  const response = await request(runtime)
    .post("/api/v1/me/listings")
    .set("Authorization", bearer)
    .set("Idempotency-Key", key)
    .send({ draft })
    .expect(201);
  operationReceiptSchema.parse(response.body.data.operation);
  return response.body.data.operation as {
    id: string;
    resourceId: string;
    currentRevision: number;
    resultStatus: string;
  };
}
async function read(id: string, bearer: string) {
  return (
    await request(runtime)
      .get(`/api/v1/me/listings/${id}`)
      .set("Authorization", bearer)
      .expect(200)
  ).body.data.listing;
}
function fields() {
  return {
    title: "隔離測試房源",
    description: "明確的租賃條件",
    rentalType: "INDEPENDENT_SUITE",
    buildingType: "TOWNHOUSE",
    areaPings: 8.5,
    areaSource: "INTERIOR",
    address: {
      cityCode: "TEST",
      districtCode: "01",
      addressLine: "私人地址測試路1號",
      roomNumber: "私人A室",
      roomIdentifierSource: "CUSTOM",
      addressKind: "STANDARD",
    },
    totalFloors: 4,
    floorMode: "SINGLE",
    floorFrom: 2,
    bathrooms: 1,
    sharedSpaces: [],
    rent: 20000,
    depositMode: "MONTHS",
    depositMonths: 2,
    elevatorStatus: "UNKNOWN",
    petPolicy: "NOT_ALLOWED",
    cookingPolicy: "DISCUSS",
    laundryStatus: "SHARED",
    dryingStatus: "NONE",
    garbageStatus: "SELF",
    subsidyPolicy: "UNKNOWN",
    minimumLeaseMonths: 1,
    occupancyMode: "NEGOTIABLE",
    publisherType: "LANDLORD",
    contactName: "測試刊登者",
    contactPhone: "0912345678",
    carParkingStatus: "NO",
    motorcycleParkingStatus: "UNKNOWN",
    equipmentItems: equipmentCodes.map((code) => ({ code, status: "UNKNOWN" })),
    utilityCharges: ["WATER", "ELECTRICITY", "GAS", "INTERNET"].map((kind) => ({
      kind,
      mode: "INCLUDED",
    })),
    feeItems: [
      { kind: "MANAGEMENT", label: "管理費", mode: "NONE", required: true },
    ],
  };
}
async function complete(bearer: string) {
  const operation = await create(bearer, fields()),
    id = operation.resourceId;
  for (let i = 0; i < 3; i++)
    await request(runtime)
      .post(`/api/v1/drafts/${id}/images`)
      .set("Authorization", bearer)
      .set("If-Match", `"${i + 1}"`)
      .set("Content-Type", "image/png")
      .set("Idempotency-Key", randomUUID())
      .set("X-Image-Rights-Confirmed", "true")
      .send(png)
      .expect(201);
  const images = await fixture.db.listingMedia.findMany({
    where: { listingId: id },
  });
  await request(runtime)
    .put(`/api/v1/drafts/${id}/images/${images[0]!.id}/cover`)
    .set("Authorization", bearer)
    .send({ expectedRevision: 4 })
    .expect(200);
  return { id, listing: await read(id, bearer) };
}
async function preview(id: string, bearer: string, revision: number) {
  return (
    await request(runtime)
      .post(`/api/v1/me/listings/${id}/preview`)
      .set("Authorization", bearer)
      .send({ expectedRevision: revision })
      .expect(200)
  ).body.data.preview;
}
function publish(
  id: string,
  bearer: string,
  revision: number,
  previewId: string,
  key: string = randomUUID(),
) {
  return request(runtime)
    .post(`/api/v1/me/listings/${id}/publish`)
    .set("Authorization", bearer)
    .set("Idempotency-Key", key)
    .send({ expectedRevision: revision, previewId, confirmed: true });
}
function transition(
  id: string,
  bearer: string,
  revision: number,
  action: string,
  key: string = randomUUID(),
) {
  return request(runtime)
    .post(`/api/v1/me/listings/${id}/transitions`)
    .set("Authorization", bearer)
    .set("Idempotency-Key", key)
    .send({ expectedRevision: revision, action, confirmed: true });
}

test("without UI: register, login, draft, real processing, preview, publish, guarded public read, unpublish and logout", async () => {
  const user = await identity(),
    { id, listing } = await complete(user.bearer),
    p = await preview(id, user.bearer, listing.revision);
  expect(p.validation.confirmedRulesPassed).toBe(true);
  const key = randomUUID();
  const published = await publish(
    id,
    user.bearer,
    listing.revision,
    p.id,
    key,
  ).expect(200);
  expect(published.body.data.operation.resultStatus).toBe("PUBLISHED");
  const replay = await publish(
    id,
    user.bearer,
    listing.revision,
    p.id,
    key,
  ).expect(200);
  expect(replay.body).toEqual(published.body);
  const row = await fixture.db.listing.findUniqueOrThrow({ where: { id } });
  expect(row.firstPublishedAt).toBeInstanceOf(Date);
  expect(row.publishedAt).toBeNull();
  const publicResult = await request(runtime)
    .get(`/api/v1/listings/${row.publicId}`)
    .expect(200);
  publicListingSchema.parse(publicResult.body.data.listing);
  const json = JSON.stringify(publicResult.body);
  for (const value of [
    "私人地址",
    "私人A室",
    "publisherId",
    "contactEmail",
    "private:",
    "sourceReference",
  ])
    expect(json).not.toContain(value);
  const path = publicResult.body.data.listing.images[0].thumbnailPath;
  const image = await request(runtime).get(path).expect(200);
  expect(image.headers["content-type"]).toContain("image/webp");
  await transition(id, user.bearer, row.revision, "archive").expect(200);
  await request(runtime).get(`/api/v1/listings/${row.publicId}`).expect(404);
  await request(runtime).get(path).expect(404);
  const archived = await read(id, user.bearer);
  expect(archived.status).toBe("ARCHIVED");
  expect(
    (await fixture.db.listing.findUniqueOrThrow({ where: { id } }))
      .firstPublishedAt,
  ).toEqual(row.firstPublishedAt);
  await request(runtime)
    .post("/api/v1/auth/logout")
    .set("Authorization", user.bearer)
    .expect(204);
  await request(runtime)
    .get(`/api/v1/me/listings/${id}`)
    .set("Authorization", user.bearer)
    .expect(401);
});
test("default runtime cannot publish using fixture-looking client approval or an absent formal evidence service", async () => {
  const user = await identity(),
    { id, listing } = await complete(user.bearer),
    p = await preview(id, user.bearer, listing.revision),
    production = createApp(fixture.db, media);
  await request(production)
    .post(`/api/v1/me/listings/${id}/publish`)
    .set("Authorization", user.bearer)
    .set("Idempotency-Key", randomUUID())
    .send({
      expectedRevision: listing.revision,
      previewId: p.id,
      confirmed: true,
      verified: true,
    })
    .expect(400);
  const result = await request(production)
    .post(`/api/v1/me/listings/${id}/publish`)
    .set("Authorization", user.bearer)
    .set("Idempotency-Key", randomUUID())
    .send({
      expectedRevision: listing.revision,
      previewId: p.id,
      confirmed: true,
    })
    .expect(503);
  expect(result.body.error.code).toBe("PUBLICATION_EVIDENCE_UNAVAILABLE");
  expect((await read(id, user.bearer)).status).toBe("DRAFT");
  expect(
    await fixture.db.listingPublication.count({ where: { listingId: id } }),
  ).toBe(0);
});
test("create replay consumes one slot; key reuse with another payload never creates another draft", async () => {
  const user = await identity(),
    key = randomUUID(),
    first = await create(user.bearer, { title: "唯一草稿" }, key),
    again = await create(user.bearer, { title: "唯一草稿" }, key);
  expect(again).toEqual(first);
  expect(
    await fixture.db.listing.count({ where: { publisherId: user.id } }),
  ).toBe(1);
  await request(runtime)
    .post("/api/v1/me/listings")
    .set("Authorization", user.bearer)
    .set("Idempotency-Key", key)
    .send({ draft: { title: "另一內容" } })
    .expect(409);
});
test("same revision concurrent writes: exactly one commits; replay checks before stale revision", async () => {
  const user = await identity(),
    op = await create(user.bearer),
    id = op.resourceId,
    key = randomUUID();
  const update = (title: string, k: string) =>
    request(runtime)
      .patch(`/api/v1/me/listings/${id}/work-version`)
      .set("Authorization", user.bearer)
      .set("Idempotency-Key", k)
      .send({ expectedRevision: 1, patch: { title } });
  const results = await Promise.all([
    update("A", key),
    update("B", randomUUID()),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = results[0]!.status === 200 ? "A" : "B",
    winnerKey = results[0]!.status === 200 ? key : null;
  expect((await read(id, user.bearer)).title).toBe(winner);
  expect((await read(id, user.bearer)).revision).toBe(2);
  if (winnerKey) await update("A", winnerKey).expect(200);
});
test("same value and empty patch do not create new content revisions", async () => {
  const user = await identity(),
    op = await create(user.bearer, { title: "原標題" });
  for (const patch of [{}, { title: "原標題" }, { address: {} }]) {
    const result = await request(runtime)
      .patch(`/api/v1/me/listings/${op.resourceId}/work-version`)
      .set("Authorization", user.bearer)
      .set("Idempotency-Key", randomUUID())
      .send({ expectedRevision: 1, patch })
      .expect(200);
    expect(result.body.data.operation.currentRevision).toBe(1);
  }
});
test("image cover changes invalidate an already confirmed preview", async () => {
  const user = await identity(),
    { id, listing } = await complete(user.bearer),
    p = await preview(id, user.bearer, listing.revision);
  const image = await fixture.db.listingMedia.findFirstOrThrow({
    where: { listingId: id, isCover: false },
  });
  await request(runtime)
    .put(`/api/v1/drafts/${id}/images/${image.id}/cover`)
    .set("Authorization", user.bearer)
    .send({ expectedRevision: listing.revision })
    .expect(200);
  const result = await publish(id, user.bearer, listing.revision, p.id).expect(
    409,
  );
  expect(result.body.error.code).toBe("REVISION_CONFLICT");
});
test("safe operation receipt survives ownership changes but private data does not replay", async () => {
  const user = await identity(),
    other = await identity(),
    key = randomUUID(),
    op = await create(user.bearer, { title: "原持有人私人內容" }, key);
  await fixture.db.listing.update({
    where: { id: op.resourceId },
    data: {
      publisherId: other.id,
      title: "新持有人私人內容",
      revision: { increment: 1 },
    },
  });
  expect(await create(user.bearer, { title: "原持有人私人內容" }, key)).toEqual(
    op,
  );
  await request(runtime)
    .get(`/api/v1/me/listings/${op.resourceId}`)
    .set("Authorization", user.bearer)
    .expect(404);
  await request(runtime)
    .get(`/api/v1/me/operations/${op.id}`)
    .set("Authorization", other.bearer)
    .expect(404);
});
test("necessary unpublish and trash work despite archived quota overflow; restore never becomes public", async () => {
  const user = await identity();
  await fixture.db.listing.createMany({
    data: Array.from({ length: 11 }, () => ({
      publisherId: user.id,
      status: "ARCHIVED" as const,
    })),
  });
  const op = await create(user.bearer);
  await fixture.db.listing.update({
    where: { id: op.resourceId },
    data: { status: "PUBLISHED", moderationStatus: "BLOCKED" },
  });
  const result = await transition(
    op.resourceId,
    user.bearer,
    1,
    "archive",
  ).expect(200);
  expect(result.body.data.operation.resultStatus).toBe("ARCHIVED");
  await transition(op.resourceId, user.bearer, 2, "trash").expect(200);
  await transition(op.resourceId, user.bearer, 3, "restore").expect(200); // restriction independent of archive bucket
  expect((await read(op.resourceId, user.bearer)).moderationStatus).toBe(
    "BLOCKED",
  );
});
test("ordinary restore with full archive keeps trash and expiration rejects even if worker has not run", async () => {
  const user = await identity(),
    op = await create(user.bearer);
  await transition(op.resourceId, user.bearer, 1, "trash").expect(200);
  await fixture.db.listing.createMany({
    data: Array.from({ length: 10 }, () => ({
      publisherId: user.id,
      status: "ARCHIVED" as const,
    })),
  });
  await transition(op.resourceId, user.bearer, 2, "restore").expect(409);
  expect((await read(op.resourceId, user.bearer)).status).toBe("TRASHED");
  await fixture.db.listing.update({
    where: { id: op.resourceId },
    data: { trashedAt: new Date(Date.now() - 30 * 86400 * 1000) },
  });
  const expired = await transition(
    op.resourceId,
    user.bearer,
    2,
    "restore",
  ).expect(409);
  expect(expired.body.error.code).toBe("RECOVERY_EXPIRED");
});
test("public quota competition commits one transaction and does not consume the loser draft", async () => {
  const user = await identity(),
    a = await complete(user.bearer),
    b = await complete(user.bearer),
    pa = await preview(a.id, user.bearer, a.listing.revision),
    pb = await preview(b.id, user.bearer, b.listing.revision);
  const results = await Promise.all([
    publish(a.id, user.bearer, a.listing.revision, pa.id),
    publish(b.id, user.bearer, b.listing.revision, pb.id),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    await fixture.db.listing.count({
      where: { publisherId: user.id, status: "PUBLISHED" },
    }),
  ).toBe(1);
  expect(
    await fixture.db.listing.count({
      where: { publisherId: user.id, status: "DRAFT" },
    }),
  ).toBe(1);
});
test("missing key or revision and extra authorization fields are rejected; compatibility writes disabled in actual app", async () => {
  const user = await identity(),
    op = await create(user.bearer);
  await request(runtime)
    .post("/api/v1/me/listings")
    .set("Authorization", user.bearer)
    .send({ draft: {} })
    .expect(400);
  await request(runtime)
    .patch(`/api/v1/me/listings/${op.resourceId}/work-version`)
    .set("Authorization", user.bearer)
    .set("Idempotency-Key", randomUUID())
    .send({ patch: { title: "x" } })
    .expect(400);
  await request(runtime)
    .patch(`/api/v1/me/listings/${op.resourceId}/work-version`)
    .set("Authorization", user.bearer)
    .set("Idempotency-Key", randomUUID())
    .send({ expectedRevision: 1, patch: { status: "PUBLISHED" } })
    .expect(400);
  await request(runtime)
    .post("/api/v1/drafts")
    .set("Authorization", user.bearer)
    .send({ title: "old" })
    .expect(400);
  await request(runtime)
    .patch(`/api/v1/drafts/${op.resourceId}`)
    .set("Authorization", user.bearer)
    .send({ title: "old" })
    .expect(400);
});
test("private pagination never includes other owners and readiness is separate from formal capability", async () => {
  const user = await identity(),
    other = await identity();
  await create(user.bearer, { title: "本人一" });
  await create(user.bearer, { title: "本人二" });
  await create(other.bearer, { title: "他人私人標題" });
  const first = await request(runtime)
    .get("/api/v1/me/listings?limit=1")
    .set("Authorization", user.bearer)
    .expect(200);
  expect(first.headers["cache-control"]).toBe("no-store");
  expect(first.headers["x-request-id"]).toBeTruthy();
  expect(first.body.data.items).toHaveLength(1);
  const second = await request(runtime)
    .get(`/api/v1/me/listings?limit=1&cursor=${first.body.data.nextCursor}`)
    .set("Authorization", user.bearer)
    .expect(200);
  expect(second.body.data.items[0].id).not.toBe(first.body.data.items[0].id);
  expect(JSON.stringify(second.body)).not.toContain("他人私人標題");
  const ready = await request(runtime).get("/api/v1/readiness").expect(200);
  expect(ready.body.data.capabilities.publication).toBe(false);
});

test("unknown first publication remains unknown on lawful republication; closed region still blocks", async () => {
  const user = await identity(),
    a = await complete(user.bearer);
  await fixture.db.listing.update({
    where: { id: a.id },
    data: { publicationHistory: "UNKNOWN" },
  });
  const p = await preview(a.id, user.bearer, a.listing.revision);
  const published = await publish(
    a.id,
    user.bearer,
    a.listing.revision,
    p.id,
  ).expect(200);
  const row = await fixture.db.listing.findUniqueOrThrow({
    where: { id: a.id },
  });
  expect(row.firstPublishedAt).toBeNull();
  expect(row.publicationHistory).toBe("UNKNOWN");
  const publicResult = await request(runtime)
    .get(`/api/v1/listings/${row.publicId}`)
    .expect(200);
  expect(publicResult.body.data.listing).toMatchObject({
    publicationHistory: "UNKNOWN",
    firstPublishedAt: null,
  });
  const archived = await transition(
    a.id,
    user.bearer,
    published.body.data.operation.currentRevision,
    "archive",
  ).expect(200);
  const again = await preview(
    a.id,
    user.bearer,
    archived.body.data.operation.currentRevision,
  );
  await fixture.db.city.update({
    where: { code: "TEST" },
    data: { publicationPolicy: "NOT_OPEN" },
  });
  try {
    const closed = await publish(
      a.id,
      user.bearer,
      again.revision,
      again.id,
    ).expect(409);
    expect(closed.body.error.code).toBe("REGION_NOT_OPEN");
  } finally {
    await fixture.db.city.update({
      where: { code: "TEST" },
      data: { publicationPolicy: "OPEN" },
    });
  }
  expect(
    await fixture.db.listingPublication.count({ where: { listingId: a.id } }),
  ).toBe(0);
});

test("same successful publish can be replayed after later unpublish without republishing", async () => {
  const user = await identity(),
    a = await complete(user.bearer),
    p = await preview(a.id, user.bearer, a.listing.revision),
    key = randomUUID();
  const published = await publish(
    a.id,
    user.bearer,
    a.listing.revision,
    p.id,
    key,
  ).expect(200);
  await transition(
    a.id,
    user.bearer,
    published.body.data.operation.currentRevision,
    "archive",
  ).expect(200);
  const replay = await publish(
    a.id,
    user.bearer,
    a.listing.revision,
    p.id,
    key,
  ).expect(200);
  expect(replay.body).toEqual(published.body);
  expect((await read(a.id, user.bearer)).status).toBe("ARCHIVED");
});

test("two concurrent requests with same key commit one draft and one durable result", async () => {
  const user = await identity(),
    key = randomUUID();
  const [a, b] = await Promise.all([
    create(user.bearer, { title: "同一意圖" }, key),
    create(user.bearer, { title: "同一意圖" }, key.toUpperCase()),
  ]);
  expect(a).toEqual(b);
  expect(
    await fixture.db.contentOperation.count({
      where: { ownerId: user.id, type: "CREATE_LISTING" },
    }),
  ).toBe(1);
});
test("changed plan invalidates preview even when content and public space still match", async () => {
  const user = await identity(),
    a = await complete(user.bearer),
    p = await preview(a.id, user.bearer, a.listing.revision);
  await fixture.db.entitlementPeriod.create({
    data: {
      userId: user.id,
      plan: "BASIC",
      source: "PURCHASE",
      sourceReference: `FIXTURE_${randomUUID()}`,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 3600000),
      confirmedAt: new Date(),
    },
  });
  const response = await publish(
    a.id,
    user.bearer,
    a.listing.revision,
    p.id,
  ).expect(409);
  expect(response.body.error.code).toBe("PREVIEW_STALE");
  expect((await read(a.id, user.bearer)).status).toBe("DRAFT");
});
test("image missing/stale revision cannot mutate, but successful same-key upload replays before stale revision", async () => {
  const user = await identity(),
    op = await create(user.bearer),
    key = randomUUID(),
    path = `/api/v1/drafts/${op.resourceId}/images`;
  const upload = (withRevision: boolean) => {
    const q = request(runtime)
      .post(path)
      .set("Authorization", user.bearer)
      .set("Content-Type", "image/png")
      .set("Idempotency-Key", key)
      .set("X-Image-Rights-Confirmed", "true");
    return withRevision ? q.set("If-Match", '"1"').send(png) : q.send(png);
  };
  await upload(false).expect(400);
  const first = await upload(true).expect(201),
    again = await upload(true).expect(201);
  expect(again.body).toEqual(first.body);
  const id = first.body.data.images[0].id;
  await request(runtime)
    .delete(`${path}/${id}`)
    .set("Authorization", user.bearer)
    .send({ expectedRevision: 1 })
    .expect(409);
  expect(
    await fixture.db.listingMedia.count({
      where: { listingId: op.resourceId },
    }),
  ).toBe(1);
});
test("failure recording the event rolls back content, fee rows, version and operation together", async () => {
  const user = await identity(),
    op = await create(user.bearer, {
      title: "安全舊版",
      feeItems: [
        { kind: "MANAGEMENT", label: "管理費", mode: "NONE", required: true },
      ],
    }),
    key = randomUUID();
  const input = {
    expectedRevision: 1,
    patch: {
      title: "不應部分保存",
      feeItems: [
        {
          kind: "MANAGEMENT",
          label: "管理費",
          mode: "FIXED",
          amount: 1000,
          frequency: "MONTHLY",
          required: true,
        },
      ],
    },
  };
  await fixture.db.$executeRawUnsafe(
    `CREATE FUNCTION test_reject_content_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ONLY_EVENT_FAILURE'; END $$`,
  );
  await fixture.db.$executeRawUnsafe(
    'CREATE TRIGGER test_reject_content_event BEFORE INSERT ON "ContentEvent" FOR EACH ROW EXECUTE FUNCTION test_reject_content_event()',
  );
  try {
    const failed = await request(runtime)
      .patch(`/api/v1/me/listings/${op.resourceId}/work-version`)
      .set("Authorization", user.bearer)
      .set("Idempotency-Key", key)
      .send(input)
      .expect(500);
    expect(JSON.stringify(failed.body)).not.toContain(
      "TEST_ONLY_EVENT_FAILURE",
    );
    const row = await read(op.resourceId, user.bearer);
    expect(row.title).toBe("安全舊版");
    expect(row.revision).toBe(1);
    expect(row.feeItems[0].mode).toBe("NONE");
    expect(
      await fixture.db.contentOperation.count({
        where: { ownerId: user.id, type: "SAVE_LISTING" },
      }),
    ).toBe(0);
  } finally {
    await fixture.db.$executeRawUnsafe(
      'DROP TRIGGER test_reject_content_event ON "ContentEvent"',
    );
    await fixture.db.$executeRawUnsafe(
      "DROP FUNCTION test_reject_content_event()",
    );
  }
  await request(runtime)
    .patch(`/api/v1/me/listings/${op.resourceId}/work-version`)
    .set("Authorization", user.bearer)
    .set("Idempotency-Key", key)
    .send(input)
    .expect(200);
});

test("legacy floor range stays readable but current writes require explicitly selected levels", async () => {
  const user = await identity(),
    op = await create(user.bearer);
  await fixture.db.listing.update({
    where: { id: op.resourceId },
    data: { floorMode: "RANGE", floorFrom: -1, floorTo: 2, totalFloors: 4 },
  });
  await request(runtime)
    .patch(`/api/v1/me/listings/${op.resourceId}/work-version`)
    .set("Authorization", user.bearer)
    .set("Idempotency-Key", randomUUID())
    .send({ expectedRevision: 1, patch: { title: "不影響舊樓層" } })
    .expect(200);
  const invalid = await request(runtime)
    .patch(`/api/v1/me/listings/${op.resourceId}/work-version`)
    .set("Authorization", user.bearer)
    .set("Idempotency-Key", randomUUID())
    .send({ expectedRevision: 2, patch: { totalFloors: 5 } })
    .expect(400);
  expect(invalid.body.error.code).toBe("LEGACY_FLOOR_CONFIRMATION_REQUIRED");
  await request(runtime)
    .patch(`/api/v1/me/listings/${op.resourceId}/work-version`)
    .set("Authorization", user.bearer)
    .set("Idempotency-Key", randomUUID())
    .send({
      expectedRevision: 2,
      patch: { floorMode: "MULTIPLE", floors: [-1, 2] },
    })
    .expect(200);
  const row = await read(op.resourceId, user.bearer);
  expect(row.floors).toEqual([-1, 2]);
  expect(row.floorFrom).toBeNull();
  expect(row.floorTo).toBeNull();
});
test("unexpected private fields in a stored projection fail closed instead of leaking JSON", async () => {
  const user = await identity(),
    a = await complete(user.bearer),
    p = await preview(a.id, user.bearer, a.listing.revision);
  await publish(a.id, user.bearer, a.listing.revision, p.id).expect(200);
  const projection = await fixture.db.listingPublication.findUniqueOrThrow({
    where: { listingId: a.id },
  });
  await fixture.db.listingPublication.update({
    where: { listingId: a.id },
    data: {
      snapshot: {
        ...(projection.snapshot as Record<string, unknown>),
        privateAddress: "MUST_NOT_LEAK",
      },
    },
  });
  const response = await request(runtime)
    .get(`/api/v1/listings/${projection.publicId}`)
    .expect(503);
  expect(response.body.error.code).toBe("PUBLIC_PROJECTION_INVALID");
  expect(JSON.stringify(response.body)).not.toContain("MUST_NOT_LEAK");
});

test("STOP_NEW preserves existing public detail but blocks archived republication; NOT_OPEN hides public output", async () => {
  const user = await identity(),
    a = await complete(user.bearer),
    p = await preview(a.id, user.bearer, a.listing.revision);
  const published = await publish(
    a.id,
    user.bearer,
    a.listing.revision,
    p.id,
  ).expect(200);
  const row = await read(a.id, user.bearer);
  await fixture.db.city.update({
    where: { code: "TEST" },
    data: { publicationPolicy: "STOP_NEW" },
  });
  try {
    await request(runtime).get(`/api/v1/listings/${row.publicId}`).expect(200);
    const archived = await transition(
      a.id,
      user.bearer,
      published.body.data.operation.currentRevision,
      "archive",
    ).expect(200);
    const again = await preview(
      a.id,
      user.bearer,
      archived.body.data.operation.currentRevision,
    );
    const blocked = await publish(
      a.id,
      user.bearer,
      again.revision,
      again.id,
    ).expect(409);
    expect(blocked.body.error.code).toBe("REGION_NOT_OPEN");
  } finally {
    await fixture.db.city.update({
      where: { code: "TEST" },
      data: { publicationPolicy: "OPEN" },
    });
  }
  const current = await read(a.id, user.bearer),
    newPreview = await preview(a.id, user.bearer, current.revision);
  await publish(a.id, user.bearer, current.revision, newPreview.id).expect(200);
  await fixture.db.city.update({
    where: { code: "TEST" },
    data: { publicationPolicy: "NOT_OPEN" },
  });
  try {
    await request(runtime).get(`/api/v1/listings/${row.publicId}`).expect(404);
  } finally {
    await fixture.db.city.update({
      where: { code: "TEST" },
      data: { publicationPolicy: "OPEN" },
    });
  }
});
