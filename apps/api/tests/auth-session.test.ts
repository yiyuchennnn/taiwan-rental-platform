import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { seedAdministrativeData } from "../prisma/seed-data.js";
import express from "express";
import request from "supertest";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { beforeAll, afterAll, expect, test } from "vitest";
import { createAuthRouter } from "../src/modules/auth/auth.router-factory.js";
import { createSessionService, sessionLifetimeSeconds } from "../src/modules/auth/session.service.js";
import { requireAuth } from "../src/modules/auth/require-auth.js";
import { requireListingOwner } from "../src/modules/listings/require-listing-owner.js";
import { createDraftRouter } from "../src/modules/listings/draft.routes.js";
import { createDraftService } from "../src/modules/listings/draft.service.js";
import { resolveCurrentEntitlement } from "../src/modules/entitlements/entitlement.service.js";
import { planCatalog } from "../src/modules/entitlements/plan-catalog.js";

// Dedicated disposable Unix-socket cluster. Never read .env or DATABASE_URL.
const root = mkdtempSync(join(tmpdir(), "rental-auth-"));
let started = false;
let orm: PrismaClient;
const app = express();
const password = "TestOnlyPassword123!";
let ownerId: string;
let otherId: string;
let listingId: string;
let ownerToken: string;
let otherToken: string;
const run = (name: string, args: string[]) => execFileSync(name, args, { stdio: "pipe" });

beforeAll(async () => {
  run("initdb", ["-D", join(root, "pg"), "-A", "trust", "-U", "postgres", "--no-locale", "-E", "UTF8"]);
  run("pg_ctl", ["-D", join(root, "pg"), "-l", join(root, "server.log"), "-o", `-F -k ${root} -c listen_addresses=''`, "-w", "start"]);
  started = true;
  const db = new Client({ host: root, database: "postgres", user: "postgres" });
  await db.connect();
  try {
    const migrations = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
    for (const dir of readdirSync(migrations).filter(name => /^\d/.test(name)).sort()) {
      await db.query(readFileSync(join(migrations, dir, "migration.sql"), "utf8"));
    }
  } finally { await db.end(); }
  orm = new PrismaClient({ adapter: new PrismaPg({ host: root, database: "postgres", user: "postgres" }) });
  await orm.city.createMany({ data: [{ code: "66", name: "測試臺中" }, { code: "63", name: "測試臺北" }] });
  await orm.district.createMany({ data: [
    { cityCode: "66", code: "01", name: "測試中區" }, { cityCode: "66", code: "02", name: "測試東區" },
    { cityCode: "63", code: "01", name: "測試北區" },
  ] });
  app.use(express.json());
  app.use("/api/v1/auth", createAuthRouter(orm, 3600));
  app.use("/api/v1/drafts", createDraftRouter(orm));
  // Explicit test-only policy fixtures. Never wire these into the production app.
  app.use("/test/drafts", createDraftRouter(orm, async () => ({ draftLimit: 1, archiveCreation: "ALLOWED" })));
  app.use("/test/blocked-drafts", createDraftRouter(orm, async () => ({ draftLimit: -1 })));
  app.use("/test/unresolved-drafts", createDraftRouter(orm, async () => ({ draftLimit: Number.NaN })));
  // Test-only integration route exercises the actual middleware, not a shipped API.
  app.get("/test/listings/:id", requireAuth(createSessionService(orm, 3600)), requireListingOwner(orm), (_req, res) => res.json({ id: res.locals.listingId }));
  ownerId = (await request(app).post("/api/v1/auth/register").send({ email: "owner@example.test", password, role: "ADMIN" }).expect(201)).body.data.user.id;
  otherId = (await request(app).post("/api/v1/auth/register").send({ email: "other@example.test", password }).expect(201)).body.data.user.id;
  const listing = await orm.listing.create({ data: { publisherId: ownerId } });
  listingId = listing.id;
  ownerToken = (await request(app).post("/api/v1/auth/login").send({ email: "owner@example.test", password }).expect(200)).body.data.accessToken;
  otherToken = (await request(app).post("/api/v1/auth/login").send({ email: "other@example.test", password }).expect(200)).body.data.accessToken;
}, 30000);

afterAll(async () => {
  try { if (orm) await orm.$disconnect(); }
  finally {
    if (started) run("pg_ctl", ["-D", join(root, "pg"), "-m", "immediate", "-w", "stop"]);
    rmSync(root, { recursive: true, force: true });
  }
});

test("login issues opaque credentials and persists only the digest", async () => {
  const result = await request(app).post("/api/v1/auth/login").send({ email: "owner@example.test", password }).expect(200);
  const { accessToken, user, expiresAt } = result.body.data;
  expect(accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(user.role).toBe("RENTER");
  expect(user).not.toHaveProperty("passwordHash");
  expect(result.body.data).not.toHaveProperty("tokenHash");
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(result.headers["set-cookie"]).toBeUndefined();
  const stored = await orm.authSession.findUniqueOrThrow({ where: { tokenHash: createHash("sha256").update(accessToken).digest("hex") } });
  expect(stored.tokenHash).not.toBe(accessToken);
  expect(stored.expiresAt.toISOString()).toBe(expiresAt);
  expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(3600000);
});
test("bearer identity is server-derived and ignores forged identity fields", async () => {
  const response = await request(app).get(`/api/v1/auth/me?userId=${otherId}`).set("X-User-Id", otherId).set("Authorization", `Bearer ${ownerToken}`).expect(200);
  expect(response.body.data.user.id).toBe(ownerId);
  expect(response.body.data.user).not.toHaveProperty("isActive");
});
test.each(["", "Bearer invalid", "Basic abc"])("rejects missing or malformed credential %s", async authorization => {
  await request(app).get("/api/v1/auth/me").set("Authorization", authorization).set("X-User-Id", ownerId).expect(401);
});
test("a well-formed invented token is not authenticated", async () => {
  await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${"A".repeat(43)}`).expect(401);
});
test("wrong password and unknown email do not create sessions", async () => {
  const before = await orm.authSession.count();
  for (const email of ["owner@example.test", "unknown@example.test"]) {
    await request(app).post("/api/v1/auth/login").send({ email, password: "wrong" }).expect(401);
  }
  expect(await orm.authSession.count()).toBe(before);
});
test("logout revokes the current token without logging out other sessions", async () => {
  const fresh = (await request(app).post("/api/v1/auth/login").send({ email: "owner@example.test", password }).expect(200)).body.data.accessToken;
  await request(app).post("/api/v1/auth/logout").set("Authorization", `Bearer ${fresh}`).expect(204);
  await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${fresh}`).expect(401);
  await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${ownerToken}`).expect(200);
});
test("expired session is refused", async () => {
  const session = await createSessionService(orm, 3600).create(ownerId);
  await orm.authSession.update({ where: { tokenHash: createHash("sha256").update(session.token).digest("hex") },
    data: { createdAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000) } });
  await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${session.token}`).expect(401);
});
test("disabled accounts cannot log in or use previously issued sessions", async () => {
  await orm.user.update({ where: { id: otherId }, data: { isActive: false } });
  try {
    await request(app).post("/api/v1/auth/login").send({ email: "other@example.test", password }).expect(401);
    await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${otherToken}`).expect(401);
    await expect(createSessionService(orm, 3600).create(otherId)).rejects.toThrow();
  } finally { await orm.user.update({ where: { id: otherId }, data: { isActive: true } }); }
});
test("only the authenticated publisher can access the listing gate", async () => {
  await request(app).get(`/test/listings/${listingId}`).set("Authorization", `Bearer ${ownerToken}`).expect(200);
  const foreign = await request(app).get(`/test/listings/${listingId}?publisherId=${ownerId}`).set("X-User-Id", ownerId).set("Authorization", `Bearer ${otherToken}`).expect(404);
  const missing = await request(app).get("/test/listings/nonexistent").set("Authorization", `Bearer ${otherToken}`).expect(404);
  expect(foreign.body).toEqual(missing.body);
  await request(app).get(`/test/listings/${listingId}`).expect(401);
});
test("admin role alone does not grant management over another publisher's listing", async () => {
  await orm.user.update({ where: { id: otherId }, data: { role: "ADMIN" } });
  try { await request(app).get(`/test/listings/${listingId}`).set("Authorization", `Bearer ${otherToken}`).expect(404); }
  finally { await orm.user.update({ where: { id: otherId }, data: { role: "RENTER" } }); }
});
test("invalid input returns a field error and lifetime configuration fails closed", async () => {
  await request(app).post("/api/v1/auth/login").send({}).expect(400);
  expect(sessionLifetimeSeconds("3600")).toBe(3600);
  for (const invalid of ["", "-1", "0", "NaN", "1.5", "99999999999999999999"]) {
    expect(() => sessionLifetimeSeconds(invalid)).toThrow();
  }
});

async function draftIdentity() {
  const user = await orm.user.create({ data: { email: `${randomUUID()}@example.test` } });
  const sessions = createSessionService(orm, 3600);
  const { token } = await sessions.create(user.id);
  const auth = await sessions.authenticate(token);
  if (!auth) throw new Error("Test authentication failed");
  return { user, token, auth };
}

test("incomplete draft creation uses server identity and requires no publication fields", async () => {
  const { token, user } = await draftIdentity();
  const response = await request(app).post("/test/drafts").set("Authorization", `Bearer ${token}`).send({}).expect(201);
  expect(response.body.data.draft).toMatchObject({ title: null, rent: null, rentalType: null, status: "DRAFT" });
  expect(response.body.data.draft).not.toHaveProperty("publisherId");
  const saved = await orm.listing.findUniqueOrThrow({ where: { id: response.body.data.draft.id } });
  expect(saved.publisherId).toBe(user.id);
  expect(saved.propertyId).toBeNull();
});
test("default creation is unavailable without real entitlements and does not guess everyone is free", async () => {
  const { token, user } = await draftIdentity();
  const response = await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({}).expect(503);
  expect(response.body.error.code).toBe("DRAFT_ENTITLEMENTS_UNAVAILABLE");
  expect(await orm.listing.count({ where: { publisherId: user.id } })).toBe(0);
});
test("concurrent creation cannot consume the last quota twice", async () => {
  const { token, user } = await draftIdentity();
  const create = () => request(app).post("/test/drafts").set("Authorization", `Bearer ${token}`).send({ title: "draft" });
  const results = await Promise.all([create(), create()]);
  expect(results.map(result => result.status).sort()).toEqual([201, 409]);
  expect(await orm.listing.count({ where: { publisherId: user.id } })).toBe(1);
});
test("invalid trusted quota facts cannot silently allow creation", async () => {
  const { token, user } = await draftIdentity();
  await request(app).post("/test/blocked-drafts").set("Authorization", `Bearer ${token}`).send({}).expect(503);
  await request(app).post("/test/unresolved-drafts").set("Authorization", `Bearer ${token}`).send({}).expect(503);
  expect(await orm.listing.count({ where: { publisherId: user.id } })).toBe(0);
});
test("PATCH preserves omitted fields, zero/false, and allows explicit null without forcing completeness", async () => {
  const { token, user } = await draftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id, title: "retain", description: "old", rent: 12000, areaType: "legacy" } });
  const response = await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`)
    .send({ description: null, rent: 0, hasElevator: false }).expect(200);
  expect(response.body.data.draft).toMatchObject({ title: "retain", description: null, rent: 0, hasElevator: false });
  expect(response.body.data.draft.areaType).toBe("legacy");
  expect((await orm.listing.findUniqueOrThrow({ where: { id: row.id } })).areaType).toBe("legacy");
  await request(app).get(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).expect(200);
});
test.each(["publisherId", "status", "role", "propertyId", "firstPublishedAt", "exactAddressConsentAt", "equipmentConfirmedAt", "plan"])("rejects protected or unsupported field %s", async field => {
  await request(app).patch(`/api/v1/drafts/${listingId}`).set("Authorization", `Bearer ${ownerToken}`).send({ [field]: "forged" }).expect(400);
});
test("foreign draft and missing draft produce the same response and cannot be changed", async () => {
  const foreign = await request(app).patch(`/api/v1/drafts/${listingId}`).set("Authorization", `Bearer ${otherToken}`).send({ title: "overwrite" }).expect(404);
  const missing = await request(app).get("/api/v1/drafts/nonexistent").set("Authorization", `Bearer ${otherToken}`).expect(404);
  expect(foreign.body).toEqual(missing.body);
  expect((await orm.listing.findUniqueOrThrow({ where: { id: listingId } })).title).toBeNull();
});
test("non-draft records cannot be edited or returned by draft endpoints", async () => {
  const { token, user } = await draftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id, status: "ARCHIVED", archiveReason: "MANUAL" } });
  await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ title: "wrong" }).expect(409);
  await request(app).get(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).expect(409);
});
test("editing existing over-quota drafts does not require a creation entitlement", async () => {
  const { token, user } = await draftIdentity();
  const rows = await Promise.all([1, 2].map(() => orm.listing.create({ data: { publisherId: user.id } })));
  await request(app).patch(`/api/v1/drafts/${rows[0]!.id}`).set("Authorization", `Bearer ${token}`).send({ title: "still editable" }).expect(200);
});
test("revocation after initial authentication prevents the transactional write", async () => {
  const { auth, user } = await draftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id } });
  await createSessionService(orm, 3600).revoke(auth.sessionId);
  await expect(createDraftService(orm).patch(auth, row.id, { title: "must not persist" })).rejects.toMatchObject({ status: 401 });
  expect((await orm.listing.findUniqueOrThrow({ where: { id: row.id } })).title).toBeNull();
});
test("logout serializes with the account lock used by authenticated writes", async () => {
  const { auth, user } = await draftIdentity();
  let release!: () => void, acquired!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const unblock = new Promise<void>(resolve => { release = resolve; });
  const held = orm.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    acquired(); await unblock;
  });
  await ready;
  let completed = false, blocked = false;
  const logout = createSessionService(orm, 3600).revoke(auth.sessionId).then(() => { completed = true; });
  try {
    for (let i = 0; i < 100 && !completed; i++) {
      const result = await orm.$queryRaw<{ blocked: number }[]>`SELECT count(*)::int AS blocked FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE ${'%SELECT "userId" FROM "AuthSession"%'}`;
      if (result[0]!.blocked > 0) { blocked = true; break; }
      await delay(10);
    }
    expect(blocked).toBe(true); expect(completed).toBe(false);
  } finally { release(); await held; await logout; }
  expect((await orm.authSession.findUniqueOrThrow({ where: { id: auth.sessionId } })).revokedAt).not.toBeNull();
});
test("administrative seed is repeatable and never chooses or resets launch areas", async () => {
  const cities = JSON.parse(readFileSync(fileURLToPath(new URL("../prisma/data/taiwan-districts.json", import.meta.url)), "utf8"));
  expect(await seedAdministrativeData(orm, cities)).toEqual({ cities: 22, districts: 368 });
  const codes = cities.map((city: { code: string }) => city.code);
  expect(await orm.city.count({ where: { code: { in: codes }, isEnabled: true } })).toBe(0);
  const selected = codes[0]!;
  await orm.city.update({ where: { code: selected }, data: { isEnabled: true } });
  await seedAdministrativeData(orm, cities);
  expect((await orm.city.findUniqueOrThrow({ where: { code: selected } })).isEnabled).toBe(true);
  expect(await orm.city.count({ where: { code: { in: codes } } })).toBe(22);
  const invalid = structuredClone(cities); invalid[0].districts.push(invalid[0].districts[0]);
  await expect(seedAdministrativeData(orm, invalid)).rejects.toThrow("Duplicate administrative data");
});
test("ownership and state are checked in the write transaction rather than trusting a previous gate", async () => {
  const { auth, user } = await draftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id } });
  await orm.listing.update({ where: { id: row.id }, data: { publisherId: otherId } });
  await expect(createDraftService(orm).patch(auth, row.id, { title: "no" })).rejects.toMatchObject({ status: 404 });
});
test("mode changes clear stale values while incomplete choices remain saveable", async () => {
  const { token, user } = await draftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id, depositMode: "FIXED", deposit: 12000, occupancyMode: "DATE", availableFrom: new Date("2026-12-01") } });
  await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ depositMode: "MONTHS", occupancyMode: "IMMEDIATE" }).expect(200);
  const saved = await orm.listing.findUniqueOrThrow({ where: { id: row.id } });
  expect(saved.deposit).toBeNull(); expect(saved.depositMonths).toBeNull(); expect(saved.availableFrom).toBeNull();
  await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ deposit: 50 }).expect(400);
});
test("invalid precision or contradictions roll back the entire patch", async () => {
  const { token, user } = await draftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id, title: "retain", balconyMode: "NONE" } });
  for (const patch of [{ title: "lost", areaPings: 0.00001 }, { title: "lost", sharedSpaces: ["BALCONY"] }]) {
    await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send(patch).expect(400);
  }
  expect((await orm.listing.findUniqueOrThrow({ where: { id: row.id } })).title).toBe("retain");
});

test("concurrent partial edits preserve unrelated fields instead of replacing the whole draft", async () => {
  const { token, user } = await draftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id, title: "old", description: "old" } });
  const results = await Promise.all([
    request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ title: "new title" }),
    request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ description: "new description" }),
  ]);
  expect(results.map(result => result.status)).toEqual([200, 200]);
  expect(await orm.listing.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ title: "new title", description: "new description" });
});

test("changing floor or balcony mode does not invent new answers from the previous mode", async () => {
  const { token, user } = await draftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id, floorMode: "SINGLE", floorFrom: 2, balconyMode: "NONE", balconies: 0 } });
  await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`)
    .send({ floorMode: "RANGE", balconyMode: "PRIVATE" }).expect(200);
  expect(await orm.listing.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ floorMode: "RANGE", floorFrom: null, floorTo: null, balconyMode: "PRIVATE", balconies: null });
});

test("registered accounts have a server-recorded free baseline, legacy missing records stay unknown", async () => {
  const free = await resolveCurrentEntitlement(orm, ownerId);
  expect(free).toMatchObject({ status: "READY", plan: "FREE", quotas: { draftListings: 3 } });
  const { user } = await draftIdentity();
  expect(await resolveCurrentEntitlement(orm, user.id)).toMatchObject({ status: "UNAVAILABLE", reason: "ACCOUNT_NOT_RECONCILED" });
});

async function entitlementFixture() {
  const { user } = await draftIdentity();
  await orm.entitlementAccount.create({ data: { userId: user.id, provenance: "TEST_FIXTURE", verifiedAt: new Date("2026-01-01") } });
  return user.id;
}
const evaluation = new Date("2026-11-02T12:00:00.000Z");
const periodFixture = (userId: string) => ({ userId, plan: "BASIC" as const, source: "PURCHASE" as const, sourceReference: randomUUID(),
  startsAt: new Date("2026-11-01"), endsAt: new Date("2026-12-01"), confirmedAt: new Date("2026-11-01") });

test.each(["BASIC", "ADVANCED", "FLAGSHIP"] as const)("confirmed %s facts resolve the exact published quotas", async plan => {
  const userId = await entitlementFixture();
  await orm.entitlementPeriod.create({ data: { ...periodFixture(userId), plan } });
  expect(await resolveCurrentEntitlement(orm, userId, evaluation)).toEqual({ status: "READY", plan, quotas: planCatalog[plan].quotas });
});
test("confirmed gift rights do not require inventing a payment", async () => {
  const userId = await entitlementFixture();
  await orm.entitlementPeriod.create({ data: { ...periodFixture(userId), source: "GIFT" } });
  expect(await resolveCurrentEntitlement(orm, userId, evaluation)).toMatchObject({ status: "READY", plan: "BASIC" });
});
test("period starts are inclusive and ends exclusive; future gifts do not activate early", async () => {
  const userId = await entitlementFixture();
  await orm.entitlementPeriod.create({ data: periodFixture(userId) });
  expect(await resolveCurrentEntitlement(orm, userId, new Date("2026-10-31"))).toMatchObject({ plan: "FREE" });
  expect(await resolveCurrentEntitlement(orm, userId, new Date("2026-11-01"))).toMatchObject({ plan: "BASIC" });
  expect(await resolveCurrentEntitlement(orm, userId, new Date("2026-12-01"))).toMatchObject({ plan: "FREE" });
});
test("unconfirmed active sources do not silently grant paid rights or downgrade to free", async () => {
  const userId = await entitlementFixture();
  await orm.entitlementPeriod.create({ data: { ...periodFixture(userId), confirmedAt: null } });
  expect(await resolveCurrentEntitlement(orm, userId, evaluation)).toMatchObject({ status: "UNAVAILABLE", reason: "SOURCE_NOT_CONFIRMED" });
});
test("different-grade overlap is unresolved; same-grade records never add quotas", async () => {
  const userId = await entitlementFixture();
  await orm.entitlementPeriod.create({ data: periodFixture(userId) });
  await orm.entitlementPeriod.create({ data: { ...periodFixture(userId), source: "GIFT" } });
  expect(await resolveCurrentEntitlement(orm, userId, evaluation)).toMatchObject({ status: "READY", quotas: { draftListings: 30 } });
  await orm.entitlementPeriod.create({ data: { ...periodFixture(userId), plan: "ADVANCED" } });
  expect(await resolveCurrentEntitlement(orm, userId, evaluation)).toMatchObject({ status: "UNAVAILABLE", reason: "OVERLAPPING_DIFFERENT_PLANS" });
});
test("revoking one fact preserves another valid source and duplicate evidence cannot be recorded twice", async () => {
  const userId = await entitlementFixture();
  const source = periodFixture(userId);
  const record = await orm.entitlementPeriod.create({ data: source });
  await expect(orm.entitlementPeriod.create({ data: source })).rejects.toMatchObject({ code: "P2002" });
  await orm.entitlementPeriod.create({ data: { ...periodFixture(userId), source: "GIFT" } });
  await orm.entitlementPeriod.update({ where: { id: record.id }, data: { revokedAt: evaluation } });
  expect(await resolveCurrentEntitlement(orm, userId, evaluation)).toMatchObject({ status: "READY", plan: "BASIC" });
});
test("plan catalog preserves confirmed prices, separate quotas and finite flagship public listings", () => {
  expect(Object.values(planCatalog).map(plan => plan.price)).toEqual([
    { monthly: 0, quarterly: null, yearly: null }, { monthly: 199, quarterly: null, yearly: null },
    { monthly: 399, quarterly: null, yearly: null }, { monthly: 749, quarterly: 1798, yearly: 6292 },
  ]);
  expect(planCatalog.FLAGSHIP.quotas).toEqual({ publicListings: 300, draftListings: 300, archivedListings: 1000, publicArticles: 100, draftArticles: 100, archivedArticles: 300 });
});

async function readyDraftIdentity() {
  const identity = await draftIdentity();
  await orm.entitlementAccount.create({ data: { userId: identity.user.id, provenance: "TEST_FIXTURE", verifiedAt: new Date(0) } });
  return identity;
}

test("production draft route uses a trusted free baseline, not a test quota callback", async () => {
  const response = await request(app).post("/api/v1/auth/register").send({ email: `${randomUUID()}@example.test`, password }).expect(201);
  const email = response.body.data.user.email;
  const token = (await request(app).post("/api/v1/auth/login").send({ email, password }).expect(200)).body.data.accessToken;
  await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({}).expect(201);
  await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({}).expect(201);
  await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({}).expect(201);
  const full = await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({}).expect(409);
  expect(full.body.error.code).toBe("DRAFT_QUOTA_EXCEEDED");
});
test.each([9, 10, 11])("C01 archive count %i does not consume draft slots", async count => {
  const { token, user } = await readyDraftIdentity();
  await orm.listing.createMany({ data: Array.from({ length: count }, () => ({ publisherId: user.id, status: "ARCHIVED" as const })) });
  await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({}).expect(201);
  expect(await orm.listing.count({ where: { publisherId: user.id, status: "ARCHIVED" } })).toBe(count);
});
test("C01 archive overflow preserves existing drafts and allows another available draft slot", async () => {
  const { token, user } = await readyDraftIdentity();
  await orm.listing.createMany({ data: Array.from({ length: 11 }, () => ({ publisherId: user.id, status: "ARCHIVED" as const })) });
  const draft = await orm.listing.create({ data: { publisherId: user.id, title: "retain" } });
  await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({}).expect(201);
  await request(app).patch(`/api/v1/drafts/${draft.id}`).set("Authorization", `Bearer ${token}`).send({ title: "editable" }).expect(200);
  expect(await orm.listing.count({ where: { publisherId: user.id } })).toBe(13);
});
test("historical unpublished content is preserved without consuming draft slots", async () => {
  const { token, user } = await readyDraftIdentity();
  const legacy = await orm.listing.create({ data: { publisherId: user.id, status: "UNPUBLISHED" } });
  await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({}).expect(201);
  expect(await orm.listing.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(legacy);
});
test("trusted BASIC facts determine draft limit without adding gift quotas", async () => {
  const { token, user } = await readyDraftIdentity();
  const now = new Date();
  await orm.entitlementPeriod.create({ data: { ...periodFixture(user.id), startsAt: new Date(now.getTime() - 60000), endsAt: new Date(now.getTime() + 3600000), confirmedAt: new Date(now.getTime() - 60000) } });
  await orm.listing.createMany({ data: Array.from({ length: 29 }, () => ({ publisherId: user.id })) });
  await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({}).expect(201);
  const result = await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({}).expect(409);
  expect(result.body.error.code).toBe("DRAFT_QUOTA_EXCEEDED");
});
test("concurrent creation through actual entitlement policy cannot overshoot the last free slot", async () => {
  const { token, user } = await readyDraftIdentity();
  await orm.listing.createMany({ data: [{ publisherId: user.id }, { publisherId: user.id }] });
  const create = () => request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({});
  const responses = await Promise.all([create(), create()]);
  expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
  expect(await orm.listing.count({ where: { publisherId: user.id, status: "DRAFT" } })).toBe(3);
});

test("address can be saved incompletely and never creates a fake shared property", async () => {
  const { token, user } = await readyDraftIdentity();
  const created = await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({ address: { cityCode: "66" } }).expect(201);
  expect(created.body.data.draft).toMatchObject({ addressSource: "DRAFT_COPY", address: { cityCode: "66", districtCode: null, addressLine: null } });
  const row = await orm.listing.findUniqueOrThrow({ where: { id: created.body.data.draft.id } });
  expect(row.publisherId).toBe(user.id); expect(row.propertyId).toBeNull();
  await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ address: { districtCode: "01", addressLine: "測試路1號" } }).expect(200);
  expect(await orm.draftAddress.findUniqueOrThrow({ where: { listingId: row.id } })).toMatchObject({ cityCode: "66", districtCode: "01", addressLine: "測試路1號" });
});
test("editing one draft copies the linked address without changing shared property or another publisher", async () => {
  const { token, user } = await readyDraftIdentity();
  const property = await orm.property.create({ data: { cityCode: "66", districtCode: "01", addressLine: "原路1號", roomNumber: "A", createdById: otherId, latitude: 24.1234567, longitude: 120.1234567 } });
  const row = await orm.listing.create({ data: { publisherId: user.id, propertyId: property.id } });
  const peer = await orm.listing.create({ data: { publisherId: otherId, propertyId: property.id } });
  const before = await request(app).get(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).expect(200);
  expect(before.body.data.draft.addressSource).toBe("LINKED_PROPERTY");
  expect(before.body.data.draft).not.toHaveProperty("latitude");
  expect(before.body.data.draft.address).not.toHaveProperty("latitude");
  const edited = await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ address: { roomNumber: "B" } }).expect(200);
  expect(edited.body.data.draft).toMatchObject({ addressSource: "DRAFT_COPY", address: { cityCode: "66", districtCode: "01", addressLine: "原路1號", roomNumber: "B" } });
  expect(await orm.property.findUniqueOrThrow({ where: { id: property.id } })).toEqual(property);
  const unchanged = await request(app).get(`/api/v1/drafts/${peer.id}`).set("Authorization", `Bearer ${otherToken}`).expect(200);
  expect(unchanged.body.data.draft.address.roomNumber).toBe("A");
  expect(unchanged.body.data.draft.addressSource).toBe("LINKED_PROPERTY");
});
test("clearing working address does not fall back to the old property or erase it", async () => {
  const { token, user } = await readyDraftIdentity();
  const property = await orm.property.create({ data: { cityCode: "66", districtCode: "01", addressLine: "原址", createdById: user.id } });
  const row = await orm.listing.create({ data: { publisherId: user.id, propertyId: property.id } });
  const response = await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ address: null }).expect(200);
  expect(response.body.data.draft).toMatchObject({ addressSource: "DRAFT_COPY", address: { cityCode: null, districtCode: null, addressLine: null, roomNumber: null, communityName: null } });
  expect((await orm.listing.findUniqueOrThrow({ where: { id: row.id } })).propertyId).toBe(property.id);
  expect(await orm.property.findUniqueOrThrow({ where: { id: property.id } })).toEqual(property);
});
test("changing city clears an omitted previous district even when its code exists in the new city", async () => {
  const { token, user } = await readyDraftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id, draftAddress: { create: { cityCode: "66", districtCode: "01", addressLine: "街名待核對" } } } });
  const response = await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ address: { cityCode: "63" } }).expect(200);
  expect(response.body.data.draft.address).toMatchObject({ cityCode: "63", districtCode: null, addressLine: "街名待核對" });
});
test("invalid district-city pair rejects all address and text changes in the same transaction", async () => {
  const { token, user } = await readyDraftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id, title: "retain", draftAddress: { create: { cityCode: "66", districtCode: "01" } } } });
  const response = await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ title: "must rollback", address: { cityCode: "63", districtCode: "02" } }).expect(400);
  expect(response.body.error.details[0].path).toBe("address.districtCode");
  expect((await orm.listing.findUniqueOrThrow({ where: { id: row.id } })).title).toBe("retain");
  expect(await orm.draftAddress.findUniqueOrThrow({ where: { listingId: row.id } })).toMatchObject({ cityCode: "66", districtCode: "01" });
});
test("invalid address creation rolls back the listing and does not consume a draft slot", async () => {
  const { token, user } = await readyDraftIdentity();
  await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({ address: { cityCode: "invalid" } }).expect(400);
  expect(await orm.listing.count({ where: { publisherId: user.id } })).toBe(0);
  await request(app).post("/api/v1/drafts").set("Authorization", `Bearer ${token}`).send({ address: { districtCode: "01" } }).expect(201);
});
test.each(["latitude", "longitude", "listingId", "propertyId"])("does not accept client-controlled address authority field %s", async key => {
  await request(app).patch(`/api/v1/drafts/${listingId}`).set("Authorization", `Bearer ${ownerToken}`).send({ address: { [key]: "forged" } }).expect(400);
});
test("empty address patch is a no-op and foreign address cannot be read or written", async () => {
  const { token, user } = await readyDraftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id } });
  await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ address: {} }).expect(200);
  expect((await orm.listing.findUniqueOrThrow({ where: { id: row.id } })).updatedAt).toEqual(row.updatedAt);
  expect(await orm.draftAddress.findUnique({ where: { listingId: row.id } })).toBeNull();
  await request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${otherToken}`).send({ address: { addressLine: "overwrite" } }).expect(404);
  await request(app).get(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${otherToken}`).expect(404);
});
test("concurrent address patches preserve different fields in the working copy", async () => {
  const { token, user } = await readyDraftIdentity();
  const row = await orm.listing.create({ data: { publisherId: user.id } });
  const results = await Promise.all([
    request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ address: { addressLine: "測試路" } }),
    request(app).patch(`/api/v1/drafts/${row.id}`).set("Authorization", `Bearer ${token}`).send({ address: { roomNumber: "A" } }),
  ]);
  expect(results.map(response => response.status)).toEqual([200, 200]);
  expect(await orm.draftAddress.findUniqueOrThrow({ where: { listingId: row.id } })).toMatchObject({ addressLine: "測試路", roomNumber: "A" });
});
