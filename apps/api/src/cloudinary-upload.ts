import { readFile } from "node:fs/promises";
import { v2 as cloudinary } from "cloudinary";
import { config } from "./config.js";
import { inferMediaContentType, resolveMediaFilePath } from "./media-storage.js";

function isCloudinaryConfigured(): boolean {
  return Boolean(
    config.CLOUDINARY_CLOUD_NAME.trim() && config.CLOUDINARY_API_KEY.trim() && config.CLOUDINARY_API_SECRET.trim()
  );
}

function configureOnce() {
  cloudinary.config({
    cloud_name: config.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: config.CLOUDINARY_API_KEY.trim(),
    api_secret: config.CLOUDINARY_API_SECRET.trim(),
  });
}

/** Cloudinary public_id segment: lowercase letters, numbers, hyphens (SKU slug). */
export function sanitizeSkuForCloudinaryPublicId(sku: string): string {
  const cleaned = sku
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : "product";
}

function extractMediaRelativePath(imageUrl: string): string | null {
  try {
    const u = new URL(imageUrl);
    if (!u.pathname.startsWith("/media/")) {
      return null;
    }
    return decodeURIComponent(u.pathname.replace(/^\/media\//, ""));
  } catch {
    return null;
  }
}

/** True when this URL points at our VPS /media/... file (Telegram uploads, etc.). */
export function isLocalApiMediaUrl(imageUrl: string): boolean {
  const path = extractMediaRelativePath(imageUrl);
  return path != null && path.length > 0;
}

/**
 * When Cloudinary is configured and the image lives under our /media/... storage,
 * uploads it with public_id `{CLOUDINARY_PRODUCTS_FOLDER}/{sku}` and returns https secure_url.
 * Otherwise returns the original URL (or null).
 */
export async function resolveProductImageUrlForCloudinary(
  imageUrl: string | null | undefined,
  sku: string
): Promise<string | null> {
  if (!imageUrl?.trim()) {
    return null;
  }

  const trimmed = imageUrl.trim();
  if (!isCloudinaryConfigured()) {
    return trimmed;
  }

  if (!isLocalApiMediaUrl(trimmed)) {
    return trimmed;
  }

  const relativePath = extractMediaRelativePath(trimmed);
  if (!relativePath) {
    return trimmed;
  }

  const absolutePath = resolveMediaFilePath(relativePath);
  if (!absolutePath) {
    return trimmed;
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch {
    return trimmed;
  }

  configureOnce();
  const folder = (config.CLOUDINARY_PRODUCTS_FOLDER.trim() || "assets").replace(/^\/+|\/+$/g, "");
  const publicId = `${folder}/${sanitizeSkuForCloudinaryPublicId(sku)}`;
  const mime = inferMediaContentType(absolutePath);
  const dataUri = `data:${mime};base64,${buffer.toString("base64")}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      public_id: publicId,
      overwrite: true,
      resource_type: "image",
      invalidate: true,
    });
    return typeof result.secure_url === "string" ? result.secure_url : trimmed;
  } catch (error) {
    console.error("Cloudinary upload failed:", error);
    return trimmed;
  }
}
