import type { ImageProcessingOptions } from "./process-image.js";

// User-approved provisional validation profile (2026-11-03, Asia/Taipei).
// Approval of a profile does not enable uploads or invent plan storage quotas.
export const provisionalImageProfile = Object.freeze({
  maxInputBytes: 10_000_000,
  displayMaxEdge: 1920,
  thumbnailMaxEdge: 480,
  quality: 82,
});

export function provisionalImageOptions(resources: { maxInputPixels: number; timeoutSeconds: number }): ImageProcessingOptions {
  return { ...provisionalImageProfile, ...resources };
}
