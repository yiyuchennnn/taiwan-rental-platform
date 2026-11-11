import express from "express";
import { z } from "zod";
import { draftPatchSchema } from "./draft.schema.js";
import { contentExamples, operationReceiptSchema } from "./content-contract.js";
import {
  createContentSchema,
  saveContentSchema,
  previewContentSchema,
  publishContentSchema,
  transitionContentSchema,
} from "./content-command.schema.js";
/** Stateless UI fixture server ONLY. Not imported by createApp; no DB, credentials or approvals. */
export function createContractMock() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Contract-Mock", "true");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use((req, res, next) => {
    const scenario = req.get("X-Mock-Scenario");
    if (!scenario) return next();
    if (!Object.hasOwn(contentExamples.scenarios, scenario)) {
      res.status(400).json({
        error: { code: "UNKNOWN_MOCK_SCENARIO", message: "未知測試情境" },
      });
      return;
    }
    const value =
      contentExamples.scenarios[
        scenario as keyof typeof contentExamples.scenarios
      ];
    res.status(value.status).json({ error: value.error });
  });
  const fixtureId = contentExamples.operation.data.operation.resourceId;
  const timestamp = "2026-11-12T00:00:00.000Z";
  const blank = Object.fromEntries(
    Object.keys(draftPatchSchema.shape).map((key) => [
      key,
      [
        "floors",
        "furniture",
        "appliances",
        "sharedSpaces",
        "utilityCharges",
        "equipmentItems",
        "feeItems",
      ].includes(key)
        ? []
        : null,
    ]),
  );
  const listing = {
    ...blank,
    id: fixtureId,
    publicId: fixtureId,
    revision: 1,
    publicationHistory: "NEVER",
    status: "DRAFT",
    moderationStatus: "NONE",
    areaType: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    addressSource: "NONE",
    title: "僅供UI測試的草稿",
  };
  app.get("/api/v1/me/listings", (req, res) =>
    res.json({
      data: {
        items: [
          {
            id: fixtureId,
            publicId: fixtureId,
            revision: 1,
            title: listing.title,
            status: "DRAFT",
            moderationStatus: "NONE",
            archiveReason: null,
            trashedAt: null,
            updatedAt: timestamp,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  app.get("/api/v1/me/listings/:id", (req, res) => {
    if (req.params.id !== fixtureId) {
      res
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "Mock沒有此測試房源" } });
      return;
    }
    res.json({ data: { listing } });
  });
  app.get("/api/v1/me/operations/:id", (req, res) =>
    res.json(contentExamples.operation),
  );
  const schemas = {
    CREATE: createContentSchema,
    SAVE: saveContentSchema,
    PREVIEW: previewContentSchema,
    PUBLISH: publishContentSchema,
    TRANSITION: transitionContentSchema,
  };
  const route = (
    method: "post" | "patch",
    path: string,
    kind: keyof typeof schemas,
  ) =>
    app[method](path, (req, res) => {
      if (
        kind !== "PREVIEW" &&
        !z.uuidv4().safeParse(req.get("Idempotency-Key")).success
      ) {
        res
          .status(400)
          .json({
            error: {
              code: "IDEMPOTENCY_KEY_REQUIRED",
              message: "Mock也須提供UUIDv4操作識別碼",
            },
          });
        return;
      }
      if (req.params.id && !z.uuid().safeParse(req.params.id).success) {
        res
          .status(400)
          .json({
            error: { code: "VALIDATION_ERROR", message: "請提供UUID內容識別" },
          });
        return;
      }
      const parsed = schemas[kind].safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Mock請求不符合契約" },
        });
        return;
      }
      if (kind === "PREVIEW") {
        res.json({
          data: {
            preview: {
              id: "00000000-0000-4000-8000-000000000003",
              revision: req.body.expectedRevision,
              confirmationRequired: true,
              validation: {
                confirmedRulesPassed: false,
                issues: [],
                outstandingChecks: ["MOCK_NOT_VERIFICATION"],
                feeSummary: null,
              },
            },
          },
        });
        return;
      }
      const operation = {
        ...contentExamples.operation.data.operation,
        type:
          kind === "CREATE"
            ? "CREATE_LISTING"
            : kind === "SAVE"
              ? "SAVE_LISTING"
              : kind === "PUBLISH"
                ? "PUBLISH_LISTING"
                : `TRANSITION_${req.body.action}`,
        currentRevision: kind === "CREATE" ? 1 : req.body.expectedRevision + 1,
        resultStatus:
          kind === "PUBLISH"
            ? "PUBLISHED"
            : kind === "TRANSITION"
              ? req.body.action === "trash"
                ? "TRASHED"
                : req.body.action === "to-draft"
                  ? "DRAFT"
                  : "ARCHIVED"
              : "DRAFT",
      };
      res
        .status(kind === "CREATE" ? 201 : 200)
        .json({ data: { operation: operationReceiptSchema.parse(operation) } });
    });
  route("post", "/api/v1/me/listings", "CREATE");
  route("patch", "/api/v1/me/listings/:id/work-version", "SAVE");
  route("post", "/api/v1/me/listings/:id/preview", "PREVIEW");
  route("post", "/api/v1/me/listings/:id/publish", "PUBLISH");
  route("post", "/api/v1/me/listings/:id/transitions", "TRANSITION");
  app.use((_req, res) =>
    res.status(404).json({
      error: {
        code: "MOCK_ROUTE_NOT_AVAILABLE",
        message: "此路由未提供Mock",
      },
    }),
  );
  return app;
}
