import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";

export interface R2Config { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; prefix: string }

export function readR2Config(values: Record<string, string | undefined> = process.env): R2Config {
  const required = (name: string) => {
    const value = values[name];
    if (!value || value.trim() !== value) throw new Error(`Missing or invalid ${name}`);
    return value;
  };
  const endpoint = required("R2_ENDPOINT");
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("Invalid R2_ENDPOINT"); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || !/^[a-f0-9]{32}(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$/.test(url.hostname)) throw new Error("Invalid R2_ENDPOINT");
  const bucket = required("R2_BUCKET");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Invalid R2_BUCKET");
  const prefix = values.R2_VALIDATION_PREFIX ?? "rental-validation";
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error("Invalid R2_VALIDATION_PREFIX");
  return { endpoint: url.origin, bucket, prefix, accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") };
}

export function createR2Client(config: R2Config) {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  return new S3Client({
    region: "auto", endpoint: config.endpoint, forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 1, // A lost conditional-write acknowledgement must not become a false ownership conflict.
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: new NodeHttpHandler({ httpsAgent: proxy ? new HttpsProxyAgent(proxy) : undefined,
      connectionTimeout: 10000, requestTimeout: 30000 }),
  });
}
