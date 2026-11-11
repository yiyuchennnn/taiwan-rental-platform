import { z } from "zod";
import { draftPatchSchema } from "./draft.schema.js";
import { registerSchema, loginSchema } from "../auth/auth.schema.js";
import {
  createContentSchema,
  saveContentSchema,
  previewContentSchema,
  publishContentSchema,
  transitionContentSchema,
} from "./content-command.schema.js";
export const contractVersion = "2026-11-12";
export const operationReceiptSchema = z
  .object({
    id: z.uuid(),
    type: z.string(),
    state: z.literal("COMPLETED"),
    resourceId: z.uuid(),
    currentRevision: z.number().int().positive(),
    resultStatus: z.string(),
    safeNextAction: z.literal("RELOAD_CONTENT"),
  })
  .strict();
const feeSummary = z
  .object({
    rent: z.number().int(),
    fixedMonthlyTotal: z.number().int().nullable(),
    approximate: z.boolean(),
    usageCharges: z.array(z.string()),
    optionalFeeIndexes: z.array(z.number().int()),
    oneTimeFees: z.array(
      z
        .object({
          index: z.number().int(),
          amount: z.number().nullable(),
          paymentTiming: z.string().nullable(),
          payee: z.string().nullable(),
        })
        .strict(),
    ),
    oneTimeUtilities: z.array(
      z.object({ kind: z.string(), amount: z.number() }).strict(),
    ),
    depositAmount: z.number().nullable(),
    guaranteedMoveInTotal: z.null(),
  })
  .strict();
const localValidation = z
  .object({
    confirmedRulesPassed: z.boolean(),
    issues: z.array(
      z
        .object({
          code: z.string(),
          path: z.string(),
          rule: z.enum(["02-06", "02-09"]),
        })
        .strict(),
    ),
    outstandingChecks: z.array(z.string()),
    feeSummary: feeSummary.nullable(),
  })
  .strict();
export const publicListingSchema = z
  .object({
    publicationHistory: z.enum(["KNOWN", "UNKNOWN"]),
    firstPublishedAt: z.string().nullable(),
    publicId: z.uuid(),
    revision: z.number().int(),
    title: z.string(),
    description: z.string(),
    rentalType: z.string(),
    buildingType: z.string(),
    rent: z.number().int(),
    feeSummary: feeSummary.nullable(),
    contactName: z.string(),
    contactPhone: z.string().nullable(),
    contactLine: z.string().nullable(),
    cityCode: z.string(),
    districtCode: z.string(),
    images: z.array(
      z
        .object({
          id: z.uuid(),
          isCover: z.boolean(),
          displayPath: z.string(),
          thumbnailPath: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
const operationResponse = z
  .object({ data: z.object({ operation: operationReceiptSchema }).strict() })
  .strict();
const error = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z
          .array(
            z
              .object({
                path: z.string(),
                reason: z.string().optional(),
                message: z.string().optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
  })
  .strict();
const raw = (schema: z.ZodType) => {
  const { $schema, ...rest } = z.toJSONSchema(schema, {
    unrepresentable: "any",
  });
  return rest;
};
export function contentOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, unknown> = {
    DraftPatch: raw(draftPatchSchema),
    CreateListing: raw(createContentSchema),
    SaveListing: raw(saveContentSchema),
    PreviewListing: raw(previewContentSchema),
    PublishListing: raw(publishContentSchema),
    TransitionListing: raw(transitionContentSchema),
    Register: raw(registerSchema),
    Login: raw(loginSchema),
    OperationReceipt: raw(operationReceiptSchema),
    OperationResponse: raw(operationResponse),
    Error: raw(error),
    PublicListingResponse: raw(
      z
        .object({ data: z.object({ listing: publicListingSchema }).strict() })
        .strict(),
    ),
    PreviewResponse: raw(
      z
        .object({
          data: z
            .object({
              preview: z
                .object({
                  id: z.uuid(),
                  revision: z.number().int(),
                  validation: localValidation,
                  confirmationRequired: z.literal(true),
                })
                .strict(),
            })
            .strict(),
        })
        .strict(),
    ),
    ValidationResponse: raw(
      z
        .object({ data: z.object({ validation: localValidation }).strict() })
        .strict(),
    ),
  };
  const work = raw(draftPatchSchema) as Record<string, unknown>;
  const relax = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(relax)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(
                ([k]) =>
                  ![
                    "enum",
                    "minimum",
                    "maximum",
                    "exclusiveMinimum",
                    "exclusiveMaximum",
                    "minLength",
                    "maxLength",
                    "pattern",
                    "format",
                  ].includes(k),
              )
              .map(([k, v]) => [k, relax(v)]),
          )
        : value;
  const props = (relax(work) as { properties: Record<string, unknown> })
    .properties;
  const metadata = {
    id: { type: "string" },
    publicId: { type: "string" },
    revision: { type: "integer" },
    publicationHistory: { type: "string" },
    status: { type: "string" },
    moderationStatus: { type: "string" },
    areaType: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    addressSource: { type: "string" },
  };
  schemas.PrivateListing = {
    type: "object",
    additionalProperties: false,
    properties: { ...props, ...metadata },
    required: [...Object.keys(props), ...Object.keys(metadata)],
    description:
      "Private whitelist; response preserves historical values. Current input validity and publication authority are separate.",
  };
  schemas.ListingResponse = {
    type: "object",
    additionalProperties: false,
    properties: {
      data: {
        type: "object",
        additionalProperties: false,
        properties: {
          listing: { $ref: "#/components/schemas/PrivateListing" },
        },
        required: ["listing"],
      },
    },
    required: ["data"],
  };
  schemas.DraftResponse = {
    type: "object",
    additionalProperties: false,
    properties: {
      data: {
        type: "object",
        additionalProperties: false,
        properties: { draft: { $ref: "#/components/schemas/PrivateListing" } },
        required: ["draft"],
      },
    },
    required: ["data"],
  };
  const user = z
    .object({
      id: z.string(),
      email: z.string(),
      name: z.string().nullable(),
      role: z.enum(["RENTER", "PUBLISHER", "ADMIN"]),
      createdAt: z.string(),
    })
    .strict();
  schemas.UserResponse = raw(
    z.object({ data: z.object({ user }).strict() }).strict(),
  );
  schemas.LoginResponse = raw(
    z
      .object({
        data: z
          .object({
            user,
            accessToken: z.string(),
            tokenType: z.literal("Bearer"),
            expiresAt: z.string(),
          })
          .strict(),
      })
      .strict(),
  );
  schemas.OperationResponse = raw(operationResponse);
  const position = z
    .object({
      id: z.string(),
      assetId: z.string().nullable(),
      sortOrder: z.number().int(),
      isCover: z.boolean(),
      displayBytes: z.string().regex(/^\d+$/).nullable(),
      thumbnailBytes: z.string().regex(/^\d+$/).nullable(),
    })
    .strict();
  schemas.ImagesResponse = raw(
    z
      .object({ data: z.object({ images: z.array(position) }).strict() })
      .strict(),
  );
  schemas.RemoveImageResponse = raw(
    z
      .object({
        data: z
          .object({ images: z.array(position), cleanupPending: z.boolean() })
          .strict(),
      })
      .strict(),
  );
  schemas.ImageOrder = raw(
    z
      .object({
        ids: z.array(z.string().min(1).max(200)).max(30),
        expectedRevision: z.number().int().positive().optional(),
      })
      .strict(),
  );
  schemas.ImageCover = raw(
    z
      .object({ expectedRevision: z.number().int().positive().optional() })
      .strict(),
  );
  schemas.PrivateListResponse = raw(
    z
      .object({
        data: z
          .object({
            items: z.array(
              z
                .object({
                  id: z.string(),
                  publicId: z.string(),
                  revision: z.number().int(),
                  title: z.string().nullable(),
                  status: z.string(),
                  moderationStatus: z.string(),
                  archiveReason: z.string().nullable(),
                  trashedAt: z.string().nullable(),
                  updatedAt: z.string(),
                })
                .strict(),
            ),
            nextCursor: z.string().nullable(),
          })
          .strict(),
      })
      .strict(),
  );
  schemas.HealthResponse = raw(
    z
      .object({
        status: z.literal("ok"),
        service: z.literal("taiwan-rental-api"),
        timestamp: z.string(),
      })
      .strict(),
  );
  schemas.ReadinessResponse = raw(
    z
      .object({
        data: z
          .object({
            database: z.literal("READY"),
            schema: z.literal("READY"),
            capabilities: z
              .object({
                draftCommands: z.literal(true),
                imageUpload: z.boolean(),
                publication: z.literal(false),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
  );
  const response = (description: string, schema?: string) => ({
    description,
    ...(schema
      ? {
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${schema}` },
            },
          },
        }
      : {}),
  });
  const add = (
    path: string,
    method: string,
    summary: string,
    options: {
      request?: string;
      status?: number;
      response?: string;
      private?: boolean;
      key?: boolean;
      binary?: boolean;
      deprecated?: boolean;
    } = {},
  ) => {
    const parameters: Array<Record<string, unknown>> = [];
    for (const name of [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))
      parameters.push({
        name,
        in: "path",
        required: true,
        schema:
          name === "variant"
            ? { type: "string", enum: ["display", "thumbnail"] }
            : { type: "string", format: "uuid" },
      });
    if (options.key)
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", format: "uuid" },
        description:
          "UUIDv4; same account and command type. Replay returns a safe receipt, not private content.",
      });
    const status = options.status ?? 200;
    const responses: Record<string, unknown> = {
      [status]: options.binary
        ? {
            description: "Processed WebP only",
            content: {
              "image/webp": { schema: { type: "string", format: "binary" } },
            },
          }
        : response("Success", options.response),
      400: response("Invalid request or missing key/revision", "Error"),
      404: response("Not found or not owned", "Error"),
      409: response("Revision/state/quota/key conflict", "Error"),
      503: response("Required source or capability unavailable", "Error"),
    };
    if (options.binary) {
      responses["413"] = response("Image bytes exceed product limit", "Error");
      responses["415"] = response("Unsupported image or encoding", "Error");
    }
    responses["500"] = response(
      "Unexpected server failure; result may be unknown, retry the original key rather than a new intent",
      "Error",
    );
    if (options.private !== false)
      responses["401"] = response("Authentication required", "Error");
    if (!paths[path]) paths[path] = {};
    const operation: Record<string, unknown> = {
      summary,
      operationId: `${method}_${path.replace(/[^A-Za-z0-9]/g, "_")}`,
      parameters,
      security: options.private === false ? [] : [{ bearerAuth: [] }],
      responses,
    };
    if (options.deprecated) operation.deprecated = true;
    if (options.request)
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${options.request}` },
          },
        },
      };
    paths[path]![method] = operation;
  };
  add(
    "/me/listings",
    "post",
    "Create one draft, persist one idempotent receipt",
    {
      request: "CreateListing",
      status: 201,
      response: "OperationResponse",
      key: true,
    },
  );
  add(
    "/me/listings",
    "get",
    "List own private content, including independent restriction status",
    { response: "PrivateListResponse" },
  );
  paths["/me/listings"]!["get"] = {
    ...(paths["/me/listings"]!["get"] as object),
    parameters: [
      {
        in: "query",
        name: "status",
        schema: {
          type: "string",
          enum: ["DRAFT", "PUBLISHED", "ARCHIVED", "TRASHED"],
        },
      },
      {
        in: "query",
        name: "limit",
        schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      {
        in: "query",
        name: "cursor",
        schema: { type: "string", format: "uuid" },
      },
    ],
  };
  add("/me/listings/{id}", "get", "Get own current work content", {
    response: "ListingResponse",
  });
  add(
    "/me/listings/{id}/work-version",
    "patch",
    "Save draft or archived work content with version protection",
    { request: "SaveListing", response: "OperationResponse", key: true },
  );
  add(
    "/me/listings/{id}/preview",
    "post",
    "Create revision-bound private preview; never publishes",
    { request: "PreviewListing", response: "PreviewResponse" },
  );
  add(
    "/me/listings/{id}/publish",
    "post",
    "Atomically publish only with trusted persisted evidence; runtime currently blocked",
    { request: "PublishListing", response: "OperationResponse", key: true },
  );
  add(
    "/me/listings/{id}/transitions",
    "post",
    "Explicit archive, rented, draft, trash or restore transition",
    { request: "TransitionListing", response: "OperationResponse", key: true },
  );
  add(
    "/me/operations/{id}",
    "get",
    "Get own minimal durable operation receipt",
    { response: "OperationResponse" },
  );
  add(
    "/listings/{publicId}",
    "get",
    "Guarded whitelisted public detail; not search/map",
    { private: false, response: "PublicListingResponse" },
  );
  add(
    "/listings/{publicId}/images/{mediaId}/{variant}",
    "get",
    "Guarded WebP; withdrawal checked again after storage read",
    { private: false, binary: true },
  );
  add("/auth/register", "post", "Register account; not identity verification", {
    request: "Register",
    status: 201,
    private: false,
    response: "UserResponse",
  });
  add(
    "/auth/login",
    "post",
    "Issue opaque Bearer session; not browser cookie session",
    { request: "Login", private: false, response: "LoginResponse" },
  );
  add("/auth/me", "get", "Get own account", { response: "UserResponse" });
  add("/auth/logout", "post", "Revoke current session", { status: 204 });
  add("/health", "get", "Process liveness only", {
    private: false,
    response: "HealthResponse",
  });
  add(
    "/readiness",
    "get",
    "Database/schema readiness; formal capability separate",
    { private: false, response: "ReadinessResponse" },
  );
  add("/drafts/{id}", "get", "Compatibility draft read only", {
    response: "DraftResponse",
  });
  add(
    "/drafts/{id}/validation",
    "get",
    "Local draft diagnostics; not publication authority",
    { response: "ValidationResponse" },
  );
  add(
    "/drafts/{id}/images",
    "get",
    "Own draft image positions and measured byte strings",
    { response: "ImagesResponse" },
  );
  add(
    "/drafts/{id}/images",
    "post",
    "Binary upload: UUIDv4 key and explicit rights confirmation; capacity required",
    { status: 201, key: true, response: "ImagesResponse" },
  );
  (
    paths["/drafts/{id}/images"]!["post"] as Record<string, unknown>
  ).requestBody = {
    required: true,
    content: {
      "image/jpeg": { schema: { type: "string", format: "binary" } },
      "image/png": { schema: { type: "string", format: "binary" } },
      "image/webp": { schema: { type: "string", format: "binary" } },
    },
  };
  (
    (paths["/drafts/{id}/images"]!["post"] as Record<string, unknown>)
      .parameters as unknown[]
  ).push({
    in: "header",
    name: "X-Image-Rights-Confirmed",
    required: true,
    schema: { type: "string", const: "true" },
  });
  add("/drafts/{id}/images/order", "put", "Replace complete image order", {
    request: "ImageOrder",
    response: "ImagesResponse",
  });
  add("/drafts/{id}/images/{mediaId}/cover", "put", "Choose one cover", {
    request: "ImageCover",
    response: "ImagesResponse",
  });
  add(
    "/drafts/{id}/images/{mediaId}",
    "delete",
    "Remove one image reference, cleanup may remain pending",
    { response: "RemoveImageResponse" },
  );
  add(
    "/drafts/{id}/images/{mediaId}/{variant}",
    "get",
    "Read own private WebP",
    { binary: true },
  );
  for (const [path, operations] of Object.entries(paths))
    for (const [method, operation] of Object.entries(operations)) {
      if (
        path.startsWith("/drafts/") &&
        path.includes("/images") &&
        ["post", "put", "delete"].includes(method)
      ) {
        const record = operation as { parameters: unknown[] };
        record.parameters.push({
          in: "header",
          name: "If-Match",
          required: true,
          schema: { type: "string", pattern: '^"[1-9][0-9]*"$' },
          description:
            "Current content revision, quoted. JSON body expectedRevision is an alternative; when both supplied they must match.",
        });
      }
    }
  return {
    openapi: "3.1.0",
    info: {
      title: "Taiwan Rental API — implemented content contract",
      version: contractVersion,
      description:
        "Current implementation only. External verification/payment/GB/retention/worker and UI acceptance remain incomplete. The legacy POST/PATCH /drafts writes return USE_VERSIONED_CONTENT_COMMAND in actual app. Additional product families remain planned, not available.",
    },
    "x-semantic-validation":
      "Visible grapheme lengths, Decimal precision, cross-field rules, eligibility and state are enforced by runtime Zod/services, not fully representable in JSON Schema.",
    servers: [{ url: "/api/v1" }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas,
    },
  };
}
export const contentExamples = {
  version: contractVersion,
  fixtureOnly: true,
  operation: {
    data: {
      operation: {
        id: "00000000-0000-4000-8000-000000000001",
        type: "CREATE_LISTING",
        state: "COMPLETED",
        resourceId: "00000000-0000-4000-8000-000000000002",
        currentRevision: 1,
        resultStatus: "DRAFT",
        safeNextAction: "RELOAD_CONTENT",
      },
    },
  },
  scenarios: {
    FIELD_ERROR: {
      status: 400,
      error: {
        code: "VALIDATION_ERROR",
        message: "請修正欄位",
        details: [{ path: "patch.rent", reason: "too_small" }],
      },
    },
    UNAUTHENTICATED: {
      status: 401,
      error: { code: "UNAUTHENTICATED", message: "請先登入" },
    },
    NOT_FOUND: {
      status: 404,
      error: { code: "NOT_FOUND", message: "找不到房源" },
    },
    REVISION_CONFLICT: {
      status: 409,
      error: {
        code: "REVISION_CONFLICT",
        message: "內容已更新，請重新載入並保留本地未送文字",
      },
    },
    QUOTA_FULL: {
      status: 409,
      error: { code: "CONTENT_QUOTA_EXCEEDED", message: "目標狀態額度已滿" },
    },
    KEY_REUSED: {
      status: 409,
      error: {
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "此操作識別碼已用於不同內容",
      },
    },
    EVIDENCE_UNAVAILABLE: {
      status: 503,
      error: {
        code: "PUBLICATION_EVIDENCE_UNAVAILABLE",
        message: "正式發布服務尚未接妥",
      },
    },
  },
  frontendActions: {
    REVISION_CONFLICT:
      "Preserve local text, reload current revision, show differences, reconfirm with a new key.",
    IDEMPOTENCY_KEY_REUSED: "Do not replace the payload under the same key.",
    NETWORK_UNKNOWN:
      "Query own operation if its id is known, otherwise resend the original key and identical body.",
    PUBLICATION_EVIDENCE_UNAVAILABLE:
      "Keep the draft. Never mark published or ask for another payment.",
  },
};
