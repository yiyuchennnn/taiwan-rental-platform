import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { publicationDetailsToStorage, publicationDetailsFromStorage } from "../src/modules/listings/publication-details-storage.js";

// Always create our own database cluster. Never read DATABASE_URL or project .env.
// Requires initdb / pg_ctl on PATH; missing binaries fail rather than skip tests.
const migrations = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
const alignment = "20261101000100_align_confirmed_listing_models";
const root = mkdtempSync(join(tmpdir(), "rental-model-"));
const data = join(root, "pg");
let started = false;
let db: Client;
let upgraded = false;

function bin(name: string, args: string[]) {
  return execFileSync(name, args, { encoding: "utf8", stdio: "pipe" });
}
function sql(file: string) {
  return readFileSync(join(migrations, file, "migration.sql"), "utf8");
}
async function listing(id: string) {
  await db.query('INSERT INTO "Listing" (id, "publisherId", "updatedAt") VALUES ($1, $2, NOW())', [id, "owner"]);
}
async function reject(query: string, values: unknown[], code: string) {
  await expect(db.query(query, values)).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  bin("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "--no-locale", "-E", "UTF8"]);
  // No TCP listener; private temporary directory contains the Unix socket.
  bin("pg_ctl", ["-D", data, "-l", join(root, "server.log"), "-o", `-F -k ${root} -c listen_addresses=''`, "-w", "start"]);
  started = true;
  db = new Client({ host: root, database: "postgres", user: "postgres", port: 5432 });
  await db.connect();
  for (const dir of readdirSync(migrations).filter(x => /^\d/.test(x) && x < alignment).sort()) {
    await db.query(sql(dir));
  }
  // Fixtures represent existing data at the CURRENT schema, not at an old abandoned schema.
  await db.query(`
    INSERT INTO "User" (id, email, "updatedAt") VALUES ('owner', 'owner@example.test', NOW()), ('other', 'other@example.test', NOW());
    INSERT INTO "City" (code, name) VALUES ('66', '臺中市');
    INSERT INTO "District" (code, name, "cityCode") VALUES ('01', '中區', '66');
    INSERT INTO "Property" (id, "cityCode", "districtCode", "addressLine", floor, "roomNumber", "createdById", "updatedAt")
      VALUES ('house', '66', '01', '測試路1號', -1, 'A', 'owner', NOW());
    INSERT INTO "Listing" (id, title, rent, "propertyId", "publisherId", status, "publishedAt", "updatedAt")
      VALUES ('legacy', '原刊登', 12000, 'house', 'owner', 'PUBLISHED', '2026-10-01', NOW());
    INSERT INTO "ListingMedia" (id, url, "listingId", "isCover") VALUES ('old-photo', 'https://example.test/old.jpg', 'legacy', true);
  `);
  await db.query(sql(alignment));
  for (const dir of readdirSync(migrations).filter(x => /^\d/.test(x) && x > alignment).sort()) await db.query(sql(dir));
  upgraded = true;
}, 30000);

afterAll(async () => {
  try { if (db) await db.end(); }
  finally {
    if (started) bin("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration preserves existing listing, precise address, owner and photo without inventing first publication", async () => {
  expect(upgraded).toBe(true);
  const { rows: [row] } = await db.query(`SELECT l.title, l.rent, l."publisherId", l."firstPublishedAt", l."publishedAt"::text AS "publishedAt", p."addressLine", p.floor, m.url FROM "Listing" l JOIN "Property" p ON l."propertyId"=p.id JOIN "ListingMedia" m ON m."listingId"=l.id WHERE l.id='legacy'`);
  expect(row).toMatchObject({ title: "原刊登", rent: 12000, publisherId: "owner", firstPublishedAt: null, addressLine: "測試路1號", floor: -1, url: "https://example.test/old.jpg" });
  expect(row.publishedAt).toBe("2026-10-01 00:00:00");
});

test("draft can exist with only publisher, and accept photos before address and rent", async () => {
  await listing("incomplete");
  await db.query(`INSERT INTO "ListingMedia" (id, url, "listingId") VALUES ('draft-photo', 'https://example.test/draft.jpg', 'incomplete')`);
  const { rows: [row] } = await db.query(`SELECT title, rent, "propertyId", status, "hasElevator", "petsAllowed", "waterBilling", "equipmentConfirmedAt", "exactAddressConsentAt" FROM "Listing" WHERE id='incomplete'`);
  expect(row).toEqual({ title: null, rent: null, propertyId: null, status: "DRAFT", hasElevator: null, petsAllowed: null, waterBilling: null, equipmentConfirmedAt: null, exactAddressConsentAt: null });
});

test("unknown, explicit no, and included billing remain distinct", async () => {
  await listing("known");
  await db.query(`UPDATE "Listing" SET "hasElevator"=false, "waterBilling"='INCLUDED', "managementFee"=0, "equipmentConfirmedAt"=NOW() WHERE id='known'`);
  expect((await db.query(`SELECT "hasElevator", "waterBilling", "managementFee", "electricityBilling", furniture FROM "Listing" WHERE id='known'`)).rows[0]).toEqual({ hasElevator: false, waterBilling: "INCLUDED", managementFee: 0, electricityBilling: null, furniture: [] });
});

test("authorized representative can publish independently of original property creator", async () => {
  await db.query(`UPDATE "User" SET "publisherType"='AUTHORIZED_REPRESENTATIVE' WHERE id='other'`);
  await listing("other-listing");
  await db.query(`UPDATE "Listing" SET "publisherId"='other', "propertyId"='house', "contactPhone"='0900000000' WHERE id='other-listing'`);
  expect((await db.query(`SELECT "publisherId", "contactPhone" FROM "Listing" WHERE id='other-listing'`)).rows[0]).toEqual({ publisherId: "other", contactPhone: "0900000000" });
  expect((await db.query(`SELECT "createdById" FROM "Property" WHERE id='house'`)).rows[0].createdById).toBe("owner");
});

test("first publication cannot be changed or cleared by edits and republication", async () => {
  await listing("first-time");
  await db.query(`UPDATE "Listing" SET status='PUBLISHED', "firstPublishedAt"='2026-11-01' WHERE id='first-time'`);
  await db.query(`UPDATE "Listing" SET status='ARCHIVED', "archiveReason"='RENTED' WHERE id='first-time'`);
  await db.query(`UPDATE "Listing" SET status='PUBLISHED', "archiveReason"=NULL, title='新說明' WHERE id='first-time'`);
  await reject(`UPDATE "Listing" SET "firstPublishedAt"=NOW() WHERE id='first-time'`, [], "23514");
  await reject(`UPDATE "Listing" SET "firstPublishedAt"=NULL WHERE id='first-time'`, [], "23514");
});

test("trash requires deletion time and restoring clears it without clearing platform restriction", async () => {
  await listing("trash");
  await reject(`UPDATE "Listing" SET status='TRASHED' WHERE id='trash'`, [], "23514");
  await db.query(`UPDATE "Listing" SET status='TRASHED', "trashedAt"=NOW(), "moderationStatus"='BLOCKED' WHERE id='trash'`);
  await reject(`UPDATE "Listing" SET status='ARCHIVED' WHERE id='trash'`, [], "23514");
  await db.query(`UPDATE "Listing" SET status='ARCHIVED', "trashedAt"=NULL WHERE id='trash'`);
  expect((await db.query(`SELECT "moderationStatus" FROM "Listing" WHERE id='trash'`)).rows[0].moderationStatus).toBe("BLOCKED");
});

test.each(["rent", "deposit", "managementFee", "bedrooms", "carParkingFee"])("rejects negative %s without forbidding missing draft values", async field => {
  await reject(`UPDATE "Listing" SET "${field}"=-1 WHERE id='legacy'`, [], "23514");
});

test("database enforces one cover under concurrent writes", async () => {
  await listing("covers");
  const peer = new Client({ host: root, database: "postgres", user: "postgres", port: 5432 });
  await peer.connect();
  try {
    const insert = `INSERT INTO "ListingMedia" (id, url, "listingId", "isCover") VALUES ($1, 'https://example.test/a.jpg', 'covers', true)`;
    const results = await Promise.allSettled([db.query(insert, ["cover-a"]), peer.query(insert, ["cover-b"])]);
    expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(x => x.status === "rejected")).toHaveLength(1);
  } finally { await peer.end(); }
});

test("shared processed image survives listing deletion and cannot be deleted while referenced", async () => {
  await listing("asset-a"); await listing("asset-b");
  await db.query(`INSERT INTO "MediaAsset" (id, "displayUrl", "thumbnailUrl", "displayBytes", "thumbnailBytes") VALUES ('asset', 'display', 'thumb', 100, 20)`);
  for (const id of ["asset-a", "asset-b"]) {
    await db.query(`INSERT INTO "ListingMedia" (id, url, "listingId", "assetId") VALUES ($1, 'display', $1, 'asset')`, [id]);
  }
  await db.query(`DELETE FROM "Listing" WHERE id='asset-a'`);
  await reject(`DELETE FROM "MediaAsset" WHERE id='asset'`, [], "23503");
  expect((await db.query(`SELECT "displayBytes"::int + "thumbnailBytes"::int AS bytes FROM "MediaAsset" WHERE id='asset'`)).rows[0].bytes).toBe(120);
  await db.query(`DELETE FROM "Listing" WHERE id='asset-b'`);
  await db.query(`DELETE FROM "MediaAsset" WHERE id='asset'`);
});

test("migration matches expected array/nullability types", async () => {
  const { rows } = await db.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='Listing' AND column_name IN ('furniture', 'appliances', 'title', 'rent', 'propertyId') ORDER BY column_name`);
  expect(rows).toEqual([
    { column_name: "appliances", data_type: "ARRAY", is_nullable: "NO" },
    { column_name: "furniture", data_type: "ARRAY", is_nullable: "NO" },
    { column_name: "propertyId", data_type: "text", is_nullable: "YES" },
    { column_name: "rent", data_type: "integer", is_nullable: "YES" },
    { column_name: "title", data_type: "text", is_nullable: "YES" },
  ]);
});


test("all migrated scalar columns agree with generated Prisma model types and nullability", async () => {
  const { rows } = await db.query(`SELECT table_name, column_name, data_type, udt_name, is_nullable FROM information_schema.columns WHERE table_schema='public'`);
  // Runtime DMMF omits isRequired/isList in this Prisma version. Read those
  // attributes from the schema and compare against the actual migrated DB.
  const schema = readFileSync(fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)), "utf8");
  const types: Record<string, string> = { String: "text", Int: "integer", Boolean: "boolean", DateTime: "timestamp without time zone", Decimal: "numeric", BigInt: "bigint" };
  for (const model of Prisma.dmmf.datamodel.models) {
    const block = schema.match(new RegExp(`model ${model.name} \{([\\s\\S]*?)\n\}`))?.[1];
    expect(block).toBeDefined();
    const fields = model.fields.filter(f => f.kind !== "object");
    expect(rows.filter(r => r.table_name === model.name)).toHaveLength(fields.length);
    for (const field of fields) {
      const column = rows.find(r => r.table_name === model.name && r.column_name === field.name);
      expect(column, `${model.name}.${field.name}`).toBeDefined();
      const declaration = block!.match(new RegExp(`^\\s*${field.name}\\s+(\\w+(?:\\[\\]|\\?)?)`, "m"))?.[1];
      expect(declaration).toBeDefined();
      const expected = declaration!.endsWith("[]") ? "ARRAY" : (field.kind === "enum") ? "USER-DEFINED" : field.name === "availableFrom" ? "date" : types[field.type];
      expect(column.data_type, `${model.name}.${field.name}`).toBe(expected);
      expect(column.is_nullable, `${model.name}.${field.name}`).toBe(declaration!.endsWith("?") ? "YES" : "NO");
      if ((field.kind === "enum")) expect(column.udt_name).toBe(field.type);
    }
  }
});

test("Prisma can write incomplete draft and read all migrated fields with relations", async () => {
  const orm = new PrismaClient({ adapter: new PrismaPg({ host: root, database: "postgres", user: "postgres", port: 5432 }) });
  try {
    const draft = await orm.listing.create({ data: { publisherId: "owner", minimumLeaseTerm: "待補租期條件" }, include: { property: true, media: true, publisher: true } });
    expect(draft.title).toBeNull();
    expect(draft.property).toBeNull();
    expect(draft.publisher.email).toBe("owner@example.test");
    expect(draft.firstPublishedAt).toBeNull();
    const original = await orm.listing.findUniqueOrThrow({ where: { id: "legacy" }, include: { property: true, media: { include: { asset: true } } } });
    expect(original.property?.floor).toBe(-1);
    expect(original.media[0].asset).toBeNull();
  } finally { await orm.$disconnect(); }
});

test("invalid existing duplicate covers stop migration without partial data/schema changes", async () => {
  await db.query('CREATE DATABASE duplicate_cover_test');
  const isolated = new Client({ host: root, database: "duplicate_cover_test", user: "postgres", port: 5432 });
  await isolated.connect();
  try {
    for (const dir of readdirSync(migrations).filter(x => /^\d/.test(x) && x < alignment).sort()) await isolated.query(sql(dir));
    await isolated.query(`
      INSERT INTO "User" (id, email, "updatedAt") VALUES ('owner', 'owner@example.test', NOW());
      INSERT INTO "City" (code, name) VALUES ('66', '臺中市');
      INSERT INTO "District" (code, name, "cityCode") VALUES ('01', '中區', '66');
      INSERT INTO "Property" (id, "cityCode", "districtCode", "addressLine", "createdById", "updatedAt") VALUES ('p', '66', '01', '測試', 'owner', NOW());
      INSERT INTO "Listing" (id, title, rent, "propertyId", "publisherId", "updatedAt") VALUES ('l', '舊資料', 100, 'p', 'owner', NOW());
      INSERT INTO "ListingMedia" (id, url, "listingId", "isCover") VALUES ('a', 'a', 'l', true), ('b', 'b', 'l', true);
    `);
    await expect(isolated.query(sql(alignment))).rejects.toMatchObject({ code: "23505" });
    await isolated.query("ROLLBACK");
    expect((await isolated.query(`SELECT COUNT(*)::int AS count FROM "ListingMedia"`)).rows[0].count).toBe(2);
    expect((await isolated.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='Listing' AND column_name='title'`)).rows[0].is_nullable).toBe("NO");
    expect((await isolated.query(`SELECT to_regclass('"MediaAsset"') AS name`)).rows[0].name).toBeNull();
  } finally { await isolated.end(); }
});


test("new input modes preserve legacy unknowns, amounts and location without inference", async () => {
  const orm = new PrismaClient({ adapter: new PrismaPg({ host: root, database: "postgres", user: "postgres", port: 5432 }) });
  try {
    const legacy = await orm.listing.findUniqueOrThrow({ where: { id: "legacy" } });
    expect(legacy.depositMode).toBeNull();
    expect(legacy.floorMode).toBeNull();
    expect(legacy.occupancyMode).toBeNull();
    expect(legacy.rent).toBe(12000);
    expect(publicationDetailsFromStorage(legacy).complete).toBe(false);
  } finally { await orm.$disconnect(); }
});

test("structured listing section round trips and changing modes clears stale dependent values", async () => {
  const orm = new PrismaClient({ adapter: new PrismaPg({ host: root, database: "postgres", user: "postgres", port: 5432 }) });
  const input = { rentalType: "INDEPENDENT_SUITE", buildingType: "TOWNHOUSE", hasElevator: false,
    deposit: { mode: "MONTHS", months: 1.5 }, managementFee: { mode: "SEPARATE", amount: 500 },
    occupancy: { mode: "DATE", date: "2026-12-01" }, minimumLeaseMonths: 1, equipment: { mode: "PRESENT", furniture: ["書桌"], appliances: [] },
    floor: { mode: "RANGE", from: -1, to: 1 }, totalFloors: 4, privateBathrooms: 1, balcony: { mode: "PRIVATE", count: 1 }, sharedSpaces: ["KITCHEN"] };
  try {
    const draft = await orm.listing.create({ data: { publisherId: "owner", areaType: "legacy-area-type" } });
    const row = await orm.listing.update({ where: { id: draft.id }, data: publicationDetailsToStorage(input) });
    expect(publicationDetailsFromStorage(row)).toMatchObject({ complete: true, value: input });
    expect(row.deposit).toBeNull();
    expect(row.depositMonths?.toString()).toBe("1.5");
    expect(row.areaType).toBe("legacy-area-type");
    expect(row.status).toBe("DRAFT");
    const updated = await orm.listing.update({ where: { id: draft.id }, data: publicationDetailsToStorage({ ...input,
      deposit: { mode: "NONE" }, managementFee: { mode: "INCLUDED" }, occupancy: { mode: "IMMEDIATE" },
      equipment: { mode: "NONE" }, floor: { mode: "SINGLE", level: 2 }, balcony: { mode: "NONE" } }) });
    expect(updated.deposit).toBe(0);
    expect(updated.depositMonths).toBeNull();
    expect(updated.managementFee).toBeNull();
    expect(updated.availableFrom).toBeNull();
    expect(updated.floorTo).toBeNull();
    expect(updated.furniture).toEqual([]);
    expect(updated.balconies).toBe(0);
    expect(publicationDetailsFromStorage(updated).complete).toBe(true);
    expect(() => publicationDetailsToStorage({ ...input, status: "PUBLISHED" })).toThrow();
  } finally { await orm.$disconnect(); }
});

test("mode constraints reject invalid values while incomplete drafts remain allowed", async () => {
  await reject(`UPDATE "Listing" SET "depositMode"='UNKNOWN' WHERE id='legacy'`, [], "23514");
  await reject(`UPDATE "Listing" SET "depositMonths"=0 WHERE id='legacy'`, [], "23514");
  await reject(`UPDATE "Listing" SET "floorMode"='RANGE', "floorFrom"=4, "floorTo"=2 WHERE id='legacy'`, [], "23514");
  await reject(`UPDATE "Listing" SET "sharedSpaces"=ARRAY['INVALID'] WHERE id='legacy'`, [], "23514");
});

test("accepted numeric boundaries round trip unchanged and rejected precision never alters a draft", async () => {
  const orm = new PrismaClient({ adapter: new PrismaPg({ host: root, database: "postgres", user: "postgres", port: 5432 }) });
  const section = { rentalType: "INDEPENDENT_SUITE", buildingType: "TOWNHOUSE", hasElevator: false,
    deposit: { mode: "MONTHS", months: 2 }, managementFee: { mode: "SEPARATE", amount: 10000000 },
    occupancy: { mode: "IMMEDIATE" }, minimumLeaseMonths: 1, equipment: { mode: "NONE" },
    floor: { mode: "SINGLE", level: -1 }, totalFloors: 4, privateBathrooms: 1, balcony: { mode: "NONE" } };
  try {
    const draft = await orm.listing.create({ data: { publisherId: "owner", title: "numeric regression" } });
    for (const months of [0.01, 1.25, 100]) {
      const saved = await orm.listing.update({ where: { id: draft.id },
        data: publicationDetailsToStorage({ ...section, deposit: { mode: "MONTHS", months } }) });
      expect(saved.depositMonths?.toString()).toBe(String(months));
      expect(publicationDetailsFromStorage(saved)).toMatchObject({ complete: true, value: { deposit: { mode: "MONTHS", months } } });
      expect(saved.managementFee).toBe(10000000);
    }
    for (const area of ["0.0001", "99999999.9999"]) {
      const saved = await orm.listing.update({ where: { id: draft.id }, data: { areaPings: new Prisma.Decimal(area) } });
      expect(saved.areaPings?.toString()).toBe(area);
    }
    const before = await orm.listing.findUniqueOrThrow({ where: { id: draft.id } });
    for (const months of [0.00001, 1.23456, 100000000]) {
      expect(() => publicationDetailsToStorage({ ...section, deposit: { mode: "MONTHS", months } })).toThrow();
    }
    const after = await orm.listing.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after).toEqual(before);
  } finally { await orm.$disconnect(); }
});
