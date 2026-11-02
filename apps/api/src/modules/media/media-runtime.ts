import { R2ImageStore } from "./r2-image-store.js";
import { createR2Client, readR2Config } from "./r2-config.js";
import type { MediaDependencies } from "./draft-media.service.js";
import { validateImageOptions } from "./process-image.js";
import { provisionalImageOptions } from "./image-profile.js";

// Disabled until the operator supplies explicit image processing settings.
// R2 credentials being present is NOT authorization to enable this API.
export function configuredMedia(): MediaDependencies | undefined {
  if (process.env.IMAGE_UPLOADS_ENABLED !== "1") return undefined;
  const integer = (name: string) => {
    const value = process.env[name];
    if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`Invalid ${name}`);
    return Number(value);
  };
  const options = provisionalImageOptions({ maxInputPixels: integer("IMAGE_MAX_INPUT_PIXELS"), timeoutSeconds: integer("IMAGE_TIMEOUT_SECONDS") });
  // Reject stale overrides rather than silently ignoring a previously configured value.
  for (const [key, expected] of Object.entries({ IMAGE_MAX_INPUT_BYTES: options.maxInputBytes,
    IMAGE_DISPLAY_MAX_EDGE: options.displayMaxEdge, IMAGE_THUMBNAIL_MAX_EDGE: options.thumbnailMaxEdge,
    IMAGE_WEBP_QUALITY: options.quality })) {
    if (process.env[key] !== undefined && integer(key) !== expected) throw new Error(`Setting conflicts with provisional image profile: ${key}`);
  }
  validateImageOptions(options);
  const config = readR2Config();
  const client = createR2Client(config);
  return { options, namespace: `${config.endpoint}/${config.bucket}/${config.prefix}`,
    leaseMs: integer("IMAGE_UPLOAD_LEASE_MS"), createStore: () => new R2ImageStore(client, config.bucket, config.prefix) };
}
