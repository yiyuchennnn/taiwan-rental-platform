import { randomUUID } from "node:crypto";
import { processImage, ImageProcessingError, type ImageProcessingOptions } from "./process-image.js";
import { ReservationOutcomeUnknownError, type PrivateImageStore } from "./private-image-store.js";

export class ImageStorageError extends Error {
  constructor(public code: "IMAGE_STORAGE_FAILED" | "IMAGE_STORAGE_CLEANUP_REQUIRED" | "IMAGE_RESERVATION_UNCONFIRMED",
    public cleanupAssetIds: string[] = [], public reconcileAssetIds: string[] = []) {
    super(code === "IMAGE_STORAGE_CLEANUP_REQUIRED" ? "儲存失敗且有待清理圖片，不可宣稱已釋放容量"
      : code === "IMAGE_RESERVATION_UNCONFIRMED" ? "儲存保留結果不明，須先核對，不可直接刪除或宣稱完成" : "圖片儲存失敗");
  }
}

export async function processAndStoreImage(input: Buffer, options: ImageProcessingOptions, store: PrivateImageStore, rightsConfirmed: boolean) {
  if (rightsConfirmed !== true) throw new ImageProcessingError("PHOTO_RIGHTS_NOT_CONFIRMED", "須確認有權使用照片");
  // Process entirely in memory before creating storage objects. Original bytes are never persisted.
  const result = await processImage(input, options);
  const assetId = randomUUID();
  let reserved = false;
  try {
    await store.reserve(assetId); reserved = true;
    await store.put(assetId, "display", result.display.data);
    await store.put(assetId, "thumbnail", result.thumbnail.data);
    return { assetId, displayBytes: result.display.bytes, thumbnailBytes: result.thumbnail.bytes,
      displayWidth: result.display.width, displayHeight: result.display.height,
      thumbnailWidth: result.thumbnail.width, thumbnailHeight: result.thumbnail.height,
      contentType: "image/webp" as const, gpsRemovedAt: result.metadataStrippedAt };
  } catch (error) {
    if (!reserved && error instanceof ReservationOutcomeUnknownError) {
      throw new ImageStorageError("IMAGE_RESERVATION_UNCONFIRMED", [], [assetId]);
    }
    if (reserved) {
      try { await store.remove(assetId); }
      catch { throw new ImageStorageError("IMAGE_STORAGE_CLEANUP_REQUIRED", [assetId]); }
    }
    throw new ImageStorageError("IMAGE_STORAGE_FAILED");
  }
}
