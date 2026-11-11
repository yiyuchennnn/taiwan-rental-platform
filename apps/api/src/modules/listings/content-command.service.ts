import {
  evidenceMatches,
  type PublicationEvidenceReader,
} from "./publication-evidence.js";
export type { PublicationEvidenceReader } from "./publication-evidence.js";
import { createHash } from "node:crypto";
import type { Listing, Prisma, PrismaClient } from "@prisma/client";
import type { AuthenticatedSession } from "../auth/require-auth.js";
import { resolveCurrentEntitlement } from "../entitlements/entitlement.service.js";
import { DraftError, dataForPatch, draftDto } from "./draft.service.js";
import { patchDraftAddress, readDraftAddress } from "./draft-address.js";
import { patchDraftDetails, readDraftDetails } from "./draft-details.js";
import { checkConfirmedPublicationRules } from "./publication-check.js";
import {
  createContentSchema,
  saveContentSchema,
  previewContentSchema,
  publishContentSchema,
  transitionContentSchema,
  privateListSchema,
} from "./content-command.schema.js";

const recoveryMs = 30 * 86400 * 1000;
const fail = (status: number, code: string, message: string): never => {
  throw new DraftError(status, code, message);
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

const unavailableEvidence: PublicationEvidenceReader = async () => null;

export function createContentCommandService(
  db: PrismaClient,
  evidence: PublicationEvidenceReader = unavailableEvidence,
  clock: () => Date = () => new Date(),
) {
  async function authenticated(
    tx: Prisma.TransactionClient,
    auth: AuthenticatedSession,
  ) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${auth.user.id} FOR UPDATE`;
    const session = await tx.authSession.findFirst({
      where: {
        id: auth.sessionId,
        userId: auth.user.id,
        revokedAt: null,
        expiresAt: { gt: clock() },
        user: { isActive: true },
      },
    });
    if (!session) fail(401, "UNAUTHENTICATED", "請先登入");
  }
  async function owned(
    tx: Prisma.TransactionClient,
    ownerId: string,
    id: string,
  ) {
    await tx.$queryRaw`SELECT id FROM "Listing" WHERE id=${id} AND "publisherId"=${ownerId} FOR UPDATE`;
    const row = await tx.listing.findFirst({
      where: { id, publisherId: ownerId },
    });
    if (!row || row.status === "DELETED")
      return fail(404, "NOT_FOUND", "找不到房源");
    return row;
  }
  async function draft(tx: Prisma.TransactionClient, row: Listing) {
    return {
      ...draftDto(row),
      ...(await readDraftAddress(tx, row)),
      ...(await readDraftDetails(tx, row.id)),
    };
  }
  async function validation(tx: Prisma.TransactionClient, row: Listing) {
    const value = await draft(tx, row);
    const media = await tx.listingMedia.findMany({
      where: { listingId: row.id },
      select: {
        isCover: true,
        asset: {
          select: { displayUrl: true, thumbnailUrl: true, gpsRemovedAt: true },
        },
      },
    });
    return checkConfirmedPublicationRules({ ...value, media }, clock());
  }
  function version(row: Listing, expected: number) {
    if (row.revision !== expected)
      fail(
        409,
        "REVISION_CONFLICT",
        "內容已更新，請重新讀取並保留尚未送出的修改",
      );
  }
  async function quotas(tx: Prisma.TransactionClient, ownerId: string) {
    const result = await resolveCurrentEntitlement(tx, ownerId, clock());
    if (result.status !== "READY")
      return fail(503, "ENTITLEMENTS_UNAVAILABLE", "會員資格來源需核對");
    return result.quotas;
  }
  async function space(
    tx: Prisma.TransactionClient,
    ownerId: string,
    status: "DRAFT" | "ARCHIVED" | "PUBLISHED",
  ) {
    const q = await quotas(tx, ownerId),
      limit =
        status === "DRAFT"
          ? q.draftListings
          : status === "ARCHIVED"
            ? q.archivedListings
            : q.publicListings;
    const count = await tx.listing.count({
      where: { publisherId: ownerId, status, moderationStatus: "NONE" },
    });
    if (count >= limit)
      fail(409, "CONTENT_QUOTA_EXCEEDED", "目標狀態額度已滿，原有資料仍保留");
  }
  async function context(
    tx: Prisma.TransactionClient,
    row: Listing,
    proof: Awaited<ReturnType<PublicationEvidenceReader>>,
  ) {
    const at = clock();
    const qualification = await resolveCurrentEntitlement(
      tx,
      row.publisherId,
      at,
    );
    const sources = await tx.entitlementPeriod.findMany({
      where: {
        userId: row.publisherId,
        startsAt: { lte: at },
        endsAt: { gt: at },
        revokedAt: null,
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        plan: true,
        source: true,
        sourceReference: true,
        startsAt: true,
        endsAt: true,
        confirmedAt: true,
      },
    });
    const account = await tx.entitlementAccount.findUnique({
      where: { userId: row.publisherId },
      select: { verifiedAt: true, provenance: true },
    });
    return digest({
      sources: sources.map((source) => ({
        ...source,
        startsAt: source.startsAt.toISOString(),
        endsAt: source.endsAt.toISOString(),
        confirmedAt: source.confirmedAt?.toISOString() ?? null,
      })),
      account: account
        ? { ...account, verifiedAt: account.verifiedAt?.toISOString() ?? null }
        : null,
      ownerId: row.publisherId,
      qualification,
      evidence: proof
        ? {
            source: proof.sourceReference,
            revision: proof.revision,
            checks: proof.checks,
          }
        : null,
    });
  }
  const receipt = (row: {
    id: string;
    type: string;
    listingId: string;
    revision: number;
    resultStatus: string;
  }) => ({
    id: row.id,
    type: row.type,
    state: "COMPLETED" as const,
    resourceId: row.listingId,
    currentRevision: row.revision,
    resultStatus: row.resultStatus,
    safeNextAction: "RELOAD_CONTENT" as const,
  });
  async function command(
    auth: AuthenticatedSession,
    type: string,
    key: string,
    target: string | undefined,
    input: unknown,
    run: (tx: Prisma.TransactionClient) => Promise<Listing>,
  ) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        key,
      )
    )
      fail(400, "INVALID_OPERATION_KEY", "請提供有效操作識別碼");
    key = key.toLowerCase();
    const requestDigest = digest({ target: target ?? null, input });
    return db.$transaction(async (tx) => {
      await authenticated(tx, auth);
      const previous = await tx.contentOperation.findUnique({
        where: {
          ownerId_type_requestKey: {
            ownerId: auth.user.id,
            type,
            requestKey: key,
          },
        },
      });
      if (previous) {
        if (previous.requestDigest !== requestDigest)
          fail(409, "IDEMPOTENCY_KEY_REUSED", "操作識別碼已用於不同內容");
        // Safe receipt, even after ownership changes. Never replay a private content snapshot.
        return receipt(previous);
      }
      const row = await run(tx);
      const operation = await tx.contentOperation.create({
        data: {
          ownerId: auth.user.id,
          type,
          requestKey: key,
          requestDigest,
          listingId: row.id,
          revision: row.revision,
          resultStatus: row.status,
        },
      });
      await tx.contentEvent.create({
        data: {
          operationId: operation.id,
          listingId: row.id,
          type,
          revision: row.revision,
        },
      });
      return receipt(operation);
    });
  }
  return {
    async create(auth: AuthenticatedSession, key: string, input: unknown) {
      const value = createContentSchema.parse(input);
      return command(
        auth,
        "CREATE_LISTING",
        key,
        undefined,
        input,
        async (tx) => {
          await space(tx, auth.user.id, "DRAFT");
          const data = dataForPatch(null, value.draft);
          const row = await tx.listing.create({
            data: {
              ...data,
              publisherId: auth.user.id,
              status: "DRAFT",
            } as Prisma.ListingUncheckedCreateInput,
          });
          await patchDraftAddress(tx, row, value.draft.address);
          await patchDraftDetails(tx, row.id, value.draft);
          return row;
        },
      );
    },
    async read(auth: AuthenticatedSession, id: string) {
      return db.$transaction(async (tx) => {
        await authenticated(tx, auth);
        const row = await owned(tx, auth.user.id, id);
        if (
          row.status === "TRASHED" &&
          (!row.trashedAt ||
            clock().getTime() >= row.trashedAt.getTime() + recoveryMs)
        )
          fail(409, "RECOVERY_EXPIRED", "已超過可恢復期限");
        return draft(tx, row);
      });
    },
    async list(auth: AuthenticatedSession, input: unknown) {
      const query = privateListSchema.parse(input);
      return db.$transaction(async (tx) => {
        await authenticated(tx, auth);
        if (
          query.cursor &&
          !(await tx.listing.findFirst({
            where: {
              id: query.cursor,
              publisherId: auth.user.id,
              status: { not: "DELETED" },
            },
          }))
        )
          fail(400, "INVALID_CURSOR", "請重新載入列表");
        const rows = await tx.listing.findMany({
          where: {
            publisherId: auth.user.id,
            status: query.status ?? { not: "DELETED" },
            ...(query.cursor ? { id: { gt: query.cursor } } : {}),
          },
          orderBy: { id: "asc" },
          take: query.limit + 1,
          select: {
            id: true,
            publicId: true,
            revision: true,
            title: true,
            status: true,
            moderationStatus: true,
            archiveReason: true,
            trashedAt: true,
            updatedAt: true,
          },
        });
        const items = rows.slice(0, query.limit);
        return {
          items,
          nextCursor: rows.length > query.limit ? items.at(-1)!.id : null,
        };
      });
    },
    async save(
      auth: AuthenticatedSession,
      id: string,
      key: string,
      input: unknown,
    ) {
      const value = saveContentSchema.parse(input);
      return command(auth, "SAVE_LISTING", key, id, input, async (tx) => {
        const row = await owned(tx, auth.user.id, id);
        version(row, value.expectedRevision);
        if (row.status !== "DRAFT" && row.status !== "ARCHIVED")
          fail(409, "CONTENT_STATE_CONFLICT", "目前狀態不能使用此私人編輯入口");
        if (row.moderationStatus !== "NONE")
          fail(409, "CONTENT_RESTRICTED", "受限制內容須走限定補正流程");
        const patch = value.patch;
        if (
          row.floorMode === "RANGE" &&
          ["floorMode", "floorFrom", "floorTo", "floors", "totalFloors"].some(
            (key) => Object.hasOwn(patch, key),
          ) &&
          (patch.floorMode !== "MULTIPLE" || !patch.floors?.length)
        )
          fail(
            400,
            "LEGACY_FLOOR_CONFIRMATION_REQUIRED",
            "請確認實際出租樓層並改用多層清單，不自動展開舊起訖",
          );
        if (Object.keys(patch).length === 0) return row;
        const data = dataForPatch(row, patch);
        const before = await draft(tx, row);
        const clean = (v: unknown): unknown =>
          Array.isArray(v)
            ? v
                .map(clean)
                .sort((a, b) => canonical(a).localeCompare(canonical(b)))
            : v && typeof v === "object"
              ? Object.fromEntries(
                  Object.entries(v)
                    .filter(([, x]) => x != null)
                    .map(([k, x]) => [k, clean(x)]),
                )
              : v;
        const changed = Object.entries(patch).some(([key, value]) => {
          const old = (before as Record<string, unknown>)[key];
          if (key === "address" && value && typeof value === "object")
            return Object.entries(value).some(
              ([k, x]) =>
                canonical(
                  (old as Record<string, unknown> | null)?.[k] ?? null,
                ) !== canonical(x),
            );
          return canonical(clean(old)) !== canonical(clean(value));
        });
        if (!changed) return row;
        await patchDraftAddress(tx, row, patch.address);
        await patchDraftDetails(tx, row.id, patch);
        return tx.listing.update({
          where: { id },
          data: { ...data, revision: { increment: 1 } },
        });
      });
    },
    async preview(auth: AuthenticatedSession, id: string, input: unknown) {
      const value = previewContentSchema.parse(input);
      return db.$transaction(async (tx) => {
        await authenticated(tx, auth);
        const row = await owned(tx, auth.user.id, id);
        version(row, value.expectedRevision);
        if (row.status !== "DRAFT" && row.status !== "ARCHIVED")
          fail(409, "CONTENT_STATE_CONFLICT", "目前狀態不能預覽發布");
        const report = await validation(tx, row);
        const proof = await evidence(tx, row, clock());
        const contextDigest = await context(tx, row, proof);
        await tx.listingPreview.deleteMany({
          where: { ownerId: auth.user.id, listingId: id },
        });
        const preview = await tx.listingPreview.create({
          data: {
            ownerId: auth.user.id,
            listingId: id,
            revision: row.revision,
            contextDigest,
          },
        });
        return {
          id: preview.id,
          revision: row.revision,
          validation: report,
          confirmationRequired: true,
        };
      });
    },
    async publish(
      auth: AuthenticatedSession,
      id: string,
      key: string,
      input: unknown,
    ) {
      const value = publishContentSchema.parse(input);
      return command(auth, "PUBLISH_LISTING", key, id, input, async (tx) => {
        const row = await owned(tx, auth.user.id, id);
        version(row, value.expectedRevision);
        if (row.status !== "DRAFT" && row.status !== "ARCHIVED")
          fail(409, "CONTENT_STATE_CONFLICT", "目前狀態不能發布");
        const preview = await tx.listingPreview.findFirst({
          where: {
            id: value.previewId,
            ownerId: auth.user.id,
            listingId: id,
            revision: row.revision,
          },
        });
        if (!preview) fail(409, "PREVIEW_STALE", "請重新預覽目前內容");
        const report = await validation(tx, row);
        if (!report.confirmedRulesPassed)
          fail(400, "PUBLICATION_FIELDS_INCOMPLETE", "請先補齊並修正發布欄位");
        const at = clock(),
          proof = await evidence(tx, row, at);
        if (!evidenceMatches(proof, row, at))
          fail(
            503,
            "PUBLICATION_EVIDENCE_UNAVAILABLE",
            "正式發布所需查核與生命週期服務尚未接妥",
          );
        if (preview!.contextDigest !== (await context(tx, row, proof)))
          fail(409, "PREVIEW_STALE", "資格或查核依據已變更，請重新預覽");
        const address = await readDraftAddress(tx, row);
        if (address.address?.cityCode)
          await tx.$queryRaw`SELECT code FROM "City" WHERE code=${address.address.cityCode} FOR SHARE`;
        const city = address.address?.cityCode
          ? await tx.city.findUnique({
              where: { code: address.address.cityCode },
            })
          : null;
        if (city?.publicationPolicy !== "OPEN")
          fail(409, "REGION_NOT_OPEN", "此地區目前未開放新刊登");
        await space(tx, auth.user.id, "PUBLISHED");
        const firstPublishedAt =
          row.firstPublishedAt ??
          (row.publicationHistory === "NEVER" ? at : null);
        const saved = await tx.listing.update({
          where: { id },
          data: {
            status: "PUBLISHED",
            archiveReason: null,
            trashedAt: null,
            publicationHistory: firstPublishedAt ? "KNOWN" : "UNKNOWN",
            firstPublishedAt,
            revision: { increment: 1 },
          },
        });
        const media = await tx.listingMedia.findMany({
          where: { listingId: id },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: { id: true, isCover: true },
        });
        const snapshot = {
          publicId: row.publicId,
          revision: saved.revision,
          publicationHistory: saved.publicationHistory,
          firstPublishedAt: saved.firstPublishedAt?.toISOString() ?? null,
          title: row.title,
          description: row.description,
          rentalType: row.rentalType,
          buildingType: row.buildingType,
          rent: row.rent,
          feeSummary: report.feeSummary,
          contactName: row.contactName,
          contactPhone: row.contactPhone,
          contactLine: row.contactLine,
          cityCode: address.address!.cityCode,
          districtCode: address.address!.districtCode,
          images: media.map((p) => ({
            id: p.id,
            isCover: p.isCover,
            displayPath: `/api/v1/listings/${row.publicId}/images/${p.id}/display`,
            thumbnailPath: `/api/v1/listings/${row.publicId}/images/${p.id}/thumbnail`,
          })),
        };
        await tx.listingPublication.upsert({
          where: { listingId: id },
          create: {
            listingId: id,
            publicId: row.publicId,
            revision: saved.revision,
            snapshot: snapshot as Prisma.InputJsonValue,
          },
          update: {
            revision: saved.revision,
            snapshot: snapshot as Prisma.InputJsonValue,
          },
        });
        return saved;
      });
    },
    async transition(
      auth: AuthenticatedSession,
      id: string,
      key: string,
      input: unknown,
    ) {
      const value = transitionContentSchema.parse(input);
      return command(
        auth,
        `TRANSITION_${value.action}`,
        key,
        id,
        input,
        async (tx) => {
          const row = await owned(tx, auth.user.id, id);
          version(row, value.expectedRevision);
          const restricted = row.moderationStatus !== "NONE";
          let status: "DRAFT" | "ARCHIVED" | "TRASHED",
            reason = row.archiveReason,
            trashedAt = row.trashedAt;
          if (value.action === "trash") {
            if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(row.status))
              fail(409, "CONTENT_STATE_CONFLICT", "目前狀態不能移至回收區");
            status = "TRASHED";
            trashedAt = clock();
          } else if (value.action === "restore") {
            if (row.status !== "TRASHED")
              fail(409, "CONTENT_STATE_CONFLICT", "目前不是回收內容");
            if (
              !row.trashedAt ||
              clock().getTime() >= row.trashedAt.getTime() + recoveryMs
            )
              fail(409, "RECOVERY_EXPIRED", "已超過可恢復期限");
            if (!restricted) await space(tx, auth.user.id, "ARCHIVED");
            status = "ARCHIVED";
            trashedAt = null;
          } else {
            if (
              restricted &&
              (row.status !== "PUBLISHED" || value.action === "to-draft")
            )
              fail(409, "CONTENT_RESTRICTED", "受限內容不能繞過限定補正流程");
            if (value.action === "to-draft") {
              if (row.status !== "ARCHIVED" && row.status !== "PUBLISHED")
                fail(409, "CONTENT_STATE_CONFLICT", "目前狀態不能轉草稿");
              await space(tx, auth.user.id, "DRAFT");
              status = "DRAFT";
              reason = null;
            } else {
              if (value.action === "mark-rented" && row.status !== "PUBLISHED")
                fail(409, "CONTENT_STATE_CONFLICT", "只有公開房源可標示已出租");
              if (row.status !== "PUBLISHED" && row.status !== "DRAFT")
                fail(409, "CONTENT_STATE_CONFLICT", "目前狀態不能封存");
              if (row.status === "DRAFT")
                await space(tx, auth.user.id, "ARCHIVED");
              status = "ARCHIVED";
              reason = value.action === "mark-rented" ? "RENTED" : "MANUAL";
            }
          }
          await tx.listingPublication.deleteMany({ where: { listingId: id } });
          return tx.listing.update({
            where: { id },
            data: {
              status,
              archiveReason: reason,
              trashedAt,
              revision: { increment: 1 },
            },
          });
        },
      );
    },
    async operation(auth: AuthenticatedSession, id: string) {
      return db.$transaction(async (tx) => {
        await authenticated(tx, auth);
        const row = await tx.contentOperation.findFirst({
          where: { id, ownerId: auth.user.id },
        });
        if (!row) return fail(404, "NOT_FOUND", "找不到操作");
        return receipt(row);
      });
    },
  };
}
