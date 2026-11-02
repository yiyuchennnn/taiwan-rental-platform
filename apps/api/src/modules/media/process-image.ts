import sharp from "sharp";

export class ImageProcessingError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

// Explicit technical settings; no production sizes, quality, MB convention or pixel limit is assumed.
export interface ImageProcessingOptions {
  maxInputBytes: number;
  maxInputPixels: number;
  displayMaxEdge: number;
  thumbnailMaxEdge: number;
  quality: number;
  timeoutSeconds: number;
}
export interface ProcessedVariant {
  data: Buffer;
  contentType: "image/webp";
  bytes: number;
  width: number;
  height: number;
}
export interface ProcessedImage {
  display: ProcessedVariant;
  thumbnail: ProcessedVariant;
  metadataStrippedAt: Date;
}

export function validateImageOptions(options: ImageProcessingOptions) {
  for (const [key, value] of Object.entries(options)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid image processing option: ${key}`);
  }
  for (const key of ["maxInputBytes", "maxInputPixels", "displayMaxEdge", "thumbnailMaxEdge", "quality", "timeoutSeconds"] as const) {
    if (!Number.isSafeInteger(options[key]) || options[key] <= 0) throw new Error(`Missing image processing option: ${key}`);
  }
  if (options.quality > 100 || options.thumbnailMaxEdge > options.displayMaxEdge) throw new Error("Invalid image output configuration");
}

export async function processImage(input: Buffer, options: ImageProcessingOptions): Promise<ProcessedImage> {
  validateImageOptions(options);
  if (!Buffer.isBuffer(input) || input.length === 0) throw new ImageProcessingError("EMPTY_IMAGE", "圖片內容為空");
  if (input.length > options.maxInputBytes) throw new ImageProcessingError("IMAGE_TOO_LARGE", "原始圖片超過設定大小");
  const jpeg = input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
  const png = input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = input.length >= 12 && input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WEBP";
  if (!jpeg && !png && !webp) throw new ImageProcessingError("UNSUPPORTED_IMAGE_FORMAT", "內容不是支援的 JPEG、PNG 或 WebP");
  if (png) {
    // libvips may decode an APNG's default image and omit its animation pages.
    // Parse bounded PNG chunks; a byte-string search would misclassify text/data.
    for (let offset = 8; offset + 12 <= input.length;) {
      const length = input.readUInt32BE(offset);
      if (length > input.length - offset - 12) break; // Decoder rejects malformed data below.
      const chunk = input.toString("ascii", offset + 4, offset + 8);
      if (chunk === "acTL") throw new ImageProcessingError("ANIMATED_IMAGE_REQUIRES_POLICY", "動畫 PNG 暫不接受，請改用靜態圖片");
      if (chunk === "IEND") break;
      offset += length + 12;
    }
  }
  try {
    const decoder = () => sharp(input, { limitInputPixels: options.maxInputPixels, failOn: "warning" }).timeout({ seconds: options.timeoutSeconds });
    const metadata = await decoder().metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
      throw new ImageProcessingError("UNSUPPORTED_IMAGE_FORMAT", "僅處理 JPEG、PNG、WebP；其他格式仍待規格確認");
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new ImageProcessingError("ANIMATED_IMAGE_REQUIRES_POLICY", "動畫／多頁圖片的處理方式尚未確認，未擅自取第一張");
    }
    const variant = async (edge: number): Promise<ProcessedVariant> => {
      // Orientation is applied to pixels before EXIF removal. No keepMetadata/withMetadata.
      const { data, info } = await decoder().rotate()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .toColourspace("srgb").webp({ quality: options.quality }).toBuffer({ resolveWithObject: true });
      const outputMetadata = await sharp(data).metadata();
      if (outputMetadata.exif || outputMetadata.xmp || outputMetadata.iptc || outputMetadata.icc || outputMetadata.orientation) {
        throw new ImageProcessingError("METADATA_STRIP_FAILED", "圖片中仍存在未移除的中繼資料");
      }
      return { data, contentType: "image/webp", bytes: data.length, width: info.width, height: info.height };
    };
    const display = await variant(options.displayMaxEdge);
    const thumbnail = await variant(options.thumbnailMaxEdge);
    return { display, thumbnail, metadataStrippedAt: new Date() };
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    // Decoder messages can contain internals. Do not expose them or input bytes.
    throw new ImageProcessingError("IMAGE_DECODE_FAILED", "圖片無法完整解碼或超過處理資源設定");
  }
}
