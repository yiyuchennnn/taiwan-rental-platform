import { mkdtemp, chmod, mkdir, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ImageVariantName = "display" | "thumbnail";
// Cloud adapters must distinguish an ambiguous reservation from a known rejection.
export class ReservationOutcomeUnknownError extends Error {}
export interface PrivateImageStore {
  reserve(assetId: string): Promise<void>;
  put(assetId: string, variant: ImageVariantName, data: Buffer): Promise<void>;
  remove(assetId: string): Promise<void>;
}

/** Test adapter only. No web server, public URL, credentials or production persistence. */
export class TemporaryImageStore implements PrivateImageStore {
  private disposed = false;
  private constructor(readonly rootPath: string) {}
  static async create() {
    const root = await mkdtemp(join(tmpdir(), "rental-images-"));
    try { await chmod(root, 0o700); }
    catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
    return new TemporaryImageStore(root);
  }
  private path(assetId: string, variant?: ImageVariantName) {
    if (this.disposed) throw new Error("Temporary store is disposed");
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(assetId)) throw new Error("Invalid asset key");
    if (variant !== undefined && variant !== "display" && variant !== "thumbnail") throw new Error("Invalid image variant");
    return variant === undefined ? join(this.rootPath, assetId) : join(this.rootPath, assetId, `${variant}.webp`);
  }
  async reserve(assetId: string) { await mkdir(this.path(assetId), { mode: 0o700 }); }
  async put(assetId: string, variant: ImageVariantName, data: Buffer) {
    const path = this.path(assetId, variant);
    const file = await open(path, "wx", 0o600);
    try { await file.writeFile(data); }
    finally { await file.close(); }
  }
  async read(assetId: string, variant: ImageVariantName) { return readFile(this.path(assetId, variant)); }
  async remove(assetId: string) { await rm(this.path(assetId), { recursive: true, force: true }); }
  async dispose() {
    if (!this.disposed) { await rm(this.rootPath, { recursive: true, force: true }); this.disposed = true; }
  }
}
