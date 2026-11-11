import { expect, test } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import {
  contentOpenApi,
  contentExamples,
  operationReceiptSchema,
} from "../src/modules/listings/content-contract.js";
import { createContractMock } from "../src/modules/listings/contract-mock.js";

test("published contract is generated from current validators and every component reference resolves", () => {
  const doc = contentOpenApi();
  expect(
    JSON.parse(
      readFileSync(
        new URL("../../../packages/contracts/openapi.v1.json", import.meta.url),
        "utf8",
      ),
    ),
  ).toEqual(doc);
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      if ("$ref" in value) {
        const ref = (value as { $ref: string }).$ref;
        expect(ref.startsWith("#/components/schemas/")).toBe(true);
        expect(doc.components.schemas[ref.split("/").at(-1)!]).toBeDefined();
      }
      Object.values(value).forEach(visit);
    }
  };
  visit(doc);
  const body = doc.components.schemas.SaveListing as {
    additionalProperties: boolean;
    required: string[];
  };
  expect(body.additionalProperties).toBe(false);
  expect(body.required).toContain("expectedRevision");
  expect(doc.paths).not.toHaveProperty("/webhooks/payments"); // planned is never advertised as implemented
});
test("Mock accepts current requests and clearly marks every response as a fixture", async () => {
  const app = createContractMock();
  const response = await request(app)
    .post("/api/v1/me/listings")
    .set("Idempotency-Key", "00000000-0000-4000-8000-000000000004")
    .send({ draft: { title: "UI測試用" } })
    .expect(201);
  expect(response.headers["x-contract-mock"]).toBe("true");
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(
    operationReceiptSchema.safeParse(response.body.data.operation).success,
  ).toBe(true);
  await request(app)
    .patch("/api/v1/me/listings/test/work-version")
    .send({ patch: { title: "沒有版本" } })
    .expect(400);
});
test.each(Object.keys(contentExamples.scenarios))(
  "Mock provides deterministic %s for frontend recovery design",
  async (scenario) => {
    const response = await request(createContractMock())
      .post("/api/v1/me/listings")
      .set("X-Mock-Scenario", scenario)
      .send({ draft: {} });
    const expected =
      contentExamples.scenarios[
        scenario as keyof typeof contentExamples.scenarios
      ];
    expect(response.status).toBe(expected.status);
    expect(response.body.error).toEqual(expected.error);
  },
);
