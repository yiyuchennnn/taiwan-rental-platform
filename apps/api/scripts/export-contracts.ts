import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  contentOpenApi,
  contentExamples,
} from "../src/modules/listings/content-contract.js";
const root = new URL("../../../packages/contracts/", import.meta.url);
const entries = [
  ["openapi.v1.json", contentOpenApi()],
  ["examples.v1.json", contentExamples],
] as const;
mkdirSync(root, { recursive: true });
for (const [name, value] of entries) {
  const path = fileURLToPath(new URL(name, root)),
    text = JSON.stringify(value, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== text)
      throw new Error(`Contract artifact is stale: ${name}`);
  } else writeFileSync(path, text);
}
